# Import round 2 — failed acceptance on the held target

Source: 615-file manifest `5c6185a69d2d0fa89a32962b6f672a1bc09877e66592e0b7568f98d35769c3c8`. Initial and final comparisons matched every hash. Application source was read-only. The previous failed round remains preserved.

The structural parser repairs all six original findings: every unchanged original workbook now satisfies its expected mounted HTTP outcome, with exact legal title/description persistence checked in real PostgreSQL. `original-probes.log` is **15 tests, 15 pass, 0 fail, 0 skip**. Each original positive case used its own random schema, removing the duplicate-ID confound in the first review. No original fixture was rewritten.

Additional tests expose three mandatory defects:

1. A cell outside `inlineStr` can contain unrecognized, foreign-namespace or mixed string children. The parser reads only its selected `<v>` and silently discards other nonempty content. The nonempty source description becomes empty in two cases, while mixed content becomes only `Visible`. All return201/ready rather than422. Inner rich-text namespace guards correctly reject unsupported children; the missing validation is at the enclosing cell boundary.
2. After real commit and scheduled cleanup simulated at+31minutes, the receipt returns200 with `externalId:''` and `title:''`. Both violate the current shared ImportStatusResponse schema. The UI creates its retained card link using that empty title, so it has no text label. Privacy cleanup must remain; a typed minimal/redacted row and a safe label can preserve usable provenance without restoring private source content.
3. An ordinary invalid preview with a missing required title returns201/invalid and the correct row error, but cannot be represented by the current shared schema because title has `min(1)`. The same modeling issue affects invalid field lengths/identities. Invalid raw preview rows and redacted retained rows need explicit valid representations; broad success-card validators cannot describe all preview states.

The first extension run records11 tests:6pass/5fail/0skip. Four failures are product failures; one encoded-URL case was a no-op fixture mutation and is explicitly rejected as test error. A corrected fixture genuinely changes the relationship target to an entity-encoded external URL and is rejected422. The corrected two-test run records1pass/1fail/0skip; the remaining failure is the invalid-preview contract. Thus the confirmed package/namespace/CDATA/depth guards remain credited, and no new external-link bypass is alleged.

The commands used a shell wrapper ending in `tail`; its observed exit code was0, while the inner failing Node command's numeric exit status was not separately retained. The complete Node failure counters/assertions are preserved and are sufficient to establish failure, but are not represented as an exact captured inner exit code. No failed command is called a passing acceptance gate. The original15/15 counts are likewise reported as observed log counts.

## Complete feature trace

| Feature | Reachable source and acceptance coverage | Round 2 outcome |
|---|---|---|
| IMP-01 | Embedded official template, authenticated aliases, blank Cards/Instructions layout, existing Node/Worker template tests, unchanged genuine workbook | Original template compatibility supported; complete required gate not finished |
| IMP-02 | Mounted upload route; identity/origin/body limits; assertImportAccessBeforeParse; Owner/Manager project+board grants; destination/default-column validation | Bound destination and role guards traced; no new bypass confirmed |
| IMP-03 | New import-xml.ts; package content types/relationships/profile; strict UTF decoding; namespaces/entities; ZIP CRC/bounds; row/cell/text/depth/time limits | All original security/encoding/package cases pass; unsupported outer cell structure remains a mandatory validation gap |
| IMP-04 | Shared field contracts; exact headers; literal fields and description preservation; numeric/date/email errors; parser-to-persisted row mapping | FAIL: outer cell content discarded and invalid rows cannot satisfy the declared response contract |
| IMP-05 | Preview outcomes/counts; no domain effects before confirmation; explicit mappingEntries/Map; inherited keys; paging/digest/version | Genuine preview flow works in root browser evidence; malformed cell structures incorrectly become ready |
| IMP-06 | Current actor grants; recipient locks before board; context/digest/default/version rechecks; durable reservations; all cards/activity/receipt in one transaction | Lock/rollback/source reservation paths traced. Existing real separate-connection tests inspected; interrupted full gate cannot be claimed complete |
| IMP-07 | Board-scoped text identity; original normalized hash; uniqueness; same/different separately ready previews; trashed/purged markers | No new duplicate effect confirmed; corrected literals persist exactly; full independent concurrency rerun pending |
| IMP-08 | Strict Gregorian/1900/1904 date styles; semicolon normalization; current writable project role plus board grant; lock winner/revocation regressions | Source and existing mounted tests support intended behavior; no new date/assignee issue confirmed |
| IMP-09 | Authorized CSV bytes/prefix escaping; row/card result IDs; safe UI links; shared receipt model | FAIL: cleaned receipt violates schema and leaves an empty-label card link |
| IMP-10 | Cancellation before commit; expiry cutoff; bounded SKIP LOCKED cleanup; committed result retention; purge copied rows | Cleanup privacy behavior confirmed; result representation breaks after cleanup. Hosted scheduler remains UAT pending |
| IMP-11 | Persisted initiating and confirming actors; safe historical PersonDisplay; activity/outbox; migration25 bounded lookup; minimal receipt | Provenance facts traced; retained-row contract/UI defect blocks complete receipt acceptance |

Full dependency review follows importsRoutes → app middleware/auth → current board/project authority → imports adapter → parser/template/SQL transaction → activity/receipt/outbox → retention/purge → Next import client state. The new code and pinned fast-xml-parser5.11.2 were read, including one-pass entity decoding, namespace resolution and bounded AST conversion. The source manifest includes runtime entry points, contracts, migrations, tests, lockfile and acceptance inputs. New XML fixtures use the real supplied-template structure, with valid ZIP CRC, rather than replacing it with a disconnected helper demonstration.

## Evidence attribution and limits

The separate foundation executor completed nine commands with exit0 before API started. Its API command was deliberately terminated with SIGTERM when repair became necessary, and four later required commands did not run. Its manifest says source unchanged and status fail. That is incomplete mandatory full-gate evidence, never a pass. I did not issue those commands.

Root's `raw/browser-product-13-context-fixed/result.json` records12passing product flows and unchanged relevant hashes, including actual original-template upload/mapping/preview/commit/card-link/report and a retained-receipt flow. I inspected those bytes as **root execution evidence**. The retained test checked state and that the domain card remained; it did not validate the response schema or accessible link name, so it does not contradict the new finding. No independent browser execution is claimed by me for this round.

Root's npm-ci/offline and sanitized audit evidence are not a substitute for the interrupted required tests. New dependency audit status is attributed to root; I did not conduct an online advisory search or declare dependency risk absent. Real Google, actual R2/Hyperdrive/mail, hosted cron effectiveness and hosted CPU/memory/load remain UAT pending under the user's sequence.

## Rejected candidates and counterevidence

- Entity double decode, rich-run truncation, UTF16false-empty/formula acceptance, invalid scalar500, package rejection and merged cells from round1 now pass the unchanged original probes.
- The encoded-external-URL extension originally changed no bytes. That failure is a fixture mistake. The genuinely mutated fixture422rejects, and no external access is attempted.
- Foreign string children **inside** a supported inline string, duplicate expanded attributes, zero scalar, namespace rebinding and excessive depth all422reject. Mixed normal/CDATA/entity text preserves its original order and literal content.
- No formula execution, SSRF, code execution, cross-project write or privilege escalation is established by these cases.
- Minimal retained rows must not be repaired by copying original private titles/External IDs back after cleanup. A discriminated redacted representation and safe RowN/card-link label fit the existing privacy requirement.

A transaction can preserve every write together and still save a wrong description when the earlier cell reader silently ignores content. The strict XML reader is an improvement, but its surrounding cell validation must reject unsupported representations. Separately, a response contract must describe both an invalid preview and a redacted receipt, not only a valid new card.

Next: repair all confirmed mandatory gaps and project lifecycle version handling, freeze a new complete source, rerun all14required commands and affected mounted/UI flows, then obtain fresh independent review. No feature or UAT approval follows this failed round. No user action needed.
