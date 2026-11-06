import tempfile
import unittest
from pathlib import Path
from phase_guard import reserve_phase


class PhaseGuardTest(unittest.TestCase):
    def test_reservation_prevents_second_application(self):
        with tempfile.TemporaryDirectory(prefix='flowboard-phase-guard-') as folder:
            base = Path(folder)
            reserve_phase(base, ['SYNTHETIC-01'], 'synthetic-review.json')
            original = (base / 'apply-reserved.json').read_bytes()
            with self.assertRaises(FileExistsError):
                reserve_phase(base, ['SYNTHETIC-01'], 'other-review.json')
            self.assertEqual((base / 'apply-reserved.json').read_bytes(), original)

    def test_partial_outputs_refuse_before_reservation_or_overwrite(self):
        for name in ['summary.json', 'review-test-executions.json', 'previous-handoffs', 'SYNTHETIC-01.json']:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix='flowboard-phase-guard-') as folder:
                base = Path(folder)
                if name == 'previous-handoffs':
                    (base / name).mkdir()
                else:
                    (base / name).write_text('synthetic-original')
                with self.assertRaises(AssertionError):
                    reserve_phase(base, ['SYNTHETIC-01'], 'synthetic-review.json')
                self.assertFalse((base / 'apply-reserved.json').exists())
                if name != 'previous-handoffs':
                    self.assertEqual((base / name).read_text(), 'synthetic-original')


if __name__ == '__main__':
    unittest.main()
