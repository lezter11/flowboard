/**
 * Every activity_log action name the API writes, in one list.
 *
 * The API stores action as text, so an unknown name never breaks a read. The list exists so that the
 * UI can map each name to a sentence (for example 'column_added' → "added a column") and so that a
 * new writer must add its name here on purpose. Names are lowercase snake_case and describe a fact
 * that already happened (past tense or noun form).
 *
 * Visibility for each name is decided by the writer, not by this list. See docs/API.md, "Activity
 * action names", for the scope each name uses.
 */
export const ACTIVITY_ACTIONS = [
  // Cards (board scope, card ancestry checked)
  'card_created',
  'card_updated',
  'card_moved',
  'card_trashed',
  'card_restored',
  'card_purged',
  'card_import_committed',
  'image_attached',
  'image_removed',
  // Discussion (card scope)
  'comment_created',
  'comment_updated',
  'comment_deleted',
  // Board grants (board scope)
  'board_access_granted',
  'board_access_revoked',
  // Board lifecycle (board scope)
  'board_created',
  'board_renamed',
  'board_described',
  'board_archived',
  'board_reopened',
  // Columns (board scope)
  'column_added',
  'column_renamed',
  'column_recoloured',
  'column_recategorised',
  'columns_reordered',
  'column_deleted',
  // Project landing board (board scope on the new board; project scope when cleared)
  'default_board_changed',
  // Project brief and links (project scope)
  'project_brief_updated',
  'project_links_updated',
  // Invitations (project scope; never carry the token or the invitee email)
  'invitation_sent',
  'invitation_resent',
  'invitation_revoked',
  'invitation_accepted',
  // Membership (project scope)
  'member_role_changed',
  'member_removed',
  'member_reinstated',
  'member_left',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
