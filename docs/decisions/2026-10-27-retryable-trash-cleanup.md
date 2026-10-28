# Retryable cleanup after card purge

## Decision

Commit the card's `purged` state, private-content redaction, and object-storage keys for deletion in one PostgreSQL transaction. A scheduled worker claims cleanup keys with a short expiring lease, commits the claim, and calls object storage after releasing the database row locks. Success removes the queue row; failure keeps the key, records a capped exponential retry time, and clears the lease. Card and staging-image metadata can therefore be removed without losing the information needed to retry object deletion.

## Why

The 24-hour restore cutoff is a data invariant. After that point a card is no longer restorable even if object storage is temporarily unavailable. Synchronous storage deletion inside the purge transaction would hold database locks over network IO; deleting image metadata after a failed storage call would instead lose the retry key. The queue preserves both properties: the card remains purged, and cleanup can resume later.

Mention notifications carry a structured `card_id`. Purge uses that identity to redact exact notifications, rather than searching URL text where one card ID could be a substring of another. Existing notification links are backfilled by migration 0006.

## Alternatives and tradeoffs

- **Delete storage objects while holding the purge transaction:** simpler flow, but slow storage calls extend locks and a crash can roll back the database after deleting some objects.
- **Delete image rows after a best-effort storage attempt:** shorter-lived code, but a transient failure discards the object key and makes cleanup unrecoverable.
- **Durable key queue with expiring leases (chosen):** adds a table and worker steps; operations are eventually consistent for object bytes, while the card and private database content are purged atomically. Storage deletion must be idempotent so a worker crash after deletion can safely retry.

## Evidence and limits

Migration 0006, the purge worker, and a PostgreSQL regression test cover a simulated first-attempt storage failure followed by successful retry. The full local check and focused BRD/CRD/COM-DEL suites passed on 2026-10-27. Real R2 behavior, production scheduling, long-outage recovery, and performance under a large cleanup backlog remain unverified.
