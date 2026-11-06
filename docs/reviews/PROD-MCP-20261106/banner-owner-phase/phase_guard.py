"""One-shot reservation before any canonical handoff or snapshot is written."""
import json


def reserve_phase(base, feature_ids, review_path):
    forbidden = [base / 'summary.json', base / 'review-test-executions.json', base / 'previous-handoffs']
    forbidden.extend(base / (feature_id + '.json') for feature_id in feature_ids)
    assert not any(path.exists() for path in forbidden), 'Partial phase exists: inspect; never overwrite historical snapshots.'
    # x is atomic across processes. Keep this receipt after success or failure;
    # any retry must be a separately reviewed new phase directory.
    with (base / 'apply-reserved.json').open('x') as receipt:
        json.dump({'oneShotReservation': True, 'reviewPath': review_path}, receipt)
        receipt.write('\n')
