/**
 * The one place that turns a failure into words. Pure and dependency-free, so a test can walk every code.
 *
 * Rules (docs/handoffs/proposals/error-messages-audit-2026-10-31.md, section 5): sentence case, no "please" or
 * "successfully" or "!", what happened + why + what to do, each sentence 25 words or fewer, no codes, ids, bytes or
 * milliseconds. The server's own `message` is never shown: it is for logs. Unknown codes fall back to a class default by status.
 */
export interface Failure { status: number; code: string; details?: unknown; requestId?: string | null; retryAfter?: number | null }

export type ActionKind = 'retry' | 'reload' | 'signin' | 'people' | 'settings' | 'trash' | 'projects' | 'template' | 'file' | 'column' | 'none';
export interface DescribedAction { kind: ActionKind; label: string; href?: string }
export interface Described {
  title: string;
  body: string;
  action: DescribedAction | null;
  severity: 'danger' | 'warn';
  retryable: boolean;
  /** Request id, only for server faults and unknown codes (decision D4). */
  reference: string | null;
}

export interface Ctx {
  /** The caller's role in the project the action targets. */
  role?: 'owner' | 'manager' | 'member' | 'viewer';
  /** Display name of the project Owner when the client has it. */
  ownerName?: string | null;
  projectId?: string;
  boardName?: string;
  projectName?: string;
  /** Names of the people a refusal is about (already resolved by the caller). */
  names?: string[];
  /** Short name for what the person was doing, for 429: "creating projects". */
  doing?: string;
  /** Title of the card or other item the action was about. */
  item?: string;
  /** What a NOT_FOUND was about when the server did not say (card, board, project…). */
  resource?: string;
}

const LABEL: Record<ActionKind, string> = {
  retry: 'Try again', reload: 'Reload', signin: 'Sign in', people: 'Open People', settings: 'Open Settings', trash: 'Open Trash',
  projects: 'Back to projects', template: 'Download the template', file: 'Choose another file', column: 'Choose a column', none: '',
};
const HREF: Partial<Record<ActionKind, string>> = { people: '/people', settings: '/settings', trash: '/trash', projects: '/projects', signin: '/signin' };
export const action = (kind: ActionKind, label?: string): DescribedAction | null => kind === 'none' ? null : { kind, label: label ?? LABEL[kind], ...(HREF[kind] ? { href: HREF[kind] } : {}) };

type Entry = (f: Failure, c: Ctx) => { title: string; body: string; action?: ActionKind | DescribedAction | null; severity?: 'danger' | 'warn'; retryable?: boolean };
const e = (title: string, body: string, act: ActionKind = 'none', extra: { severity?: 'danger' | 'warn'; retryable?: boolean } = {}): Entry => () => ({ title, body, action: act, ...extra });

const owner = (c: Ctx) => c.ownerName?.trim() || 'the project Owner';
const isOwner = (c: Ctx) => c.role === 'owner';
const asDetails = (f: Failure) => (f.details && typeof f.details === 'object' ? f.details as Record<string, unknown> : {}) as Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const list = (names: string[]) => {
  if (names.length <= 1) return names[0] ?? 'Someone';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SERVER_FAULT = e('Something broke on our side', 'Nothing was changed. Try again. If it keeps happening, tell support the reference below.', 'retry', { retryable: true });
const STALE_ENTITY: Record<string, string> = { card: 'card', board: 'board', project: 'project', member: 'person', comment: 'comment', image: 'image', import: 'import', workspace: 'project' };
const OUT_OF_DATE = e('Flowboard was updated', 'This tab is out of date. Reload to get the latest version.', 'reload');
const NO_PEOPLE_PICK = e('That column no longer exists', 'Choose another column.', 'column');

function forbidden(f: Failure, c: Ctx) {
  const reason = String(asDetails(f).reason ?? '');
  const ask = isOwner(c) ? 'Change it in People.' : `Ask ${owner(c)}.`;
  switch (reason) {
    case 'viewer_read_only': return { title: 'Viewers can read, not change', body: 'Ask an Owner or Manager to make you a Member if you need to edit.' };
    case 'manager_required': return { title: 'Managers and Owners only', body: 'Ask an Owner or Manager to do this.' };
    case 'owner_required': return { title: 'Only the project Owner can do this', body: `Ask ${owner(c)}.` };
    case 'own_membership': return { title: 'You can’t change your own role', body: 'Ask the project Owner if your role needs to change.' };
    case 'owner_target': return { title: 'The Owner’s role can’t be changed', body: 'The Owner always has full access to the project.' };
    case 'manager_target': return { title: 'Only the Owner can change a Manager', body: `Ask ${owner(c)}.` };
    case 'appoint_manager_owner_only': return { title: 'Only the Owner can make a Manager', body: `Ask ${owner(c)}.` };
    case 'role_not_assignable': return { title: 'Managers can set Member or Viewer only', body: `For other roles, ask ${owner(c)}.` };
    case 'owner_cannot_leave': return { title: 'Owners can’t leave their project', body: 'Archive it in Settings if you are done with it.', action: 'settings' as ActionKind };
    case 'author_only': return { title: 'Only the author can edit this', body: 'You can reply instead, or delete it if your role allows.' };
    case 'uploader_or_manager': return { title: 'Only the uploader or a Manager can do this', body: 'Ask the person who added it, or a Manager.' };
    default: return { title: 'Your role can’t do that', body: `Ask an Owner or Manager. ${ask}`.replace(/ Ask the project Owner\.$/, '') };
  }
}

function readOnly(f: Failure, c: Ctx) {
  const reason = String(asDetails(f).reason ?? '');
  const board = c.boardName ? `“${c.boardName}”` : 'This board';
  const project = c.projectName ? `“${c.projectName}”` : 'This project';
  if (reason === 'board_archived') return { title: `${board} is archived`, body: isOwner(c) ? 'Archived boards are read-only. Restore it in board settings, or use another board.' : `Archived boards are read-only. Ask ${owner(c)} to restore it, or use another board.`, action: null };
  if (reason === 'project_archived') return { title: `${project} is archived`, body: isOwner(c) ? 'Reopen it in Settings to make changes.' : `Ask ${owner(c)} to reopen it.`, action: isOwner(c) ? 'settings' as ActionKind : null };
  // The server did not say which: do not guess between the project and the board.
  return { title: 'This is archived', body: isOwner(c) ? 'Archived projects and boards are read-only. Reopen it in Settings to make changes.' : `Archived projects and boards are read-only. Ask ${owner(c)} to reopen it.`, action: isOwner(c) ? 'settings' as ActionKind : null };
}

function assigneeRefused(f: Failure, c: Ctx) {
  const d = asDetails(f);
  const reasons = Array.isArray(d.reasons) ? d.reasons as Array<{ reason?: string }> : [];
  const kinds = new Set(reasons.map((r) => r.reason));
  const names = c.names ?? [];
  const who = names.length ? list(names) : 'Some of them';
  const one = names.length === 1;
  const verb = one ? 'can’t' : 'can’t';
  if (kinds.size === 1 && kinds.has('viewer')) return { title: `${who} ${verb} be assigned`, body: `Viewers can’t be assigned work. ${isOwner(c) ? 'Change their role in People, or choose someone else.' : 'Ask an Owner or Manager to change their role, or choose someone else.'}`, action: isOwner(c) ? 'people' as ActionKind : null };
  if (kinds.size === 1 && kinds.has('not_active')) return { title: `${who} ${verb} be assigned`, body: `${one ? 'They have' : 'They have'} left this project. Remove ${one ? 'them' : 'them'} and save.`, action: null };
  const board = c.boardName ? ` ${c.boardName}` : ' this board';
  return { title: `${who} ${verb} be assigned`, body: isOwner(c) ? `${one ? 'They don’t' : 'They don’t'} have access to${board}. Give ${one ? 'them' : 'them'} access in People, then try again.` : `${one ? 'They don’t' : 'They don’t'} have access to${board}. Ask ${owner(c)} to give ${one ? 'them' : 'them'} access, or choose someone else.`, action: isOwner(c) ? 'people' as ActionKind : null };
}

function quota(f: Failure, c: Ctx) {
  const d = asDetails(f);
  const scope = String(d.scope ?? '');
  const limit = num(d.limit);
  const current = num(d.current);
  const of = limit !== null ? ` of ${limit}` : '';
  switch (scope) {
    case 'owned_projects': return { title: 'You have reached your project limit', body: `You can have ${limit !== null ? limit : 'a limited number of'} active projects${current !== null ? ` and you have ${current}` : ''}. Archive one to free a slot, then create another.`, action: 'projects' as ActionKind };
    case 'owned_projects_total': return { title: 'You have reached your project limit', body: `An account can create ${limit !== null ? limit : 'a limited number of'} projects, archived ones included. This limit can’t be raised from here.` };
    case 'boards_per_project': return isOwner(c)
      ? { title: 'This project is at its board limit', body: `A project can have ${limit !== null ? limit : 'a limited number of'} active boards. Archive one you no longer need, then create the new one.`, action: 'none' as ActionKind }
      : { title: 'This project is at its board limit', body: `A project can have ${limit !== null ? limit : 'a limited number of'} active boards. Ask ${owner(c)} to archive one.` };
    case 'boards_per_project_total': return { title: 'This project is at its board limit', body: `A project can hold ${limit !== null ? limit : 'a limited number of'} boards in total, archived ones included.` };
    case 'members': return c.role === 'owner' || c.role === 'manager'
      ? { title: 'This project is full', body: `A project can have ${limit !== null ? limit : 'a limited number of'} members. Remove one you no longer need, then add the new person.`, action: 'people' as ActionKind }
      : { title: 'This project is full', body: `It has reached its limit of ${limit !== null ? limit : 'members'}. Ask ${owner(c)}.` };
    case 'pending_invitations': return c.role === 'owner' || c.role === 'manager'
      ? { title: 'Too many pending invitations', body: `A project can have ${limit !== null ? limit : 'a limited number of'} pending invitations${of ? '' : ''}. Revoke one that is no longer needed, then invite again.`, action: 'people' as ActionKind }
      : { title: 'Too many pending invitations', body: `The project has reached its limit of ${limit !== null ? limit : 'pending invitations'}. Ask ${owner(c)}.` };
    default: return { title: 'That is over a limit', body: 'This would go over a limit on your account. Nothing was changed.' };
  }
}

function rateLimited(f: Failure, c: Ctx) {
  const d = asDetails(f);
  const s = num(d.retryAfterSeconds) ?? (f.retryAfter ?? null);
  const what = c.doing ?? 'doing that';
  const wait = s === null || s <= 0 ? 'Wait a moment, then try again.' : s >= 90 ? `Try again in about ${Math.ceil(s / 60)} minutes.` : `Try again in ${Math.ceil(s)} ${Math.ceil(s) === 1 ? 'second' : 'seconds'}.`;
  return { title: 'Slow down a little', body: `You are ${what} too quickly. ${wait}`, action: 'retry' as ActionKind, retryable: true };
}

function stale(f: Failure, c: Ctx) {
  const entity = STALE_ENTITY[String(asDetails(f).entity ?? '')] ?? 'item';
  const by = typeof asDetails(f).changedByName === 'string' ? String(asDetails(f).changedByName) : 'Someone';
  if (f.code === 'STALE_BOARD_VERSION') return { title: 'Columns changed', body: 'Someone changed this board’s columns. It is updated; try again.', action: 'retry' as ActionKind };
  if (entity === 'card') return { title: 'This card changed', body: `${by} saved changes while you were editing. Their version is loaded. Review your edits, then save again.`, action: 'retry' as ActionKind };
  return { title: `This ${entity} changed`, body: `${by} changed it while you were looking. The latest version is loaded. Review it, then try again.`, action: 'reload' as ActionKind };
}

function notFound(f: Failure, c: Ctx = {}) {
  const r = String(asDetails(f).resource ?? c.resource ?? '');
  const thing = ({ card: 'This card', board: 'This board', project: 'This project', column: 'This column', comment: 'This comment', image: 'This image', invitation: 'This invitation', import: 'This import', member: 'This person' } as Record<string, string>)[r] ?? 'That';
  return { title: `${thing} isn’t available`, body: 'It may have been deleted, or you may not have access to it.', action: 'projects' as ActionKind };
}

function payloadTooLarge(f: Failure) {
  const max = num(asDetails(f).maxBytes);
  const limit = max !== null ? `${Math.max(1, Math.round(max / 1_048_576))} MB` : null;
  return { title: 'That is too large', body: limit ? `The limit is ${limit}. Shorten it or choose a smaller file, then try again.` : 'Shorten it or choose a smaller file, then try again.', action: 'file' as ActionKind };
}

function limitMsg(f: Failure, one: string, many: string) {
  const l = num(asDetails(f).limit);
  return l !== null ? one.replace('{limit}', String(l)) : many;
}

const IMPORT_UNSAFE = e('This workbook can’t be imported', 'It contains formulas, macros or linked files. Save a plain copy with values only and upload that.', 'file');

export const CATALOGUE: Record<string, Entry> = {
  // Transport and platform
  NETWORK_ERROR: e('You’re offline', 'Your changes are still on this page. Reconnect, then try again.', 'retry', { retryable: true }),
  HTTP_ERROR: e('Flowboard had a problem', 'The server sent an unexpected reply. Your work is not lost. Try again in a moment.', 'retry', { retryable: true }),
  INTERNAL_ERROR: SERVER_FAULT,
  SERVICE_UNAVAILABLE: e('Flowboard is busy', 'Your change was not saved. Wait a few seconds and try again.', 'retry', { retryable: true }),
  DATABASE_UNAVAILABLE: e('Flowboard is busy', 'Your change was not saved. Wait a few seconds and try again.', 'retry', { retryable: true }),
  DEADLINE_EXCEEDED: e('That took too long', 'We don’t know if it saved. Reload to check before trying again.', 'reload', { retryable: true }),
  CONFIG_ERROR: e('This isn’t set up yet', 'Ask whoever runs this Flowboard to finish the setup.'),
  MALFORMED_REQUEST: SERVER_FAULT,
  BAD_REQUEST: SERVER_FAULT,
  PAYLOAD_TOO_LARGE: payloadTooLarge,
  // Session and roles
  UNAUTHORIZED: e('Your session ended', 'Sign in again to keep working. Your unsaved text stays on this page until you leave it.', 'signin'),
  FORBIDDEN: forbidden,
  EMAIL_MISMATCH: e('This invitation is for a different account', 'Sign in with the email address that was invited, then open the link again.', 'signin'),
  NAME_REQUIRED: e('Add your name first', 'Save your first and last name in Settings, then try again.', 'settings'),
  WORKSPACE_CREATE_RETIRED: OUT_OF_DATE,
  TRANSFER_OWNERSHIP_RETIRED: OUT_OF_DATE,
  OAUTH_ERROR: e('Google did not give us access', 'You can try again, or use a different Google account.', 'signin'),
  INVALID_CALLBACK: e('Google sign-in did not finish', 'Start again from the sign-in page.', 'signin'),
  CSRF_MISMATCH: e('Sign-in took too long', 'Start again from the sign-in page.', 'signin'),
  TOKEN_EXCHANGE_FAILED: e('Google sign-in did not finish', 'Try again.', 'signin'),
  USERINFO_FAILED: e('Google sign-in did not finish', 'Try again.', 'signin'),
  EMAIL_REQUIRED: e('Your Google account has no email', 'Flowboard needs an email address to sign you in.', 'signin'),
  EMAIL_NOT_VERIFIED: e('Verify your Google email first', 'Google says your email is not verified. Verify it in your Google account, then sign in again.', 'signin'),
  // Cards, boards, columns
  ASSIGNEE_NOT_ELIGIBLE: assigneeRefused,
  BOARD_REQUIRED: e('Flowboard was updated', 'Reload the page to assign people.', 'reload'),
  VALIDATION_ERROR: e('Check what you entered', 'One of the fields is not valid. Fix it and save again.'),
  CONFLICT: stale,
  STALE_VERSION: stale,
  STALE_BOARD_VERSION: stale,
  ACCESS_CHANGED: e('Access changed', 'Someone changed who can open this board. The list is updated; try again.', 'retry'),
  STALE_CURSOR: e('The list changed', 'Reload the list to keep browsing.', 'reload'),
  STALE_ACCESS_REVISION: e('Access changed', 'Someone else changed who can open this board. The list is updated; try again.', 'retry'),
  READ_ONLY_CONTEXT: readOnly,
  COLUMN_LIMIT_EXCEEDED: (f) => ({ title: 'This board has the most columns it can', body: limitMsg(f, 'A board can have {limit} columns. Remove or merge one first.', 'Remove or merge a column first.') }),
  DUPLICATE_COLUMN_NAME: e('That column name is taken', 'Choose a different name.'),
  FINAL_COLUMN_CANNOT_BE_DELETED: e('A board needs one column', 'Add another column before deleting this one.'),
  COLUMN_HAS_ACTIVE_CARDS: (f, c) => { const n = num(asDetails(f).count); return { title: 'Move the cards first', body: `${n !== null ? `${plural(n, 'card is', 'cards are')} in this column.` : 'This column still has cards.'} Move them to another column, then delete it.` }; },
  COLUMN_HAS_RESTORABLE_CARDS: e('Cards here can still be restored', 'Cards deleted from this column can be restored for 24 hours. Restore them or wait, then delete the column.', 'trash'),
  INVALID_COLUMN_ORDER: e('Columns changed', 'Someone changed this board’s columns. Reload and try again.', 'reload'),
  BOARD_ARCHIVED: e('That board is archived', 'Pick an active board.'),
  INVALID_MOVING_CARD: e('That card can’t move there', 'Reload the board and drag it again.', 'reload'),
  INVALID_ANCHOR_CARD: e('The board changed', 'The card you dropped near moved. Reload and drag again.', 'reload'),
  ANCHOR_CARD_NOT_FOUND: e('The board changed', 'The card you dropped near is gone. Reload and drag again.', 'reload'),
  DESTINATION_COLUMN_MISSING: e('That column was removed', 'Move the card by hand instead.'),
  NO_PREVIOUS_MOVE: e('Nothing to undo', 'This card has not moved since it was created.'),
  MOVE_POSITION_CHANGED: e('The board changed', 'Someone moved cards while you were dragging. Drag it again.', 'retry'),
  CARD_TRASHED: (f, c) => ({ title: 'This card is in the trash', body: c.role === 'owner' || c.role === 'manager' ? 'Restore it from Trash to keep working on it.' : 'Ask an Owner or Manager to restore it.', action: c.role === 'owner' || c.role === 'manager' ? 'trash' as ActionKind : null }),
  CARD_IS_TRASHED: (f, c) => CATALOGUE.CARD_TRASHED!(f, c),
  CARD_ALREADY_TRASHED: e('This card is already in the trash', 'Someone deleted it just now.'),
  CARD_NOT_TRASHED: e('This card is no longer in the trash', 'Someone restored it just now. Reload to see it on its board.', 'reload'),
  COMMENT_DELETED: e('This comment was deleted', 'Reload to see the latest comments.', 'reload'),
  NOT_FOUND: (f, c) => notFound(f, c),
  // Comments, images
  IMAGE_LIMIT_EXCEEDED: (f) => ({ title: 'This card has the most images it can', body: limitMsg(f, 'A card can have {limit} images. Remove one to add another.', 'Remove one to add another.') }),
  MIME_SPOOF_DETECTED: e('That file isn’t a valid image', 'Only PNG, JPEG and WebP images work.', 'file'),
  MALFORMED_IMAGE: e('That file isn’t a valid image', 'Only PNG, JPEG and WebP images work.', 'file'),
  REJECTED_FORMAT: e('That file isn’t a valid image', 'Only PNG, JPEG and WebP images work.', 'file'),
  INVALID_IMAGE: e('That file isn’t a valid image', 'Only PNG, JPEG and WebP images work.', 'file'),
  EMPTY_FILE: e('The file is empty', 'Choose a file that has content.', 'file'),
  INVALID_DIMENSIONS: e('That image has no size', 'Choose a different image.', 'file'),
  FILE_TOO_LARGE: (f) => { const max = num(asDetails(f).maxBytes); return { title: 'This image is too large', body: max !== null ? `The limit is ${Math.round(max / 1_048_576)} MB. Choose a smaller image.` : 'Choose a smaller image.', action: 'file' as ActionKind }; },
  UNSUPPORTED_MEDIA_TYPE: e('That image type isn’t supported', 'Only PNG, JPEG and WebP images work.', 'file'),
  DIMENSIONS_EXCEEDED: e('This image has too many pixels', 'Choose a smaller image, or shrink it before uploading.', 'file'),
  MEGAPIXELS_EXCEEDED: e('This image has too many pixels', 'Choose a smaller image, or shrink it before uploading.', 'file'),
  UPLOAD_EXPIRED: e('The upload took too long', 'Start the upload again.', 'retry', { retryable: true }),
  SIZE_MISMATCH: e('The image was damaged', 'It changed while uploading. Try again.', 'retry', { retryable: true }),
  DIGEST_MISMATCH: e('The image was damaged', 'It changed while uploading. Try again.', 'retry', { retryable: true }),
  UPLOAD_CANCELLED: e('The upload was interrupted', 'Start the upload again.', 'retry', { retryable: true }),
  INVALID_UPLOAD_STATE: e('The upload was interrupted', 'Start the upload again.', 'retry', { retryable: true }),
  ALREADY_FINALIZED: e('This image was already added', 'Reload the card to see it.', 'reload'),
  CONTENT_MISSING: e('The upload was interrupted', 'Start the upload again.', 'retry', { retryable: true }),
  MENTION_NOT_ALLOWED: e('A mention can’t be sent', 'Someone you mentioned can’t see this board. Remove the mention, then post.'),
  MENTION_RANGE_INVALID: SERVER_FAULT,
  // People and invitations
  ALREADY_MEMBER: (f, c) => c.role === 'owner' || c.role === 'manager' ? { title: 'They are already in this project', body: 'Change their role in People instead.', action: 'people' as ActionKind } : { title: 'You’re already in this project', body: 'Open it from your projects.', action: 'projects' as ActionKind },
  INVITATION_ALREADY_EXISTS: e('That email already has an invitation', 'Send it again instead of creating a second one.'),
  INVITATION_EXPIRED: e('This invitation has expired', 'Ask the person who invited you to send a new one.'),
  INVALID_INVITATION: e('This invitation link isn’t valid', 'It may be incomplete, already used or replaced. Ask for a new one.'),
  INVITATION_SUPERSEDED: e('This invitation is out of date', 'Ask for a new invitation.'),
  QUOTA_EXCEEDED: quota,
  RATE_LIMITED: rateLimited,
  INVALID_ACCESS_REVISION: e('Access changed', 'The list is updated. Try again.', 'retry'),
  INVALID_CURSOR: e('The list changed', 'Reload the list to keep browsing.', 'reload'),
  INVALID_CONTENT_TYPE: SERVER_FAULT,
  // Trash and import
  RESTORE_WINDOW_EXPIRED: (f, c) => ({ title: 'Too late to restore', body: `Cards can be restored for 24 hours after deletion. ${c.item ? `“${c.item}” is` : 'This card is'} past that and will be removed for good.` }),
  RESTORE_DESTINATION_REQUIRED: (f, c) => ({ title: 'Pick a column to restore into', body: `${c.item ? `“${c.item}” was` : 'This card was'} in a column that no longer exists. Choose where it should go.`, action: 'column' as ActionKind }),
  INVALID_DESTINATION: NO_PEOPLE_PICK,
  IMPORT_HAS_ERRORS: (f) => { const d = asDetails(f).counts as { invalid?: number; conflict?: number } | undefined; const n = (d?.invalid ?? 0) + (d?.conflict ?? 0); return { title: 'Some rows need fixing', body: `${n > 0 ? `${plural(n, 'row is', 'rows are')}` : 'Some rows are'} invalid or in conflict. Fix them in the workbook and upload again.`, action: 'file' as ActionKind }; },
  PREVIEW_EXPIRED: e('The preview expired', 'Upload the file again to get a fresh preview.', 'file'),
  PREVIEW_STALE: e('The data changed since the preview', 'Someone changed the board or its people. Upload again to re-check your rows.', 'file'),
  COMMIT_IN_PROGRESS: e('Import still running', 'Wait for it to finish, then reload.', 'reload'),
  MISSING_FILE: e('Choose a file first', 'Pick the workbook you want to import.', 'file'),
  INVALID_FILE: e('Choose a file first', 'Pick the workbook you want to import.', 'file'),
  MISSING_DEFAULT_COLUMN: e('Choose a column first', 'Pick the column that new cards should land in.', 'column'),
  INVALID_WORKBOOK: e('That isn’t a valid .xlsx file', 'Open it in Excel or Sheets and export it as .xlsx again.', 'file'),
  EMPTY_WORKBOOK: e('That workbook is empty', 'Add your rows to the Cards sheet and upload again.', 'file'),
  CARDS_SHEET_NOT_FOUND: e('The Cards sheet is missing', 'Download the template and paste your rows into its Cards sheet.', 'template'),
  UNSUPPORTED_WORKSHEET: e('That sheet type isn’t supported', 'Use a normal worksheet, not a chart sheet.', 'template'),
  WORKSHEET_NOT_FOUND: e('The Cards sheet is missing', 'Download the template and paste your rows into its Cards sheet.', 'template'),
  UNKNOWN_HEADER: (f) => { const h = asDetails(f).header; return { title: 'A column isn’t in the template', body: `${typeof h === 'string' ? `“${h}” isn’t` : 'One header isn’t'} a column Flowboard imports. Use the template headers.`, action: 'template' as ActionKind }; },
  DUPLICATE_HEADER: e('A column appears twice', 'Each header can appear once. Remove the duplicate and upload again.', 'file'),
  MISSING_REQUIRED_HEADER: e('A required column is missing', 'Use the template headers, including Title, then upload again.', 'template'),
  ROW_LIMIT_EXCEEDED: (f) => ({ title: 'Too many rows', body: limitMsg(f, 'A workbook can have {limit} rows. Split it and import in parts.', 'Split the workbook and import it in parts.'), action: 'file' as ActionKind }),
  FORMULA_REJECTED: IMPORT_UNSAFE,
  MACRO_OR_EXECUTABLE_REJECTED: IMPORT_UNSAFE,
  OLE_EMBEDDINGS_REJECTED: IMPORT_UNSAFE,
  EXTERNAL_LINKS_REJECTED: IMPORT_UNSAFE,
  XXE_DETECTED: IMPORT_UNSAFE,
  DECOMPRESSION_FAILED: e('That isn’t a valid .xlsx file', 'Open it in Excel or Sheets and export it as .xlsx again.', 'file'),
  // Field problems and import row problems
  ASSIGNEE_LIMIT_EXCEEDED: e('Too many assignees', 'A card can have up to 20 people assigned. Remove one to add another.'),
  UNKNOWN_OR_INELIGIBLE_ASSIGNEE: assigneeRefused,
  DUPLICATE_IN_BATCH: e('A row appears twice', 'Two rows in the workbook are the same. Remove one and upload again.', 'file'),
  IMPORT_CONFLICT: e('Some rows conflict', 'A row clashes with a card that already exists. Fix it in the workbook and upload again.', 'file'),
  INVALID_DATE: e('That date isn’t valid', 'Use a real calendar date, such as 2026-11-30.'),
  INVALID_EMAIL_FORMAT: e('That email isn’t valid', 'Check it for typos, for example name@company.com.'),
  INVALID_PRIORITY: e('That priority isn’t valid', 'Choose none, low, medium, high or urgent.'),
  INVALID_STATE: e('That can’t be done right now', 'The item is in a different state than expected. Reload and try again.', 'reload'),
  MAX_LENGTH_EXCEEDED: e('That is too long', 'Shorten the text and try again.'),
  REQUIRED: e('A required field is empty', 'Fill it in and try again.'),
  NUMERIC_ID_REJECTED: SERVER_FAULT,
  UNRECOGNIZED_STATUS: e('That status isn’t recognised', 'Use one of the statuses from the template.', 'template'),
  MIGRATION_FAILED: e('Flowboard is being updated', 'Your change was not saved. Wait a few minutes and try again.', 'retry', { retryable: true }),
  IDEMPOTENCY_KEY_REQUIRED: SERVER_FAULT,
  IDEMPOTENCY_CONFLICT: e('That request was already sent', 'Reload, then try again.', 'reload'),
};

/** Class defaults, used when a code has no entry. Status 0 is the browser failing to reach the server. */
function byClass(f: Failure): ReturnType<Entry> {
  const s = f.status;
  if (s === 0) return CATALOGUE.NETWORK_ERROR!(f, {});
  if (s === 401) return CATALOGUE.UNAUTHORIZED!(f, {});
  if (s === 403) return { title: 'Your role can’t do that', body: 'Ask an Owner or Manager.' };
  if (s === 404) return notFound(f, {});
  if (s === 413) return payloadTooLarge(f);
  if (s === 429) return rateLimited(f, {});
  if (s === 409) return { title: 'This changed', body: 'Someone else changed it, or it is no longer possible. Reload and try again.', action: 'reload' };
  if (s === 410) return { title: 'That is no longer available', body: 'It expired or was removed. Start again.' };
  if (s === 422 || s === 400) return { title: 'Check what you entered', body: 'One of the fields is not valid. Fix it and try again.' };
  if (s === 504) return CATALOGUE.DEADLINE_EXCEEDED!(f, {});
  if (s >= 500) return s === 503 ? CATALOGUE.SERVICE_UNAVAILABLE!(f, {}) : SERVER_FAULT(f, {});
  return SERVER_FAULT(f, {});
}

export function describeFailureOf(f: Failure, ctx: Ctx = {}): Described {
  const entry = CATALOGUE[f.code];
  const raw = entry ? entry(f, ctx) : byClass(f);
  const act = raw.action === undefined || raw.action === null ? null : typeof raw.action === 'string' ? action(raw.action) : raw.action;
  const showRef = f.status >= 500 || (!entry && f.status !== 0);
  return { title: raw.title, body: raw.body, action: act, severity: raw.severity ?? 'danger', retryable: raw.retryable ?? false, reference: showRef && f.requestId ? f.requestId : null };
}

/** Plain sentence for places with room for only one line: the body. */
export const describeBody = (f: Failure, ctx: Ctx = {}): string => describeFailureOf(f, ctx).body;
