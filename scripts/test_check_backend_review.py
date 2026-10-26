"""Synthetic guardrail tests; these records never approve application features."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_backend_review import CATEGORIES, validate_review


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'docs/reviews/TEST').mkdir(parents=True)
        (self.root / 'scope').mkdir()
        (self.root / 'scope/source.py').write_text('pass\n')
        (self.root / 'scope/test.log').write_text('synthetic test passed\n')
        (self.root / 'scope/reviewer.md').write_text('Fresh separate actor/session read-only audit\n')
        criteria = {'criteriaVersion': 'backend-review-v1', 'featureIds': ['TEST'],
                    'requiredTests': {'unit': 'python3 -m unittest'},
                    'mandatoryCriteria': ['negative authorization checks']}
        (self.root / 'scope/criteria.json').write_text(json.dumps(criteria))
        self.path = 'docs/reviews/TEST/round-1.json'
        self.data = {
            'schemaVersion': 1, 'featureIds': ['TEST'], 'criteriaVersion': 'backend-review-v1',
            'criteriaPath': 'scope/criteria.json', 'verdict': 'pass',
            'startedAt': '2026-10-26T00:00:00Z', 'completedAt': '2026-10-26T00:01:00Z',
            'implementer': {'actorId': 'builder', 'sessionId': 'session-1', 'model': 'synthetic'},
            'reviewer': {'actorId': 'auditor', 'sessionId': 'session-2', 'model': 'synthetic',
                         'independent': True, 'freshContext': True, 'implementedTarget': False,
                         'independenceEvidence': 'scope/reviewer.md'},
            'target': {'kind': 'sha256-manifest', 'scopeRoots': ['scope']},
            'criteriaResults': {'negative authorization checks': 'pass'},
            'hardBlockers': [], 'coverageGaps': [], 'findings': [],
            'tests': [{'id': 'unit', 'command': 'python3 -m unittest', 'exitCode': 0,
                       'environment': 'synthetic fixture only', 'isolatedSynthetic': True,
                       'evidencePath': 'scope/test.log'}],
            'categories': {name: {'weight': weight, 'score': '9', 'reason': 'synthetic evidence',
                                  'evidencePaths': ['scope/test.log']} for name, (weight, _) in CATEGORIES.items()},
            'weightedScore': '9',
        }
        self.refresh()

    def refresh(self):
        files = {p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in (self.root / 'scope').rglob('*') if p.is_file()}
        self.data['target']['files'] = files
        digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.data['target']['digest'] = digest
        self.data['tests'][0]['targetDigest'] = digest

    def check(self, expected=True, feature='TEST'):
        (self.root / self.path).write_text(json.dumps(self.data))
        result = validate_review(self.path, root=self.root, feature_id=feature)
        self.assertEqual(result.passed, expected, result.errors)
        return result

    def test_valid_and_cli(self):
        self.assertEqual(str(self.check().score), '9')
        cli = subprocess.run([sys.executable, str(Path(__file__).with_name('check_backend_review.py')),
                              self.path, '--root', str(self.root), '--feature', 'TEST'], capture_output=True)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.data['verdict'] = 'incomplete'
        self.check(False)
        cli = subprocess.run([sys.executable, str(Path(__file__).with_name('check_backend_review.py')),
                              self.path, '--root', str(self.root)], capture_output=True)
        self.assertEqual(cli.returncode, 1, cli.stderr)
        self.assertIn(b'REVIEW REQUIRED', cli.stdout)

    def test_threshold_exact_and_barely_above(self):
        values = ['9', '8.6', '8.5', '8.5', '7.5', '7']  # 8.5 exactly
        for name, value in zip(CATEGORIES, values):
            self.data['categories'][name]['score'] = value
        self.data['weightedScore'] = '8.5'
        self.check(False)
        self.data['categories']['operations']['score'] = '7.00000000000000000000000000000000000000000000000001'
        self.data['weightedScore'] = '8.5000000000000000000000000000000000000000000000000005'
        self.check()

    def test_high_average_cannot_override_minimum(self):
        self.data['categories']['security']['score'] = '8.99'
        self.check(False)

    def test_tampering(self):
        mutations = [
            lambda d: d.update(verdict='incomplete'),
            lambda d: d.update(criteriaVersion='unknown'),
            lambda d: d.update(weightedScore='9.1'),
            lambda d: d.update(weightedScore='not a number'),
            lambda d: d.update(coverageGaps=['PostgreSQL not tested']),
            lambda d: d.update(hardBlockers=['unmounted route']),
            lambda d: d['reviewer'].update(actorId=' BUILDER '),
            lambda d: d['reviewer'].update(sessionId='session-1'),
            lambda d: d['reviewer'].update(freshContext=False),
            lambda d: d['reviewer'].update(implementedTarget=True),
            lambda d: d['categories']['security'].update(weight=31),
            lambda d: d['categories']['security'].update(score='NaN'),
            lambda d: d['categories']['security'].update(score=True),
            lambda d: d['categories']['security'].update(evidencePaths=['missing']),
            lambda d: d['tests'][0].update(exitCode=1),
            lambda d: d['tests'][0].update(exitCode=False),
            lambda d: d['tests'][0].update(command='echo passed'),
            lambda d: d['tests'][0].update(targetDigest='old'),
            lambda d: d['tests'][0].update(isolatedSynthetic=False),
            lambda d: d['tests'][0].update(id='unrequired'),
            lambda d: d.update(criteriaResults={}),
            lambda d: d.update(findings=[{'id': 'F1', 'severity': 'high', 'description': 'defect',
                                          'disposition': 'open', 'rationale': 'still broken',
                                          'mandatory': True, 'blocking': False}]),
        ]
        baseline = copy.deepcopy(self.data)
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.data = copy.deepcopy(baseline)
                mutation(self.data)
                self.check(False)

    def test_feature_mismatch(self):
        self.check(False, feature='OTHER')
        self.data['featureIds'] = ['TEST', 'OTHER']
        self.check(False)

    def test_changed_added_removed_source(self):
        (self.root / 'scope/source.py').write_text('changed')
        self.check(False)
        self.refresh()
        self.check()
        (self.root / 'scope/new.py').write_text('added')
        self.check(False)
        (self.root / 'scope/new.py').unlink()
        (self.root / 'scope/source.py').unlink()
        self.check(False)

    def test_traversal_absolute_and_symlinks(self):
        for value in ('../scope', '/tmp', 'scope/../scope', './scope', 'scope//source.py', 'scope\\source.py'):
            with self.subTest(value=value):
                self.data['target']['scopeRoots'] = [value]
                self.check(False)
        self.data['target']['scopeRoots'] = ['scope']
        (self.root / 'scope/link').symlink_to(self.root / 'scope/source.py')
        self.check(False)

    def test_missing_or_empty_evidence(self):
        (self.root / 'scope/test.log').write_text('')
        self.refresh()
        self.check(False)
        (self.root / 'scope/test.log').unlink()
        self.check(False)

    def setup_renderer(self):
        (self.root / 'scripts').mkdir()
        for name in ('render_feature_checklist.py', 'check_backend_review.py'):
            (self.root / 'scripts' / name).write_text(Path(__file__).with_name(name).read_text())
        (self.root / 'docs/features.tsv').write_text(
            'id\tarea\tstage\tfeature\tacceptance\tdepends_on\tui_required\n'
            'TEST\tFoundation\tS0\tExample\tWorks\t\tyes\n')
        for role in ('backend', 'ui', 'integration'):
            folder = self.root / 'docs/handoffs' / role
            folder.mkdir(parents=True)
            handoff = {'status': 'verified', 'summary': 'Historical result',
                       'evidence': [{'command': 'historical command', 'result': 'passed',
                                     'environment': 'synthetic', 'path': 'scope/test.log'}]}
            if role == 'backend':
                handoff.update(api_contract='contract', limitations=[])
            (folder / 'TEST.json').write_text(json.dumps(handoff))

    def render_counts(self, backend, ui, integration):
        result = subprocess.run([sys.executable, str(self.root / 'scripts/render_feature_checklist.py')],
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        checklist = (self.root / 'docs/FEATURE_CHECKLIST.md').read_text()
        self.assertIn(f'Backend verified: **{backend}**. UI verified: **{ui}**. Integrated: **{integration}**.', checklist)
        return checklist

    def approve_backend(self):
        self.check()
        path = self.root / 'docs/handoffs/backend/TEST.json'
        handoff = json.loads(path.read_text())
        handoff['reviewPath'] = self.path
        path.write_text(json.dumps(handoff))

    def bind_downstream(self, role):
        path = self.root / f'docs/handoffs/{role}/TEST.json'
        handoff = json.loads(path.read_text())
        handoff['backendReviewSHA256'] = hashlib.sha256((self.root / self.path).read_bytes()).hexdigest()
        evidence = self.root / f'docs/{role}.log'
        if not evidence.exists():
            evidence.write_text(f'{role} synthetic fresh verification evidence')
        handoff['evidence'][0].update(path=f'docs/{role}.log', sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())
        if role == 'integration':
            handoff['uiHandoffSHA256'] = hashlib.sha256(
                (self.root / 'docs/handoffs/ui/TEST.json').read_bytes()).hexdigest()
        path.write_text(json.dumps(handoff))

    def test_renderer_withholds_historical_dependent_approvals(self):
        self.setup_renderer()
        self.assertIn('Review required', self.render_counts(0, 0, 0))
        self.approve_backend()
        # New backend approval never revives old unbound downstream records.
        self.render_counts(1, 0, 0)
        self.bind_downstream('ui')
        self.render_counts(1, 1, 0)
        self.bind_downstream('integration')
        self.render_counts(1, 1, 1)
        self.data['roundMemo'] = 'New independent review record bytes'
        self.check()
        self.render_counts(1, 0, 0)
        self.bind_downstream('ui')
        self.render_counts(1, 1, 0)
        self.bind_downstream('integration')
        self.render_counts(1, 1, 1)

    def test_renderer_changed_ui_evidence_and_handoff_invalidate_integration(self):
        self.setup_renderer()
        self.approve_backend()
        self.bind_downstream('ui')
        self.bind_downstream('integration')
        self.render_counts(1, 1, 1)
        (self.root / 'docs/ui.log').write_text('Changed UI verification evidence')
        self.render_counts(1, 0, 0)
        self.bind_downstream('ui')
        self.render_counts(1, 1, 0)
        self.bind_downstream('integration')
        self.render_counts(1, 1, 1)
        path = self.root / 'docs/handoffs/ui/TEST.json'
        data = json.loads(path.read_text())
        data['summary'] = 'New UI result'
        path.write_text(json.dumps(data))
        self.render_counts(1, 1, 0)
        self.bind_downstream('integration')
        (self.root / 'docs/integration.log').write_text('Changed integration evidence')
        self.render_counts(1, 1, 0)

    def test_renderer_backend_prerequisites_and_binding_fields(self):
        self.setup_renderer()
        self.approve_backend()
        self.bind_downstream('ui')
        self.bind_downstream('integration')
        self.render_counts(1, 1, 1)
        ui_path = self.root / 'docs/handoffs/ui/TEST.json'
        ui_data = json.loads(ui_path.read_text())
        del ui_data['backendReviewSHA256']
        ui_path.write_text(json.dumps(ui_data))
        self.render_counts(1, 0, 0)
        self.bind_downstream('ui')
        self.bind_downstream('integration')
        path = self.root / 'docs/handoffs/integration/TEST.json'
        data = json.loads(path.read_text())
        del data['uiHandoffSHA256']
        path.write_text(json.dumps(data))
        self.render_counts(1, 1, 0)
        self.bind_downstream('integration')
        definitions = self.root / 'docs/features.tsv'
        text = definitions.read_text().replace('Works\t\tyes', 'Works\tDEP\tyes')
        definitions.write_text(text + 'DEP\tFoundation\tS0\tDependency\tWorks\t\tno\n')
        self.render_counts(1, 0, 0)
        # A transitive unapproved prerequisite also blocks downstream approval.
        definitions.write_text(text.replace('Works\tDEP', 'Works\tMID') +
                              'MID\tFoundation\tS0\tMiddle\tWorks\tDEP\tno\n' +
                              'DEP\tFoundation\tS0\tDependency\tWorks\t\tno\n')
        self.render_counts(1, 0, 0)
        # MID's own backend passes, but its DEP prerequisite is still unapproved.
        criteria_path = self.root / 'scope/criteria.json'
        criteria = json.loads(criteria_path.read_text())
        criteria['featureIds'] = ['TEST', 'MID']
        criteria_path.write_text(json.dumps(criteria))
        self.data['featureIds'] = ['TEST', 'MID']
        self.refresh()
        self.check()
        backend = self.root / 'docs/handoffs/backend'
        (backend / 'MID.json').write_bytes((backend / 'TEST.json').read_bytes())
        self.bind_downstream('ui')
        self.bind_downstream('integration')
        self.render_counts(2, 0, 0)
        # Even with both backend records approved, a dependency cycle cannot unlock UI.
        definitions.write_text(definitions.read_text().replace('Works\tDEP\tno', 'Works\tTEST\tno'))
        self.render_counts(2, 0, 0)

    def test_malformed_input_is_closed(self):
        record = self.root / self.path
        for content in ('[]', '{}', 'null', '{', '{"schemaVersion":1,"schemaVersion":1}', '{"x":NaN}'):
            record.write_text(content)
            with self.subTest(content=content):
                self.assertFalse(validate_review(self.path, root=self.root).passed)
        self.assertFalse(validate_review('missing.json', root=self.root).passed)


if __name__ == '__main__':
    unittest.main()
