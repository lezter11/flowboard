"""Pure synthetic phase-guard probe; never imports or executes revalidate.py."""
import concurrent.futures
import importlib.util
import json
import pathlib
import tempfile
import threading

source = pathlib.Path(__file__).resolve().parent.parent / 'banner-owner-phase/phase_guard.py'
spec = importlib.util.spec_from_file_location('reviewed_phase_guard', source)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
with tempfile.TemporaryDirectory(prefix='flowboard-independent-reservation-') as folder:
    base = pathlib.Path(folder)
    barrier = threading.Barrier(8)
    def attempt(number):
        barrier.wait()
        try:
            guard.reserve_phase(base, ['SYNTHETIC-01'], f'synthetic-review-{number}.json')
            return number
        except FileExistsError:
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    winners = [result for result in results if result is not None]
    assert len(winners) == 1, results
    receipt = json.loads((base / 'apply-reserved.json').read_text())
    assert receipt == {'oneShotReservation': True, 'reviewPath': f'synthetic-review-{winners[0]}.json'}
    assert [item.name for item in base.iterdir()] == ['apply-reserved.json']
print(json.dumps({'status': 'pass', 'contenders': 8, 'winners': 1, 'refusals': 7,
                  'originalReceiptPreserved': True, 'canonicalWrites': 0}))
