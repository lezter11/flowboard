# Flowboard Production & UAT Monitoring Guide

This document describes the health endpoints, the alert thresholds we intend to use, and the checklist before production cutover, for Flowboard on Cloudflare Workers and Neon PostgreSQL.

> **Scope & Safety Constraint**: This document contains guidance, contracts, and checklists only. No third-party or Cloudflare monitoring resources are created by automated agents. Items marked **Planned** are not implemented in the code and have no data source yet.

---

## 1. Health & Probing Endpoints

The health routes are mounted on the **API Worker**, at the root (not under `/api`). The Pages site proxies only `/api/*`, so probes must target the Worker host.

| Environment | Worker host (probe target) | Frontend (for users, not probes) |
| :--- | :--- | :--- |
| Production | `https://flowboard-api.web-app-cloud.workers.dev` | `https://flowboard-app.pages.dev` |
| UAT | `https://flowboard-api-uat.web-app-cloud.workers.dev` | `https://flowboard-app-uat.pages.dev` |

Source of the hostnames: `docs/RELEASE_BETA.md` (production Worker) and the UAT deploy runbook. The Worker names are in `apps/api/wrangler.jsonc` (`flowboard-api`, and `flowboard-api-uat` under `env.uat`).

| Endpoint (on the Worker host) | Auth Required | Purpose | Response |
| :--- | :--- | :--- | :--- |
| `GET /health/live` | **None** (Public) | Process liveness. Verifies the Cloudflare Worker runtime is responding. | `{"data":{"status":"ok"}}` (200) |
| `GET /health/ready` | **None** (Public) | Deep dependency readiness. Executes a live `SELECT 1` through Hyperdrive to PostgreSQL. | `{"data":{"status":"ready"}}` (200) or `503 DATABASE_UNAVAILABLE` |
| `GET /api/v1/system/status` | **Admin secret** (`x-dev-secret` header) | Diagnostic state: applied migrations, schema version, outbox queue lag. | `{"data":{...}}` (200), `403 FORBIDDEN` |

### Probe settings

- **Target**: `GET /health/ready` on the Worker host above. Do not use `flowboard-app.pages.dev/api/v1/health/ready`; no such route exists.
- **Interval**: production every **5 minutes**; UAT every **15 minutes**. Each probe runs one `SELECT 1` through Hyperdrive and holds a database connection while it runs, so a one-minute public probe would add about 1,440 queries a day for no extra signal. A one-minute interval can be used for a short incident window only.
- **Secrets**: none for the public probe. Keep `/api/v1/system/status` out of third-party uptime tools, because they store the request headers.

### Admin secret naming

`/api/v1/system/status` is protected by a secret stored in the Worker as `DEV_LOGIN_SECRET`. The name is historical: it is an admin secret for the status route in production, not a development-only value. Rules until Backend renames it:
- Set a high-entropy value on each environment. Do not reuse the development value.
- Never paste it into chat, a ticket, or a probe configuration.
- The route fails closed (403) when the secret is missing.

---

## 2. Alert Thresholds

Thresholds are per environment, because the cron cadence differs.

### 2a. Cron-based checks

| Environment | Cron (from `wrangler.jsonc`) | Warning | Critical |
| :--- | :--- | :--- | :--- |
| Production | `*/5 * * * *` | No successful run for 10 minutes (one missed interval) | No successful run for 15 minutes (three missed intervals) |
| UAT | `*/15 * * * *` | No successful run for 30 minutes (two missed intervals) | No successful run for 45 minutes (three missed intervals) |

Cron health is read from Cloudflare's Cron Trigger metrics. This is a manual check today, not an alert (see 2c).

### 2b. Availability and errors (**Planned**)

| Metric | Target / SLO | Warning | Critical |
| :--- | :--- | :--- | :--- |
| Availability (HTTP 2xx/3xx) | >= 99.9% | < 99.5% over a 30-minute window | < 99.0% over a 60-minute window, and at least 3 failed probes in that window |
| 5xx server errors | < 0.1% of requests | > 1.0% over 15 minutes | > 5.0% over 15 minutes |
| API latency (P95) | < 300 ms | > 500 ms over 30 minutes | > 1,500 ms over 15 minutes |
| Database pool exhaustion | 0 timeouts | > 1 timeout in 15 minutes | Consecutive `503 DATABASE_UNAVAILABLE` on `/health/ready` |

The critical availability window is 60 minutes because a single probe is 1 of 12 samples per hour at production cadence. One failed probe must not page anyone.

### 2c. Implementation status

| Item | Status |
| :--- | :--- |
| `/health/live`, `/health/ready` responses | Implemented (`apps/api/src/http/app.ts`) |
| Cron jobs `purgeExpiredTrash`, `processOutboxLease` | Implemented (`apps/api/src/runtime/worker.ts`) |
| Availability, 5xx rate, P95 latency, pool exhaustion metrics | **Planned.** No metrics source in the code; no dashboard or alert exists. |
| Cloudflare notification rules (Worker exception, 5xx anomaly) | **Planned.** Not configured. |
| External uptime probe | **Planned.** Not configured. |

---

## 3. Scheduled Cron Tasks

Background jobs (`apps/api/wrangler.jsonc` triggers: production `*/5 * * * *`, UAT `*/15 * * * *`):
1. **Trash Purge** (`purgeExpiredTrash`): permanently removes soft-deleted cards and boards past the 24-hour restore window.
2. **Outbox Lease** (`processOutboxLease`): dispatches notifications and claims expired event leases.

### Failure modes
- If cron stops, soft-deleted items accumulate past 24 hours, and notifications stall.
- Inspect runs in the Cloudflare dashboard under **Workers & Pages > flowboard-api (or flowboard-api-uat) > Settings > Triggers > Cron Triggers**. Labels can change; search for "Cron".
- Local check: trigger the scheduled event on the local dev Worker:
  ```bash
  curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
  ```

---

## 4. Pre-Release Operational Checklist

Before cutting over production traffic, verify the following. Items are unchecked until someone has done them.

- [ ] **External health probe configured** (**Planned**): probe `GET https://flowboard-api.web-app-cloud.workers.dev/health/ready` every 5 minutes; probe UAT at `https://flowboard-api-uat.web-app-cloud.workers.dev/health/ready` every 15 minutes.
- [ ] **Cloudflare notification rules active** (**Planned**):
  - Worker exception alert enabled in the Cloudflare dashboard.
  - HTTP 5xx rate alert configured.
- [ ] **Neon connection monitoring**:
  - Neon console compute metrics checked for the active connection ceiling.
  - Hyperdrive query latency observed during the initial load.
- [ ] **Rollback anchors verified**:
  - Pre-cutover Worker version ID and Pages deployment ID recorded in `docs/RELEASE_BETA.md`.
  - Neon backup branch point confirmed active.
