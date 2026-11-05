# MCP prompt help and production promotion — 2026-11-05

User reports the hosted UAT Claude connector worked and explicitly requests a sample card prompt, UAT update and production promotion. This authorizes production deployment; the previous UAT-only scope is superseded for this release. Preserve all historical evidence.

## Scope and acceptance established before implementation

- Reuse Settings → Connections: selectable, copyable plain-text sample; accessible clipboard status and manual fallback. No new backend tool or automatic AI submission.
- Include Project, Board, Column/status, Title, Priority, Due date, Assignment and Description. Mark title and unambiguous permitted board/column as required; existing approved project remains the authority boundary.
- Optional priority/date/description match the real tool schema. Assignment is explicitly manual: MCP currently cannot assign a teammate. The AI resolves IDs and must ask about ambiguity; retry guidance preserves the same operation ID/input.
- Preserve all existing five tools, schemas, authorization and application logic. Hosted browser compatibility remains limited by the existing supported-client policy; a prompt does not enable unsupported AI clients.
- Production image verifier configuration must match UAT, because the runtime fails closed when it is missing. Private R2 permissions and safe multipart-only lifecycle remain unchanged; never add the obsolete staging-prefix expiration.
- Focused web/type/build/browser checks and fresh independent review on an exact manifest must pass. Preserve current backend CI/review provenance rather than relabel historical tests as reruns. Run one final candidate CI, avoiding duplicate branch-triggered runs.
- Read live production identity/ledger first; use a fresh production backup before the exact missing reviewed migrations. Never delete backup branches, restore production or copy private production data locally without the required specific authorization.
- Build immutable clean artifacts; UAT first, then production. Record exact previous/new Worker and Pages IDs, source/byte proof, bounded anonymous smoke and scope limits. Owner production sign-in/tool/revoke acceptance is distinct from public smoke.

## Existing beta limitations

D-24 in docs/UAT_DEPLOY.md explicitly accepted neondb_owner runtime and no production uptime alert for the existing beta. Verify current state and retain those limitations; do not claim general availability, least privilege or configured alerts. The new production authorization does not turn those properties into passing evidence.

## Parallel ownership

UI builder owns apps/web plus HOSTED_MCP_QUICKSTART. Preflight agent is read-only and owns preflight.md/preflight receipts. Architect owns production configuration, release operations and operational documentation. Fresh independent reviewer writes only its review/evidence and does not implement the target. No production application records are created by release probes.

## Release checklist

- [x] UAT connector acceptance reported by user (unspecified substeps; no invented refresh/revocation coverage).
- [x] Read-only Cloudflare preflight and production database ledger (19 existing migrations).
- [x] Sample prompt implemented; web344 and real isolated clipboard/layout probes pass, including fresh reviewer checks.
- [x] Fresh independent delta review9.065 and helper review8.79; Architect validators/hash/evidence checks pass.
- [x] Final candidate40e51e1 CI42003364732 all22steps/API1,926/hosted24; clean artifacts and exact dry runs pass.
- [ ] Fresh production backup; exact pending migration preflight and application. Backup creation failed with branch-quota-blocked; explicit permission pending to delete only the named old UAT restore point. No production mutation performed.
- [x] UAT Pages0df2875d upload and bounded smoke17/17; identical UAT Worker retained.
- [ ] Production upload, byte/source verification, smoke and monitoring.
- [ ] Owner production acceptance and concise colleague instructions.
