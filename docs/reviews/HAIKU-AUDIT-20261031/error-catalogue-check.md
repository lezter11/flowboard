# Web error handling check, 2026-10-31

Read-only audit. No source files, servers or databases were touched. The only file written is this one.
Verification labels: **verified** = seen in source or confirmed by grep/arithmetic; **inferred** = reasoned from names or context, not traced end to end.

## Summary

- Contract `ERROR_CATALOG` has 104 codes. All 104 have an explicit entry in `apps/web/src/lib/error-catalogue.ts` (verified). No contract code falls to a class default.
- The web catalogue has 18 keys that are not in the contract. 12 are sent by the API (verified by grep), so the contract is not the complete list of codes the server can send. Two are client-only (NETWORK_ERROR, HTTP_ERROR) and four look dead (BAD_REQUEST, MENTION_NOT_ALLOWED, MENTION_RANGE_INVALID, MOVE_POSITION_CHANGED); see section 1a.
- Server-provided text is rendered raw in 3 places: `app/import/page.tsx:239-240` (Release 2, known) and `app/signin/page.tsx:48,53,90` (dev sign-in, known). Everything else that shows an error goes through the catalogue.
- Generic text still used as error copy: about 15 sites. The literal phrases "Something went wrong", "Request failed", "Error" and "statusText" do not appear in `apps/web/src`.
- Catalogue copy rule checks (no "please", no "successfully", no "!", no ALL_CAPS tokens, no ms/bytes, sentences of 25 words or fewer): 0 violations (verified by grep and word count).
- Accessibility: `ErrorNote` and the toast regions use `role="alert"` or `aria-live`. Four inline error sites have no role. One of them (name-step field errors) is also not linked to its input.

## 1. Catalogue coverage and copy

### 1a. Coverage (verified)

| Check | Result |
|---|---|
| ERROR_CATALOG codes (`packages/contracts/src/common.ts:7-112`) | 104 |
| Contract codes with explicit web entry | 104 |
| Contract codes falling to `byClass` by key | 0 |
| Web keys not in contract | 18 (below) |

Web keys not in the contract:

| Code | Status | Evidence | Note |
|---|---|---|---|
| CONFLICT | 409 | API 12 files (`apps/api/src/http/errors.ts:81,85,194`) | Emitted, not in contract |
| NAME_REQUIRED | 409 | `apps/api/src/http/routes/invitations.ts:90,158` | Emitted, not in contract |
| MIME_SPOOF_DETECTED | 400 | `apps/api/src/services/image-validator.ts:73,99,187` | Emitted via ImageValidationError |
| FILE_TOO_LARGE | - | `image-validator.ts:282` | Emitted, not in contract |
| UNSUPPORTED_MEDIA_TYPE | - | `image-validator.ts:313` | Emitted, not in contract |
| DIMENSIONS_EXCEEDED, MEGAPIXELS_EXCEEDED, INVALID_DIMENSIONS, INVALID_IMAGE, MALFORMED_IMAGE, EMPTY_FILE, REJECTED_FORMAT | - | API 1 file each | Emitted, not in contract |
| NETWORK_ERROR, HTTP_ERROR | 0 / - | Client-generated (`lib/api.ts:94,107,129,169`) | Client-only, expected |
| BAD_REQUEST, MENTION_NOT_ALLOWED, MENTION_RANGE_INVALID, MOVE_POSITION_CHANGED | - | Zero API hits | Likely dead entries (inferred) |

Note: the contract header says it lists every code the API can return and that a static-scan test enforces it. The codes above show the scan does not cover `ImageValidationError` codes or `HttpError.conflict` constants (inferred from scope; the test itself was not read).

### 1b. Copy problems

| # | file:line | Code(s) | Problem | Status |
|---|---|---|---|---|
| 1 | `lib/error-catalogue.ts:61` (SERVER_FAULT), used at 176, 177, 243, 254, 292, 295 | MALFORMED_REQUEST, BAD_REQUEST, INVALID_CONTENT_TYPE, IDEMPOTENCY_KEY_REQUIRED, NUMERIC_ID_REJECTED (status 0), MENTION_RANGE_INVALID | Client-caused 400-class codes get "Something broke on our side" and "tell support the reference below". `describeFailureOf` shows a reference only for status >= 500 or unknown codes (line 320), so for these codes the reference is absent and the sentence points at nothing. | verified |
| 2 | `lib/error-catalogue.ts:61` | INTERNAL_ERROR and 5xx | "Nothing was changed" is asserted for every server fault. | inferred |
| 3 | `lib/error-catalogue.ts:188` | CSRF_MISMATCH | Titled "Sign-in took too long". A CSRF mismatch can hit any state-changing request, not only sign-in. | inferred |
| 4 | `lib/error-catalogue.ts:173` | DATABASE_UNAVAILABLE | Same copy as SERVICE_UNAVAILABLE: "Flowboard is busy". A database outage is not "busy". Contract gives it status 0 (`common.ts:29`). | inferred |
| 5 | `lib/error-catalogue.ts:209` | INVALID_COLUMN_ORDER | Says "Someone changed this board's columns". The server meaning is an invalid order, which may be a client bug. | inferred |
| 6 | `lib/error-catalogue.ts:195` | BOARD_REQUIRED | Title "Flowboard was updated" implies a version change. Server meaning: request missing a board. | inferred |
| 7 | `lib/error-catalogue.ts:258` | INVALID_DESTINATION | Reuses `NO_PEOPLE_PICK` ("That column no longer exists"). Server meaning is a bad destination; the title is only partly right. | inferred |
| 8 | `lib/error-catalogue.ts:81` | FORBIDDEN default | For an Owner the body reads "Ask an Owner or Manager. Change it in People." The Owner is asked to ask an Owner. The `.replace(...)` on the same line never matches. | verified |
| 9 | `lib/error-catalogue.ts:156` and `:231` | PAYLOAD_TOO_LARGE, FILE_TOO_LARGE | Byte limit is rounded to MB. Line 156 floors at 1 MB, but line 231 uses plain `Math.round`, so a 300 KB limit reads "The limit is 0 MB". | verified (arithmetic) |
| 10 | `lib/error-catalogue.ts:215` | NO_PREVIOUS_MOVE | No next step. "This card has not moved since it was created." | verified |
| 11 | `lib/error-catalogue.ts:219` | CARD_ALREADY_TRASHED | No next step. "Someone deleted it just now." | verified |
| 12 | `lib/error-catalogue.ts:196` | VALIDATION_ERROR | Generic. Does not say which field (details exist, `hasDetails: true`). | verified |
| 13 | `lib/error-catalogue.ts:290-291` | MAX_LENGTH_EXCEEDED, REQUIRED | Generic. No field name or limit. | verified |
| 14 | `lib/error-catalogue.ts:170` | HTTP_ERROR | Generic title "Flowboard had a problem". | verified |
| 15 | `lib/error-catalogue.ts:141` | stale() default entity | Falls back to "This item changed" when entity is unknown. | verified |
| 16 | `lib/error-catalogue.ts:282` and `:256`, `:208` | ASSIGNEE_LIMIT_EXCEEDED, RESTORE_WINDOW_EXPIRED, COLUMN_HAS_RESTORABLE_CARDS | Hardcoded policy numbers ("20 people", "24 hours"). They match today (`apps/web/src/lib/assignees.ts:6` = 20; `apps/api/src/adapters/trash.ts:498` = 24h), but will drift if the server changes. | verified match, drift risk inferred |
| 17 | `lib/error-catalogue.ts:102,104,106` | ASSIGNEE_NOT_ELIGIBLE | Ternaries with identical branches (`one ? 'can’t' : 'can’t'`, etc.). No copy effect; code smell. | verified |
| 18 | `lib/error-catalogue.ts:126` | pending invitations | Dead `${of ? '' : ''}`. No copy effect. | verified |

Generic fallbacks by class (no specific copy for the code):

| file:line | Status | Copy | Specific message exists? |
|---|---|---|---|
| `lib/error-catalogue.ts:304` | 403 | "Your role can’t do that" | No (code-specific only via FORBIDDEN) |
| `:308` | 409 | "This changed" | No |
| `:309` | 410 | "That is no longer available" | No |
| `:310` | 400/422 | "Check what you entered" | No |
| `:313` | other | falls to SERVER_FAULT | No |
| `:128` | QUOTA default | "That is over a limit" | No |
| `:150` | NOT_FOUND default | "That isn’t available" | No |
| `:135` | 429 default | "doing that" | No |

### 1c. Missing next step

CARD_ALREADY_TRASHED (219) and NO_PREVIOUS_MOVE (215). Every other entry has an instruction or a button.

## 2. Places that render server-provided text

| Classification | file:line | What renders | Evidence |
|---|---|---|---|
| UNSAFE (known, Release 2) | `app/import/page.tsx:239` | `first.message` for invalid rows | verified. Server text includes user data, e.g. `apps/api/src/adapters/imports.ts:344,360,375,409` (`External ID '${...}'`, emails). |
| UNSAFE (known, Release 2) | `app/import/page.tsx:240` | `first.message` for conflict rows | verified, same source |
| UNSAFE (dev only) | `app/signin/page.tsx:48` then `:53` then `:90` | `data.error.message` from `/api/v1/session/dev-login`, rendered in `field-error` | verified. Form gated by `DEV_LOGIN = NODE_ENV !== 'production'` (line 11). Known. |
| Safe | `components/shell/app-shell.tsx:52` | `state.message` | verified: set by `describeError` in `lib/session.tsx:52` |
| Safe | `components/invitation/accept-screen.tsx:196` | `outcome.message` | verified: `describeError` at lines 72, 74 |
| Safe | `components/ui/invite-dialog.tsx:90` | `result.message` | verified: app-authored in `lib/invite-email.ts` |
| Safe | `components/auth/name-step.tsx:88` | `serverError` | verified: 422 mapped to app text, else `describeError` (line 49) |
| Safe | `lib/errors.ts:14` | `PrepareError.message` | verified: app-authored in `lib/image-prepare.ts:137-190` |
| Safe | `components/ui/toasts.tsx:43` | `item.message` | verified: callers use `toastFailure` (catalogue) or app strings |
| Latent | `lib/api.ts:107,129,169` | `ApiError.message` = server message or "HTTP request failed with status N" | not rendered anywhere (verified by grep); risk if someone renders `.message` later |
| Logic only | `lib/assignees.ts:58` | regex on `f.message` ("access to this board") | classifies, does not render; fragile (inferred) |
| Declared, not rendered | `lib/quota-messages.ts:5`, `lib/leave-project.ts:2` | `FailureLike.message` | verified: no render found |
| Unknown | none | | |

Fix suggestion (for the owner, not done here): both known unsafe sites should go through `describeFailure` with a row-level catalogue for import row codes, and the dev-login error should use the catalogue or a fixed string.

## 3. Generic strings used as error text

| Pattern | Hits in apps/web/src | file:line | Specific message exists? |
|---|---|---|---|
| "Something went wrong" | 0 | - | - |
| "Request failed" | 0 as copy | `lib/api.ts:107,129,169` ("HTTP request failed with status N") | Not rendered; flows to HTTP_ERROR catalogue entry |
| "Error" label | 0 | - | - |
| "Failed" | 1 | `app/signin/page.tsx:53` "Dev sign in failed." (dev only) | No |
| "Sign in failed with status N" | 1 | `app/signin/page.tsx:48` (rendered at :90, dev only) | No; exposes HTTP status |
| "Could not" | 8 | `components/board/card-images.tsx:73` "Could not load" (role=status) | Partly: `:94` "This image could not be loaded." |
| "Could not" | | `components/board/board-view.tsx:580` "Could not refresh" | No |
| "Could not" | | `components/ui/invite-dialog.tsx:95` "Could not copy. Select the link and copy it yourself." | Yes, specific |
| "Could not" | | `lib/assignees.ts:88` "Could not load the project’s people." | Yes, specific |
| "Could not" | | `lib/mention-ui.ts:4` "Could not load people for this card." | Yes, specific |
| "Could not" (labels) | | `name-step.tsx:88`, `accept-screen.tsx:196` labels "Could not save" / "Could not accept" | Label + specific message |
| "unsaved" | 1 copy | `lib/error-catalogue.ts:180` (UNAUTHORIZED body) | Specific. "Unsaved changes" labels elsewhere are status text, not errors. |
| HTTP status text (statusText) | 0 | - | - |
| Catalogue generics | many | see 1b rows 12-15 and class defaults | No |

Note: `lib/api.ts:94` comment says "Failed to fetch" and "Load failed" are not shown. Correct (verified).

## 4. Catalogue copy rule checks

| Rule | Result | Evidence |
|---|---|---|
| No "please" | 0 violations | grep, `lib/error-catalogue.ts` and `apps/web/src` |
| No "successfully" | 0 violations | grep |
| No exclamation mark | 0 violations in copy | grep hits were `!==` in code only |
| No sentence over 25 words | 0 violations | longest copy strings checked by word count; the longest body is about 20 words (verified heuristic) |
| No ALL_CAPS code tokens | 0 violations | grep hits were code identifiers only |
| No raw ms or bytes | 0 violations | "MB" is converted from bytes (`error-catalogue.ts:156,231`), which is allowed |

Note: `lib/image-prepare.ts:138-190` (not catalogue copy) uses "over 40 MB", "10 MB" and "megapixels". These pass the same rules.

## 5. Accessibility of error text

| Status | file:line | Element | Evidence |
|---|---|---|---|
| OK | `components/ui/error-note.tsx:64` | ErrorNote `role="alert"`, `tabIndex=-1`, focus on mount when asked | verified |
| OK | `components/ui/toasts.tsx:64-65` | status (polite) and alert (assertive) regions; danger toasts go to assertive (`lib/toast-policy.ts:17`) | verified |
| OK | Many dialog and page error paragraphs | `role="alert"` | verified (grep: 91 role/aria-live hits in the web app) |
| No role | `app/import/page.tsx:219` | `<div className="note danger">` blocking-rows summary | verified |
| No role | `app/import/page.tsx:239-240` | per-row `<p className="row-message">` errors | verified |
| No role, no link | `components/auth/name-step.tsx:79,84` | `<p className="form-error">` field errors; inputs at `:78,83` have no `aria-describedby` or `aria-invalid` | verified |
| Polite only | `components/board/card-images.tsx:73` and `:94` | role=status for load failures | inferred OK; not an alert |
| Polite only | `components/board/board-view.tsx:580` | role=status "Could not refresh" | inferred OK |

## Files read

- `packages/contracts/src/common.ts`
- `apps/web/src/lib/error-catalogue.ts`, `error-codes.ts`, `errors.ts`
- `apps/web/src/components/ui/error-note.tsx`, `toasts.tsx`
- `apps/web/src/lib/api.ts`, `session.tsx`, `toast-failure.ts`, `invite-email.ts`, `image-prepare.ts`, `assignees.ts`, `unsaved.ts`
- Greps across `apps/web/src` and `apps/api/src` for render sites, role attributes and error literals
