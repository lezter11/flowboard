# API contract v0.3

Status: feature-level contract for implementation; no endpoints are running. This supersedes workspace-wide visibility, card archive-only deletion, and deferred images/imports in v0.2. [FEATURE_SPEC.md](FEATURE_SPEC.md) owns product flows, permissions and lifecycle. [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md) owns delivery IDs. Generate validated schemas/OpenAPI in FND-02 before feature handlers; login-provider routes require the identity compatibility decision.

## Common rules

Prefix /api/v1, same-origin JSON and verified cookie session. Strict Origin/CSRF checks on domain writes. IDs are opaque; derive actor from server session, never client identity headers. UTC timestamps; date-only deadlines as YYYY-MM-DD. Unknown fields fail validation; PATCH omitted means unchanged, null clears only nullable fields. Lists: {data:[],nextCursor:null|string}; resources: {data:resource}; related display identities may be included as people:[PersonDisplay]. Counts always state their filter/archive/trash scope. Default list size 50, maximum 100; stable cursors bind project/filter/order/snapshot.

Errors: {error:{code,message,requestId,details?}}. 400 malformed; 401 invalid session; 403 insufficient role inside a visible project; consistent 404 for unknown/inaccessible project/resources; 409 stale version/cursor/preview/idempotency or domain conflict; 410 expired restore/preview only to authorized administrators; 413 upload/body too large; 422 invalid fields/relationships; 429 `TOO_MANY_REQUESTS` with `Retry-After` when a per-client-IP limit refuses. Exact one-minute limits (PostgreSQL, fail closed) apply to Google sign-in (10), invitation create (10), import preview and commit (5), and image upload and finalize (10); `Retry-After` is the seconds left in the window. General writes have an approximate per-location soft limit (60 per minute, `Retry-After: 60`; a limiter fault lets the request through). Health is never limited. A limiter that cannot read its count returns 503 `SERVICE_UNAVAILABLE` with `Retry-After: 1` on the sensitive routes. Never expose SQL/token/internal object details. Private API and image responses are no-store.

Body caps (B-7, FB-AUD-08): every request is capped at 1 MiB (413 `PAYLOAD_TOO_LARGE`) except two routes, and those only for a request carrying a session cookie: `POST /boards/:bid/imports` and `/card-imports` (5 MiB file) and `PUT /image-uploads/:uid/content` (10 MiB image). The body cap is the file cap plus a 64 KiB multipart allowance; the parser and validator still enforce the exact file limits. An anonymous request keeps the 1 MiB cap, so it cannot make the Worker buffer a large body before auth.

All domain mutations require Idempotency-Key (exception: PUT /session/last-location, a personal value set that is idempotent by nature, so it takes no key), 16–128 ASCII characters A–Z/a–z/0–9/._:-. Scope actor+project+key where project exists, actor+workspace for workspace administration, actor+key for workspace creation/invite acceptance. Hash normalized method/path and canonical validated JSON; sorted object keys, preserved array order, omitted distinct from null. Successful receipt retention at least seven days; clients stop automatic retries within 24 hours. After purged receipt expiry a key may be new; no indefinite replay guarantee. Identical intent replays minimal operation outcome; changed hash conflicts. Recheck current ownership/project access before replay. Logout always clears cookie/revokes session and returns 204 even if already expired, without needing a receipt.

Persist receipt outcome as resource IDs, versions, operation/status metadata, not deleted content copies. Mutation response: {data:{id,version?,structureVersion?,snapshotVersion?,operationId},replayed:boolean}. Client refetches canonical resource/list after success, including replays; older receipt metadata must not overwrite a later server state. No raw descriptions/comment bodies/image bytes in receipts. Upload bytes bind a digest instead of hashing unbounded raw body inside the transaction.

## Authorization model

**Revision pending implementation:** the user has selected separate per-board grants for non-Owners, Owner-only board-grant administration, and no automatic grants for existing project members. Project Managers may create boards. See [board-access decisions](handoffs/proposals/board-access-decisions-2026-10-27.md). The route descriptions below document the older implemented project-inheritance behavior until the full authorization cutover is completed; they must not be treated as the new access contract or as deployment approval.

Exactly one workspace owner has access to all owned projects. project_memberships stores role manager/member/viewer, active/removed status and version. Workspace membership alone is not project access. The workspace owner is included as an eligible project person without requiring an accidental blanket grant for other workspace users. Every child query joins/checks workspace/project/board ancestry. Owner invited elsewhere receives only the destination grant.

Manager configures its project/boards, invites/changes/removes member/viewer, trashes/restores cards, moderates and imports. Only owner creates/archives projects, appoints/removes managers and transfers ownership. Member creates/edits/moves cards, comments and uploads, without administration/trash/import. Viewer reads granted project cards/history/images only. [Full matrix](FEATURE_SPEC.md#2-people-projects-and-permissions). No project manager can modify peer manager/owner grants.

Grant check and mutation serialize under a common lock order: owner/workspace or project grant guard, project state, board coordination row, sorted cards. Revocation winning first denies the later write; write winning first records its event before revocation. Do not hold locks while parsing/uploading/sending email. Active-project/board guards also stop writes after archive. Reads authorize at the request, not via a stale cache.

## Account, project and invitations (S1)

| Method and route | Input/result and authority |
|---|---|
| GET /session | Actor, ownerships and accessible-project summaries; no sibling-project details. Adds optional `lastLocation`: `{projectId, boardId\|null}` or `null`. `null` also when the stored project or board is no longer readable (revoked, archived, deleted); access is re-checked on every read, so a stale id is never returned |
| PUT /session/last-location | Body `{projectId, boardId?: string\|null}` (strict; unknown fields 422). Returns 200 `{data:{projectId,boardId}}`. Owner, or an active member with a board grant for `boardId`; otherwise 404 `NOT_FOUND` (`Project not found.` / `Board not found.`) and no write. Archived projects and boards are not accessible. An unchanged value writes no row. No Idempotency-Key: the call sets a value rather than creating one, and repeating it is harmless |
| PATCH /session/profile (B-9) | Body `{displayName}` only (strict; any other field, including avatarUrl or email, is 422). Trimmed, 1 to 80 characters, no control characters (checked before trim). Returns 200 with the actor. Only the signed-in user's own name; no Idempotency-Key, since setting a value is idempotent. Email and avatar are Google-owned: Google sign-in keeps a non-empty edited name and refreshes the avatar. The users row has no version column, so this is last-writer-wins. Rate-limited by the general write limiter |
| POST /session/logout | Revoke and clear cookie; 204 |
| GET /auth/google (alias /auth/google/start) | Starts Google sign-in (302). Optional `?next=` is a same-app path only: starts with one `/`, no `//`, backslash, scheme, control character or `%`; max 300 characters; path must be one of /projects, /project, /board, /activity, /trash, /people, /inbox, /my-tasks, /settings, /import, /add-card, /all-work, /invitation, /invitations/accept (or below them); query limited to `A-Za-z0-9_=&.-`. Anything else is dropped silently. The value travels in the HttpOnly state cookie and is validated again at the callback, which redirects to it (prefixed with `FRONTEND_URL` when set) or to /projects |
| GET/POST /workspaces | List owned/access-relevant containers; create {name,timezone} and owner atomically |
| PATCH /workspaces/:wid | Owner updates name/timezone with expectedVersion |
| POST /workspaces/:wid/transfer-owner | Current owner, target eligible account, expectedVersion; atomic last-owner protection (S6) |
| GET/POST /workspaces/:wid/projects | List only owned/granted projects; create owner-only {name,description?} |
| GET/PATCH /projects/:pid | Owner/grant read; owner/manager edit name/description+expectedVersion; owner only for `defaultBoardId` (B-3) |
| Database (B-7, migration 0015) | project_links(project_id, workspace_id) references projects(id, workspace_id): a link cannot name another workspace's project (FK 23503) |
| GET /projects/:pid/overview | Any active member (owner or any role). Real counts over readable boards only: active cards by column category, overdue and due-soon (open cards, same rule as the board snapshot), unassigned open, open cards per assignee (max 50), last 10 activity rows (board rows on readable boards; project-scope rows only for owner and managers, B-6), and readableBoardCount. Archived boards excluded for everyone. Unreadable boards contribute nothing; no names, ids or counts of them. No percentages |
| PATCH /projects/:pid `brief` / `links` | Owner/manager with expectedVersion. brief: plain text, max 5000, null clears. links: the whole list, max 10, each {title 1-100, url}; url must be https with no username or password, max 2000 characters, no whitespace; [] removes all. GET /projects/:pid returns brief and links to any member; list endpoints omit them |
| PATCH /projects/:pid `defaultBoardId` | Owner only: a board id in this project (404 if not, 422 `BOARD_ARCHIVED` if archived), or null to clear; body needs expectedVersion. Managers get 403 even in the same request as a name change. Read back only when the caller can read that board (owner, or active board grant, and not archived); otherwise null |
| POST /projects/:pid/archive or /reopen | Owner-only, expectedVersion; archive read-only, deadlines continue (S6) |
| GET /projects/:pid/people | Active eligible people, query/purpose=display,assignee,mention, cursor; purpose changes eligibility, not authorization |
| GET /projects/:pid/members | Owner/manager administration view, paginated status/role/version; no global directory |
| POST /projects/:pid/invitations | {email,role}; owner manager/member/viewer, manager member/viewer only; durable email intent. Limits (B-7): per IP 10/min, per inviter 20/min and 200/h, per project 30/min and 300/h; refusal 429 TOO_MANY_REQUESTS with details.retryAfterSeconds; limiter outage 503. Email (B-7, contracts `isValidInvitationEmail`): one plain address, trimmed and lowercased, at most 254 characters; refused: control characters (CR, LF, tab), spaces, non-ASCII, display-name forms such as `Name <a@b.c>`, quoted parts, local part over 64, domain over 255, leading, trailing or doubled dots |
| GET /projects/:pid/invitations | Owner/manager scoped states; never raw token/hash |
| POST /invitations/accept | Verified matching signed-in email + single-use token; safe wrong/expired/revoked state |
| POST /projects/:pid/invitations/:iid/resend or /revoke | Owner/manager within role authority; resend rotates token and prior token fails |
| PATCH /projects/:pid/members/:uid | {role,status,expectedVersion}; owner any grant, manager member/viewer only |
| POST /projects/:pid/leave | Actor leaves own grant; owner cannot leave ownership |

Invitation tokens are random/hashed/expiry-checked; initial expiry proposal seven days. Email verification must come from chosen identity provider or explicit verification flow; unverified identity never accepts an invitation. User-facing login/callback/account-profile routes follow the selected auth adapter, not invented insecure custom passwords. Invitation delivery has production email adapter, local synthetic sink and inspectable retries; no public test-token bypass.

## Core resources and validation

Card: id,workspaceId,projectId,boardId,columnId,title,description,priority,dueDate,assigneeIds,position,version,state(active|trashed|purged),deletedAt|null,deletedBy|null,restoreUntil|null,createdAt,updatedAt. Purged rows expose only authorized tombstone metadata, never a full Card body. Details include finalized image metadata and paginated discussion/activity links.

CardSummary: id,boardId,columnId,title,priority,dueDate,assigneeIds,position,version,commentCount,imageCount,createdAt,updatedAt. PersonDisplay: id,displayName,avatarUrl|null,activeInProject. Each response includes only referenced/eligible display identities; removed authors remain historical, without email/global directory leakage. Invitation/import email resolution is separately privileged and server-side.

Title trimmed 1–200; description ≤20,000; comment trimmed 1–10,000; column name trimmed 1–80 and unique after case normalization; priority none/low/medium/high/urgent; up to 20 distinct eligible assignees/mentions; real Gregorian due date or null. Assignees active owner/manager/member; mentions active eligible project readers. Field limits apply to API and importer through shared validators.

Comment: id,projectId,cardId,authorId,body,mentions:[{userId,start,end}],version,createdAt,updatedAt,deletedAt|null. Mention offsets are UTF-16 code units with no overlap/surrogate split; validate selected token boundaries and project eligibility. Literal at-name text does not notify. Edits do not re-notify in v1. Tombstones hide removed body/mentions. B-9: a mention of a user who cannot read the card's board (not a member, removed, another project, no board grant, or not existing) is refused with 422 VALIDATION_ERROR and the same message; the id is not echoed, so the response does not reveal who exists. Notifications are re-checked on every read: a recipient who loses membership, the board grant, or sight of an active card no longer sees the notification, its title or its snippet, and cannot mark it read.

## Boards and columns (S2)

| Method and route | Behavior |
|---|---|
| GET/POST /projects/:pid/boards | Read granted project; owner/manager creates {name, description?} with five default columns atomically (Not started, In progress, Testing, Blocked, Completed; new boards only). description is optional plain text, max 2000, null when omitted |
| PATCH /boards/:bid | Owner only (B-3): {name?, description?, expectedVersion}, at least one of name/description; null clears description. Manager with a board grant gets 403; grantless user 404; member/viewer 403 |
| POST /boards/:bid/archive or /reopen | Owner/manager, expectedVersion, read-only archive (S6) |
| GET /boards/:bid | Consistent bounded snapshot with filter/count contract below |
| GET /boards/:bid/cards | columnId, title query, priority, assigneeId, due, cursor, limit; canonical active order |
| POST /boards/:bid/columns | Owner/manager {name,color,category,expectedBoardVersion}; max 12 columns |
| PATCH /boards/:bid/columns/:cid | Owner/manager field edit + expectedBoardVersion |
| POST /boards/:bid/columns/reorder | Owner/manager complete column-ID order + expectedBoardVersion |
| DELETE /boards/:bid/columns/:cid | Owner/manager expectedBoardVersion; reject final column or active/restorable references |
| GET /boards/:bid/columns/:cid/placement | movingCardId, at=first|last|before|after, optional anchorCardId; bounded canonical neighbors + structureVersion |

Snapshot: {board:{id,workspaceId,projectId,name,structureVersion,snapshotVersion},filters,asOfDate,totals:{activeCardCount,matchingCardCount},columns:[{id,name,category,color,position,activeCardCount,matchingCardCount,cards:CardSummary[],nextCursor}],people:PersonDisplay[]}. Maximum 12 columns; cardLimitPerColumn default 10, range 1–15, at most 180 returned summaries. Counts exclude trash; active counts ignore filters, matching counts apply all filters to the whole authorized active set. No inferred business progress percentage.

Read multi-query snapshots under short read-only Repeatable Read, or one proven consistent statement. structureVersion changes on card create/move/delete/restore or column changes. snapshotVersion changes for any displayed/filter/count-affecting card/column/comment/image update. Cursor binds scope/filter/snapshot; stale returns 409 STALE_CURSOR. Later pages do not hold a transaction open.

## Card fields, movement and discovery (S2)

| Method and route | Behavior |
|---|---|
| POST /boards/:bid/cards | Owner/manager/member title,columnId,optional fields,expectedBoardVersion; append, create once |
| GET /cards/:cid | Full active card and referenced display identities; project authorizes independently |
| PATCH /cards/:cid | Editable fields + expectedVersion; excludes ancestry, creator, position and lifecycle |
| POST /cards/:cid/move | toColumnId, previousCardId|null, nextCardId|null, expectedVersion, expectedBoardVersion |
| GET /projects/:pid/cards/search | Bounded active title/filter query, project-only |
| GET /me/tasks?projectId=:id | Actor assignments within the selected accessible project only; explicit board grants still apply |

Both null neighbors mean empty destination. First uses next=first, previous=null; last uses previous=last, next=null; exclude moving card and verify adjacency/correct board. Rank is server-owned and compaction guarded. Filtered views use placement+Move menu and disable ambiguous drag. Undo (S6) is a new normal move under current versions, not a state overwrite. Save affects fields only; comment posting and uploads are independent.

## Discussion, activity, inbox and jobs (S3)

| Method and route | Behavior |
|---|---|
| GET/POST /cards/:cid/comments | Project readers list; owner/manager/member post {body,mentions}; same-transaction event/outbox/receipt |
| PATCH /comments/:id | Author edit {body,mentions,expectedVersion}; valid project writer; owner/manager moderation is delete, not impersonated editing |
| DELETE /comments/:id | Author or owner/manager, expectedVersion; tombstone + audit fact |
| GET /cards/:cid/activity | Active project readers; stable chronology, safe field/move/comment/lifecycle facts |
| GET /projects/:pid/activity | Owner/manager; filters card/actor/action/date/cursor |
| GET /workspaces/:wid/activity | Owner-only cross-project feed + ownership/access events |
| GET /notifications | Actor-only, reauthorize project, redact/hide lost-access references |
| POST /notifications/:id/read | Actor-only idempotent read marker |

### Activity action names (B-5)

Every write below records one activity_log row in the same transaction as the write. A failed write records nothing, and an idempotent replay records nothing new. The `action` value is listed in `ACTIVITY_ACTIONS` (packages/contracts). The UI maps each name to text.

| Action | Written by | Scope | Who reads it in GET /projects/:pid/activity | Suggested text | safeChanges |
|---|---|---|---|---|---|
| board_created | POST /projects/:pid/boards | board (new board) | Owner, or a grant holder on that board | created a board | name |
| board_renamed | PATCH /boards/:bid (name) | board | Owner, or grant holder | renamed a board | name |
| board_described | PATCH /boards/:bid (description) | board | Owner, or grant holder | changed a board description | cleared (bool); text never logged |
| board_archived | POST /boards/:bid/archive | board | Owner, or grant holder | archived a board | name |
| board_reopened | POST /boards/:bid/reopen | board | Owner, or grant holder | reopened a board | name |
| default_board_changed | PATCH /projects/:pid (defaultBoardId) | board on the new board; project when cleared | Owner, or grant holder; project-scope rows: owner/manager | changed the default board | defaultBoardId |
| column_added | POST /boards/:bid/columns | board | Owner, or grant holder | added a column | columnId, name, category |
| column_renamed | PATCH /boards/:bid/columns/:cid (name) | board | Owner, or grant holder | renamed a column | columnId, name |
| column_recoloured | PATCH column (color) | board | Owner, or grant holder | recoloured a column | columnId, color |
| column_recategorised | PATCH column (category) | board | Owner, or grant holder | changed a column's category | columnId, category |
| columns_reordered | POST /boards/:bid/columns/reorder | board | Owner, or grant holder | reordered columns | columnIds |
| column_deleted | DELETE /boards/:bid/columns/:cid | board | Owner, or grant holder | deleted a column | columnId, name |
| project_brief_updated | PATCH /projects/:pid (brief) | project | Owner, manager | edited the project brief | cleared (bool); text never logged |
| project_links_updated | PATCH /projects/:pid (links) | project | Owner, manager | edited project links | count |
| invitation_sent | POST /projects/:pid/invitations | project | Owner, manager | sent an invitation | invitationId, role (no email, no token) |
| invitation_resent | POST invitation resend | project | Owner, manager | resent an invitation | invitationId, role |
| invitation_revoked | POST invitation revoke; also revoked as a side effect of member removal or leave | project | Owner, manager | revoked an invitation | invitationId, role, reason (absent on a direct revoke; member_removed or member_left otherwise) |
| invitation_accepted | POST /invitations/accept | project | Owner, manager | accepted an invitation | invitationId, role |
| member_role_changed | PATCH /projects/:pid/members/:uid (role changed) | project | Owner, manager | changed a member's role | userId, fromRole, toRole |
| member_removed | PATCH (status removed) or DELETE member | project | Owner, manager | removed a member | userId, role |
| member_reinstated | PATCH (status back to active) | project | Owner, manager | reinstated a member | userId, role |
| member_left | POST /projects/:pid/leave | project | Owner, manager | left the project | userId, role |

Scope rules. Board rows are visible to the owner and to members who hold a grant on that board. Project rows are visible only to the owner and managers, in the feed and in the overview's recentActivity (B-6). Members and viewers never see them in either place. No row ever carries an invitation token, a token hash, or an invitee email address.

Decisions: managers read project-scope rows in the Activity page (FEATURE_SPEC AUD-04; B-5). Owner and managers also see them in the overview's recentActivity (B-6). The overview keeps its last-10 cap and one query, and still excludes unreadable boards.

No user audit-edit API. Sensitive body copies/tokens are excluded or redacted under FEATURE_SPEC retention. Outbox/invitation dispatcher uses versioned events, leases/fencing, bounded retries/jitter and failed-work replay with operator authorization. Job completion/notification insertion in one DB can be atomic; external email cannot be recalled or declared exactly once.

## Private images and trash (S4)

| Method and route | Behavior |
|---|---|
| POST /cards/:cid/image-uploads | Authorized writer, filename,byteLength,contentType,sha256; allocate private uploadId/expiry and authenticated upload path |
| PUT /image-uploads/:uid/content | Authenticated bounded binary body; verify project/card scope and actual digest; stage only |
| POST /image-uploads/:uid/finalize | Reauthorize active card and valid verified bytes; attach once or report validating/failed; no false saved image |
| GET /image-uploads/:uid | Actor/project-authorized validation/progress state; no raw credential disclosure |
| DELETE /image-uploads/:uid | Uploader/owner/manager cancel pending upload; durable orphan cleanup |
| GET /cards/:cid/images | Authorized active-card finalized metadata, bounded cursor |
| GET /images/:iid/content or /thumbnail | Authenticated proxy, current project/card visibility check, safe content type/disposition, private/no-store |
| DELETE /images/:iid | Uploader or owner/manager, expectedVersion; detach + activity and retryable cleanup |
| POST /cards/:cid/delete | Owner/manager {expectedVersion,expectedBoardVersion}; soft delete with server restoreUntil |
| GET /projects/:pid/trash | Owner/manager; trashed metadata, actor, restoreUntil and state |
| POST /cards/:cid/restore | Owner/manager {expectedVersion,expectedBoardVersion,toColumnId?}; exact cutoff, safe placement |

PNG/JPEG/WebP only; proposed 10 MiB each/10 finalized per card/20 megapixels/8192 max dimension. Verify actual content; no SVG/HTML/arbitrary files or remote URL fetching. Use a private storage adapter, no public bucket or reusable URL bypassing current access. Presigned URLs are not the v1 authorization path. Bytes live in the private R2 bucket bound as `IMAGES` (B-7, FB-AUD-01). Deployment needs: a private R2 bucket (no public access, no r2.dev or custom public domain) named per environment, bound to the Worker as `IMAGES`. Without that binding every image route returns 503 `CONFIG_ERROR` before any database write, so no image is ever recorded without bytes.

State active → trashed → restored active OR purged. restoreUntil=server deletedAt+24h; restore strictly before cutoff. At/after cutoff, authorized administrator gets 410 RESTORE_WINDOW_EXPIRED even with delayed cleanup. Nonadministrator normal card reads stay private/not-found. Restore preserves same ID/content/comments/finalized files; unavailable original destination needs explicit active target, not silent relocation. Project/board archive must be reopened before restore there. Restore/purge are fenced conditional winners. Purged cards retain only a placeholder title and minimal audit/duplicate markers; descriptions, comment bodies, notification copies and images are removed. Object deletion uses durable retry keys after the purge transition, so a temporary storage failure cannot erase the key needed to retry. No immediate permanent-delete or card-archive API in v1.

## Excel imports (S5)

| Method and route | Behavior |
|---|---|
| GET /boards/:bid/card-import-template | Owner/manager, versioned seven-column XLSX; default labels/instructions for board; do not expose global member emails |
| POST /boards/:bid/card-imports | Owner/manager multipart XLSX + defaultColumnId; verify project, stage input and return 202 with importId/status link if validation async |
| GET /card-imports/:iid | Owner/manager, state/counts/digest/expiry and bounded preview row cursor; no cards created yet |
| POST /card-imports/:iid/mappings | Owner/manager explicit source-status → existing column IDs; revalidate and refresh preview digest |
| POST /card-imports/:iid/commit | Owner/manager previewDigest + Idempotency-Key; recheck all eligibility/state and atomically create new rows |
| DELETE /card-imports/:iid | Owner/manager cancellation only before committing; no fake cancellation after commit begins |
| GET /card-imports/:iid/report | Authorized result metadata/row outcomes/card links, safely escaped export |

[IMPORT_SPEC.md](IMPORT_SPEC.md) owns exact headers, dates, 200-row/size proposals, formula/macro/package rejection, explicit preview, expiry, cleanup and original-row hash duplicate semantics. Same source ID is not an update; neither trash nor purge can be bypassed by re-upload. All-or-nothing new-card commit; no hidden valid-row partial import. Parser/runtime/library choice needs compatibility and resource tests.

## Compatibility and delivery gates

### Explicit UI-facing lifecycle shapes

Project people: `{data:PersonDisplay[],nextCursor}` where PersonDisplay additionally includes scopedRole(owner|manager|member|viewer), assignable:boolean and mentionable:boolean when the request is a picker. `activeInProject` is true for the active workspace owner or a valid active project grant. Historical referenced people may be inactive, but picker responses exclude them. Do not include unverified/global email addresses; privileged invitation/import resolution has separate validation.

Trash list: `{data:TrashRow[],nextCursor,serverNow}`. TrashRow is `{id,title,projectId,boardId,originalColumnId,version,structureVersion,deletedAt,deletedBy,restoreUntil,canRestore,blockedReason|null}`. Referenced actors use related PersonDisplay. `serverNow` and deadlines are UTC instants; browser countdown uses the server offset as guidance and never authorizes recovery. `blockedReason` enumerates `window_expired`, `project_archived`, `board_archived`, `destination_missing`. A 410 RESTORE_WINDOW_EXPIRED returns authorized `{serverNow,restoreUntil}` details. A 409 RESTORE_DESTINATION_REQUIRED returns `{reason,boardId}`; UI queries that board's active columns for explicit choice. A 409 READ_ONLY_CONTEXT identifies project/board archive and the authorized reopen action. No cross-board restore in v1; reopen the original context if required. Role loss remains 404/403 rather than a misleading restore destination error.

ImageUpload: `{id,projectId,cardId,version,state,expectedBytes,receivedBytes|null,expiresAt,serverNow,finalizedImageId|null,error|null}`. Server states `awaiting_content`, `content_received`, `validating`, `finalized`, `failed`, `cancelled`, `expired`. Browser byte-transfer progress is separate from server validation; no invented validation percentage. Error is `{code,message,retryable}` with bounded safe text. Content retry uses the same upload ID and digest; finalize retry is idempotent. Finalize returns 202 with status URL while validation runs; the gallery shows finalized objects only. Cancel after finalized returns 409 ALREADY_FINALIZED and directs the user to the normal image removal action. Reauthorization and active-card checks apply at every state-changing step.

ImportStatus: `{id,projectId,boardId,defaultColumnId,version,state,previewDigest|null,expiresAt|null,serverNow,counts:{total,new,existing,invalid,conflict,created,skipped},canCommit,cancellationAllowed,rows:ImportRow[],nextCursor,error|null}`. States exactly `uploaded`, `validating`, `invalid`, `ready`, `committing`, `committed`, `failed`, `cancelled`, `expired`. ImportRow is `{rowNumber,externalId,title,status,priority,dueDate,assigneeIds,outcome,errors:[{field,code,message}],cardId|null}`; outcome is `new`, `already_imported`, `invalid`, `conflict`, `created` or `skipped`. Authorized preview includes safe description excerpt if requested; do not persist it in a permanent receipt/report. Counts cover the whole batch, rows are paginated. Commit requires expected import version and previewDigest. A lost commit response is resolved through GET status and the same-key retry, never by making a new import blindly. Cancellation after `committing` returns 409 COMMIT_IN_PROGRESS with status URL; terminal committed remains committed. Expired preview returns 410 PREVIEW_EXPIRED, no new cards. Mapping changes increment import version and invalidate its prior digest. These shapes become validated shared schemas in FND-02 before corresponding handlers/UI are built.

Before feature handlers, shared schemas/OpenAPI/fixtures must cover two workspaces, sibling projects with different roles, owner invited elsewhere, manager of only one project, removed user, read-only board, unseen pages, historical authors, comment/attachment counts, invalid dates/mentions, exact cutoff, restore/purge race and repeated import. Preserve all original engineering controls while adding project-specific scope. Historical SQLite tests do not prove this PostgreSQL model. Each feature's evidence and UI readiness is recorded through [handoffs](handoffs/README.md).
