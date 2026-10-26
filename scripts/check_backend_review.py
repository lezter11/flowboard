#!/usr/bin/env python3
"""Fail-closed, standard-library validation of Flowboard backend review records."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys

ROOT = Path(__file__).resolve().parents[1]
CRITERIA_VERSION = 'backend-review-v1'
# Policy values belong to the validator, never to an individual score report.
CATEGORIES = {
    'security': (30, Decimal('9')),
    'correctness': (25, Decimal('8.5')),
    'integrity': (15, Decimal('8.5')),
    'tests': (15, Decimal('8.5')),
    'maintainability': (10, Decimal('7.5')),
    'operations': (5, Decimal('7')),
}


class ReviewError(ValueError):
    """A review cannot authorize backend closure."""


def require(condition, message):
    if not condition:
        raise ReviewError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def safe_path(root: Path, value: str, *, file=True) -> Path:
    """Reject noncanonical paths, escapes and every symlink component."""
    require(nonempty(value) and '\\' not in value, 'invalid relative path')
    parts = PurePosixPath(value).parts
    require(parts and not value.startswith('/') and all(p not in ('.', '..') for p in parts)
            and '/'.join(parts) == value, f'noncanonical path: {value}')
    current = root
    for part in parts:
        current = current / part
        require(not current.is_symlink(), f'symlink forbidden: {value}')
    require(current.resolve().is_relative_to(root.resolve()), f'path escapes root: {value}')
    require(current.is_file() if file else current.exists(), f'missing path: {value}')
    return current


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(), parse_float=Decimal, object_pairs_hook=unique,
                      parse_constant=lambda x: (_ for _ in ()).throw(ReviewError(f'invalid number: {x}')))


def identifiers(values, name):
    require(isinstance(values, list) and values and all(nonempty(v) for v in values)
            and len(set(values)) == len(values), f'{name} must be a nonempty unique string list')
    return set(values)


@dataclass(frozen=True)
class ValidationResult:
    passed: bool
    errors: tuple[str, ...] = ()
    score: Decimal | None = None


def validate_review(review_path, *, root=ROOT, feature_id=None) -> ValidationResult:
    """Validate current bytes and declarations; never execute record commands.

    Returns a failed result for malformed/unreadable records, suitable for importing
    into checklist generation. Human reviewers remain responsible for truthful
    identities, test execution and completeness of declared reachable scope.
    """
    try:
        score = _validate(str(review_path), Path(root), feature_id)
        return ValidationResult(True, score=score)
    except (ReviewError, OSError, ValueError, TypeError, KeyError, AttributeError, ArithmeticError, RecursionError) as error:
        return ValidationResult(False, (str(error) or type(error).__name__,))


def _validate(review_path, root, feature_id):
    require(review_path.startswith('docs/reviews/') and review_path.endswith('.json'),
            'reviewPath must be a JSON record beneath docs/reviews/')
    data = read_json(safe_path(root, review_path))
    require(isinstance(data, dict), 'review must be an object')
    require(type(data.get('schemaVersion')) is int and data['schemaVersion'] == 1, 'schemaVersion must be 1')
    feature_ids = identifiers(data.get('featureIds'), 'featureIds')
    require(feature_id is None or feature_id in feature_ids, 'review does not cover requested feature')
    require(data.get('criteriaVersion') == CRITERIA_VERSION, 'unsupported criteriaVersion')
    require(data.get('verdict') == 'pass', 'review verdict is not pass')
    for field in ('startedAt', 'completedAt'):
        value = data.get(field)
        require(nonempty(value), f'{field} required')
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, f'{field} requires timezone')
    require(datetime.fromisoformat(data['completedAt'].replace('Z', '+00:00')) >=
            datetime.fromisoformat(data['startedAt'].replace('Z', '+00:00')), 'timestamps reversed')
    implementer, reviewer = data['implementer'], data['reviewer']
    for identity in (implementer, reviewer):
        require(all(nonempty(identity.get(k)) for k in ('actorId', 'sessionId', 'model')), 'identity fields required')
    for key in ('actorId', 'sessionId'):
        require(implementer[key].strip().casefold() != reviewer[key].strip().casefold(),
                f'reviewer must have distinct {key}')
    require(reviewer.get('independent') is True and reviewer.get('freshContext') is True
            and reviewer.get('implementedTarget') is False and nonempty(reviewer.get('independenceEvidence')),
            'fresh independent read-only reviewer declaration required')
    safe_path(root, reviewer['independenceEvidence'])

    target = data['target']
    require(target.get('kind') == 'sha256-manifest', 'target.kind must be sha256-manifest')
    scope = identifiers(target.get('scopeRoots'), 'scopeRoots')
    actual_files = set()
    for name in scope:
        path = safe_path(root, name, file=False)
        candidates = [path] if path.is_file() else path.rglob('*')
        for candidate in candidates:
            require(not candidate.is_symlink(), f'symlink in scope: {candidate}')
            if candidate.is_file():
                actual_files.add(candidate.relative_to(root).as_posix())
    manifest = target['files']
    require(isinstance(manifest, dict) and manifest and set(manifest) == actual_files,
            'manifest must include exactly every file under all scopeRoots')
    require(review_path not in manifest, 'review record cannot hash itself')
    for name, expected in manifest.items():
        require(isinstance(expected, str) and len(expected) == 64 and
                all(c in '0123456789abcdef' for c in expected), f'invalid SHA256: {name}')
        require(digest(safe_path(root, name)) == expected, f'target changed: {name}')
    manifest_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    require(target.get('digest') == manifest_hash, 'target digest mismatch')

    require(reviewer['independenceEvidence'] in manifest, 'reviewer evidence must be in manifest')

    criteria_path = data['criteriaPath']
    require(criteria_path in manifest, 'frozen criteria must be in target manifest')
    criteria = read_json(safe_path(root, criteria_path))
    require(criteria.get('criteriaVersion') == CRITERIA_VERSION, 'frozen criteria version mismatch')
    require(identifiers(criteria.get('featureIds'), 'criteria featureIds') == feature_ids,
            'review and frozen criteria featureIds must match exactly')
    required = criteria.get('requiredTests')
    require(isinstance(required, dict) and required and all(nonempty(k) and nonempty(v) for k, v in required.items()),
            'frozen requiredTests must map IDs to exact commands')
    mandatory = identifiers(criteria.get('mandatoryCriteria'), 'mandatoryCriteria')
    outcomes = data['criteriaResults']
    require(isinstance(outcomes, dict) and set(outcomes) == mandatory and all(v == 'pass' for v in outcomes.values()),
            'all mandatory criteria must be checked and pass')
    require(data.get('hardBlockers') == [] and data.get('coverageGaps') == [],
            'hard blockers or coverage gaps prevent closure')
    findings = data['findings']
    require(isinstance(findings, list), 'findings must be an array')
    for finding in findings:
        require(all(nonempty(finding.get(k)) for k in ('id', 'severity', 'description', 'disposition', 'rationale')),
                'finding fields required')
        require(type(finding.get('mandatory')) is bool and type(finding.get('blocking')) is bool,
                'finding must declare mandatory and blocking')
        require(finding['disposition'] in ('resolved', 'rejected', 'open'), 'invalid finding disposition')
        require(finding['disposition'] != 'open' or not (finding['mandatory'] or finding['blocking']),
                'unresolved mandatory/blocking finding')

    tests = data['tests']
    require(isinstance(tests, list) and tests, 'test evidence required')
    seen = set()
    for test in tests:
        tid = test['id']
        require(nonempty(tid) and tid not in seen, 'test IDs must be unique')
        seen.add(tid)
        require(type(test.get('exitCode')) is int and test['exitCode'] == 0, f'test did not pass: {tid}')
        require(test.get('targetDigest') == manifest_hash, f'test target mismatch: {tid}')
        require(nonempty(test.get('command')) and nonempty(test.get('environment')), 'command/environment required')
        require(test.get('isolatedSynthetic') is True, 'isolated synthetic test declaration required')
        evidence = test['evidencePath']
        require(evidence in manifest and safe_path(root, evidence).stat().st_size > 0,
                'test evidence must be nonempty and hashed in manifest')
        if tid in required:
            require(test['command'] == required[tid], f'required command mismatch: {tid}')
    require(set(required) <= seen, 'required tests missing')

    categories = data['categories']
    require(isinstance(categories, dict) and set(categories) == set(CATEGORIES), 'six fixed categories required')
    total = Decimal(0)
    for name, (weight, minimum) in CATEGORIES.items():
        category = categories[name]
        require(type(category.get('weight')) is int and category['weight'] == weight, f'fixed weight mismatch: {name}')
        require(type(category.get('score')) in (int, Decimal, str), f'invalid score: {name}')
        score = Decimal(str(category['score']))
        require(score.is_finite() and minimum <= score <= 10, f'category minimum/range failed: {name}')
        require(nonempty(category.get('reason')), f'category reason required: {name}')
        evidence = identifiers(category.get('evidencePaths'), f'{name} evidencePaths')
        require(evidence <= set(manifest), f'category evidence must be in manifest: {name}')
        require(len(str(score)) <= 1000, 'score precision exceeds limit')
        with localcontext() as context:
            context.prec = 10000
            total += score * weight
    with localcontext() as context:
        context.prec = 10000
        total /= 100
    require(total > Decimal('8.5'), f'unrounded score {total} must be strictly greater than 8.5')
    require(Decimal(str(data.get('weightedScore'))) == total, 'weightedScore must equal exact computed score')
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review_path', help='repository-relative docs/reviews/...json')
    parser.add_argument('--feature', help='require this feature ID in the review')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    result = validate_review(args.review_path, root=args.root, feature_id=args.feature)
    print(f'PASS: {result.score}/10' if result.passed else 'REVIEW REQUIRED: ' + '; '.join(result.errors))
    return 0 if result.passed else 1


if __name__ == '__main__':
    sys.exit(main())
