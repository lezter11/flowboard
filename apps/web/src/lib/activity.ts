import type { ActivityItem } from '@flowboard/contracts';
import { ROLE_META } from '@/lib/roles';

export interface ActivityView { icon: string; text: string; category: string }

const FIELD_LABELS: Record<string, string> = {
  title: 'the title', description: 'the description', priority: 'the priority', dueDate: 'the due date', assigneeIds: 'the assignees',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Quoted name for a sentence; the API only sends names, never emails or tokens. */
const named = (v: unknown): string => { const n = str(v); return n ? ` “${n.length > 60 ? `${n.slice(0, 59)}…` : n}”` : ''; };
const roleLabel = (v: unknown): string | null => { const r = str(v); return r ? (ROLE_META as Record<string, { label: string }>)[r]?.label.toLowerCase() ?? r.replace(/_/g, ' ') : null; };
const asRole = (v: unknown): string => { const r = roleLabel(v); return r ? ` as ${/^[aeiou]/.test(r) ? 'an' : 'a'} ${r}` : ''; };

/** Turns an activity record (action code + safe changes) into a sentence in the prototype's wording. */
export function describeActivity(item: Pick<ActivityItem, 'action' | 'safeChanges'>, subject: 'this card' | 'a card' = 'this card'): ActivityView {
  const c = (item.safeChanges ?? {}) as Record<string, unknown>;
  switch (item.action) {
    case 'card_created': return { icon: 'plus', category: 'Cards', text: `created ${subject}` };
    case 'card_moved': {
      const from = typeof c.fromColumnTitle === 'string' ? c.fromColumnTitle : null;
      const to = typeof c.toColumnTitle === 'string' ? c.toColumnTitle : null;
      return { icon: 'move', category: 'Moves', text: from && to ? `moved ${subject} from ${from} to ${to}` : `moved ${subject}` };
    }
    case 'card_updated': {
      const fields = Object.keys(c).map((key) => FIELD_LABELS[key]).filter(Boolean) as string[];
      return { icon: 'edit', category: 'Cards', text: fields.length ? `updated ${fields.join(', ')} on ${subject}` : `updated ${subject}` };
    }
    case 'card_trashed': return { icon: 'trash', category: 'Trash', text: `moved ${subject} to the trash` };
    case 'card_restored': return { icon: 'undo', category: 'Trash', text: `restored ${subject} from the trash` };
    case 'comment_created': return { icon: 'comment', category: 'Comments', text: `commented on ${subject}` };
    case 'comment_updated': return { icon: 'comment', category: 'Comments', text: `edited a comment on ${subject}` };
    case 'comment_deleted': return { icon: 'comment', category: 'Comments', text: `deleted a comment on ${subject}` };
    case 'card_purged': return { icon: 'trash', category: 'Trash', text: `permanently deleted ${subject}` };
    case 'card_import_committed': return { icon: 'upload', category: 'Cards', text: 'imported cards from a spreadsheet' };
    case 'image_attached': return { icon: 'image', category: 'Cards', text: `added an image to ${subject}` };
    case 'image_removed': return { icon: 'image', category: 'Cards', text: `removed an image from ${subject}` };
    case 'board_access_granted': return { icon: 'user-check', category: 'People', text: 'gave someone access to a board' };
    case 'board_access_revoked': return { icon: 'user-check', category: 'People', text: 'removed someone’s access to a board' };
    // Boards
    case 'board_created': return { icon: 'board', category: 'Boards', text: `created a board${named(c.name)}` };
    case 'board_renamed': return { icon: 'edit', category: 'Boards', text: `renamed a board${c.name ? ' to' : ''}${named(c.name)}` };
    case 'board_described': return { icon: 'edit', category: 'Boards', text: c.cleared === true ? 'cleared a board description' : 'changed a board description' };
    case 'board_archived': return { icon: 'archive', category: 'Boards', text: `archived a board${named(c.name)}` };
    case 'board_reopened': return { icon: 'restore', category: 'Boards', text: `reopened a board${named(c.name)}` };
    case 'default_board_changed': return { icon: 'board', category: 'Boards', text: 'changed the default board' };
    // Columns
    case 'column_added': return { icon: 'columns', category: 'Columns', text: `added a column${named(c.name)}` };
    case 'column_renamed': return { icon: 'columns', category: 'Columns', text: `renamed a column${c.name ? ' to' : ''}${named(c.name)}` };
    case 'column_recoloured': return { icon: 'palette', category: 'Columns', text: 'recoloured a column' };
    case 'column_recategorised': return { icon: 'columns', category: 'Columns', text: `changed a column’s category${str(c.category) ? ` to ${str(c.category)!.replace(/_/g, ' ')}` : ''}` };
    case 'columns_reordered': return { icon: 'columns', category: 'Columns', text: 'reordered columns' };
    case 'column_deleted': return { icon: 'trash', category: 'Columns', text: `deleted a column${named(c.name)}` };
    // Project settings
    case 'project_brief_updated': return { icon: 'edit', category: 'Project', text: c.cleared === true ? 'cleared the project brief' : 'edited the project brief' };
    case 'project_links_updated': return { icon: 'link', category: 'Project', text: 'edited project links' };
    // Invitations (role only; the API never sends the email or token)
    case 'invitation_sent': return { icon: 'mail', category: 'People', text: `sent an invitation${asRole(c.role)}` };
    case 'invitation_resent': return { icon: 'mail', category: 'People', text: `resent an invitation${asRole(c.role)}` };
    case 'invitation_revoked': return { icon: 'x-circle', category: 'People', text: `revoked an invitation${asRole(c.role)}` };
    case 'invitation_accepted': return { icon: 'user-plus', category: 'People', text: `accepted an invitation${asRole(c.role)}` };
    // Members
    case 'member_role_changed': {
      const from = roleLabel(c.fromRole); const to = roleLabel(c.toRole);
      return { icon: 'user-check', category: 'People', text: from && to ? `changed a member’s role from ${from} to ${to}` : 'changed a member’s role' };
    }
    case 'member_removed': return { icon: 'users', category: 'People', text: `removed a member${roleLabel(c.role) ? ` (${roleLabel(c.role)})` : ''}` };
    case 'member_reinstated': return { icon: 'user-plus', category: 'People', text: `reinstated a member${roleLabel(c.role) ? ` (${roleLabel(c.role)})` : ''}` };
    case 'member_left': return { icon: 'users', category: 'People', text: 'left the project' };
    // Unknown future actions: readable text, never a crash.
    default: return { icon: 'activity', category: 'Other', text: item.action.replace(/[_-]+/g, ' ').trim() || 'made a change' };
  }
}
