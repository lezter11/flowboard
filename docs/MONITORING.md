# Flowboard Production & UAT Monitoring Guide

This document establishes the monitoring architecture, health check contracts, alerting thresholds, and operational checklists for Flowboard on Cloudflare Workers and Neon PostgreSQL.

> **Scope & Safety Constraint**: This document contains architectural guidance, contracts, and checklists only. No third-party or Cloudflare monitoring resources are created by automated agents.

---

## 1. Health & Probing Endpoints

Flowboard exposes tiered probe endpoints to balance observability against authorization security:

| Endpoint | Auth Required | Purpose | Response |
| :--- | :--- | :--- | :--- |
| `GET /health/live` | **None** (Public) | Process liveness. Verifies the Cloudflare Worker runtime is responding. | `{"data":{"status":"ok"}}` (200) |
| `GET /health/ready` | **None** (Public) | Deep dependency readiness. Executes a live `SELECT 1` through Hyperdrive to PostgreSQL. | `{"data":{"status":"ready"}}` (200) or `503 DATABASE_UNAVAILABLE` |
| `GET /api/v1/system/status` | **Admin Secret** (`x-dev-secret`) | Detailed diagnostic state: applied migrations list, schema version, outbox queue lag. | `{"data":{...}}` (200) or `403 FORBIDDEN` |

### Architectural Decision Note: Status Probe Authentication
- **Current Security Model**: `/api/v1/system/status` requires the high-entropy `DEV_LOGIN_SECRET` header. Storing admin secrets in public 3rd-party uptime pingers (e.g. BetterStack, Pingdom) poses a credential leakage risk.
- **Recommended Practice**:
  - Configure external synthetic uptime checkers to probe `GET /health/ready` every 60 seconds (zero secrets required; alerts on DB connectivity failure or worker crash).
  - Restrict `/api/v1/system/status` to internal administrative operators and scheduled runbooks.

---

## 2. Core Metrics & Alert Thresholds

| Metric | Target / SLO | Warning Threshold | Critical Alert (Page Operator) |
| :--- | :--- | :--- | :--- |
| **Availability (HTTP 2xx/3xx)** | >= 99.9% | < 99.5% over 5m window | < 99.0% over 5m window |
| **5xx Server Errors** | < 0.1% of total | > 1.0% over 5m window | > 5.0% over 5m window |
| **API Latency (P95)** | < 300 ms | > 500 ms over 10m window | > 1,500 ms over 5m window |
| **Database Pool Exhaustion** | 0 timeouts | > 1 timeout / 5m | Consecutive `503 DATABASE_UNAVAILABLE` |
| **Cron Trigger Execution** | Every 5 minutes | 1 missed interval (10m silence) | 3 consecutive failures (15m silence) |

---

## 3. Scheduled Cron Tasks Monitoring

Flowboard runs background jobs every 5 minutes (`apps/api/wrangler.jsonc` trigger: `*/5 * * * *`):
1. **Trash Purge** (`purgeExpiredTrash`): Permanently removes soft-deleted cards and boards past the 24-hour restore window.
2. **Outbox Lease** (`processOutboxLease`): Dispatches notifications and claims expired event leases.

### Failure Modes & Observability:
- If cron fails, soft-deleted items will accumulate past 24 hours, and email/in-app notifications will stall.
- Operators can inspect Cloudflare Worker Cron metrics under **Cloudflare Dashboard > Workers & Pages > flowboard-api > Triggers > Cron Triggers**.
- For local verification, trigger the scheduled event via:
  ```bash
  curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
  ```

---

## 4. Pre-Release Operational Checklist

Before cutting over production traffic, verify the following operational controls:

- [ ] **External Health Check Configured**: External pinger pointing to `https://flowboard-app.pages.dev/api/v1/health/ready` (or proxied equivalent) every 60s.
- [ ] **Cloudflare Notification Rules Active**:
  - Worker Exception Alert enabled in Cloudflare Dashboard.
  - HTTP 5xx rate anomaly alert configured.
- [ ] **Neon Connection Pool Monitoring**:
  - Neon Console compute metrics checked for active connection ceiling.
  - Hyperdrive query latency monitored during initial load.
- [ ] **Rollback Anchors Verified**:
  - Pre-cutover Worker version ID and Pages deployment ID documented in `docs/RELEASE_BETA.md`.
  - Neon backup branch point confirmed active.
