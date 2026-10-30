/**
 * Invitation email content (B-10). Every user-supplied value is either bounded and stripped of
 * control characters (names in the subject and the plain text) or HTML-escaped (the HTML body).
 * The accept link uses the shape the web accept screen reads: `/invitation?token=...`.
 */

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};

export interface InvitationEmailInput {
  projectName: string;
  inviterName: string;
  role: string;
  expiresAt: string;
  acceptUrl: string;
}

export interface InvitationEmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Removes control characters, including CR and LF, and bounds the length. */
export function plainLine(value: string, max: number): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** HTML-escapes text for an element body or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The accept link: origin from configuration, token URL-encoded. */
export function acceptInvitationUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/invitation?token=${encodeURIComponent(token)}`;
}

export function buildInvitationEmail(input: InvitationEmailInput): InvitationEmailContent {
  const project = plainLine(input.projectName, 100) || 'a project';
  const inviter = plainLine(input.inviterName, 100) || 'A Flowboard member';
  const role = ROLE_LABELS[input.role] ?? 'Member';
  const expires = plainLine(input.expiresAt, 40).slice(0, 10);
  const url = input.acceptUrl;

  const subject = `You are invited to ${project} on Flowboard`;
  const text = [
    `${inviter} invited you to join ${project} on Flowboard as ${role}.`,
    '',
    `Accept the invitation: ${url}`,
    '',
    `This link expires on ${expires} (UTC). If you were not expecting it, you can ignore this email.`,
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;">',
    `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(project)}</strong> on Flowboard as ${escapeHtml(role)}.</p>`,
    `<p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
    `<p style="color:#6b7280;font-size:13px;">This link expires on ${escapeHtml(expires)} (UTC). If you were not expecting it, you can ignore this email.</p>`,
    '</body></html>',
  ].join('');

  return { subject, text, html };
}
