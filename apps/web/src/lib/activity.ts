import type { ActivityItem } from '@flowboard/contracts';

export interface ActivityView { icon: string; text: string; category: string }

const FIELD_LABELS: Record<string, string> = {
  title: 'the title', description: 'the description', priority: 'the priority', dueDate: 'the due date', assigneeIds: 'the assignees',
};

/** Turns an activity record (action code + safe changes) into a sentence in the prototype's wording. */
export function describeActivity(item: Pick<ActivityItem, 'action' | 'safeChanges'>, subject: 'this card' | 'a card' = 'this card'): ActivityView {
  const c = item.safeChanges as Record<string, unknown>;
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
    default: return { icon: 'activity', category: 'Other', text: item.action.replace(/_/g, ' ') };
  }
}
