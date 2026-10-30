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

/** Brand tokens (apps/web/src/styles): plum mark, warm canvas, white card. Checked for 4.5:1 contrast. */
export const EMAIL_COLORS = {
  canvas: '#F8F5FA',
  card: '#FFFFFF',
  ink: '#2D2532',
  muted: '#5F5468',
  plum: '#302638',
  accent: '#684B7C',
  badge: '#F1EBF5',
  line: '#E3D9E9',
} as const;

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The logo is the app's own icon, served from the app origin. It is public (static Pages asset). */
export function logoUrl(appOrigin: string): string {
  return `${appOrigin}/apple-touch-icon.png`;
}

export function buildInvitationEmail(input: InvitationEmailInput & { appOrigin?: string }): InvitationEmailContent {
  const project = plainLine(input.projectName, 100) || 'a project';
  const inviter = plainLine(input.inviterName, 100) || 'A Flowboard member';
  const role = ROLE_LABELS[input.role] ?? 'Member';
  const expires = plainLine(input.expiresAt, 40).slice(0, 10);
  const url = input.acceptUrl;
  const logo = input.appOrigin ? logoUrl(input.appOrigin) : '';

  const subject = plainLine(`${inviter} invited you to ${project} on Flowboard`, 160);
  const preheader = `${inviter} invited you to ${project} as ${role}. Accept by ${expires}.`;
  const footerLine = `You received this because ${inviter} invited you to a Flowboard project. If you do not expect this, ignore it.`;

  const text = [
    `${inviter} invited you to join ${project} on Flowboard as ${role}.`,
    '',
    `Accept the invitation: ${url}`,
    '',
    `This invitation expires on ${expires} (UTC).`,
    '',
    footerLine,
  ].join('\n');

  const c = EMAIL_COLORS;
  const e = escapeHtml;
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${e(subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${c.canvas};font-family:${FONT_STACK};" bgcolor="${c.canvas}">`,
    `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${e(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.canvas}" style="background-color:${c.canvas};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;" bgcolor="${c.card}">`,
    // Header: the app icon and the wordmark.
    `<tr><td style="padding:20px 28px;border-bottom:1px solid ${c.line};background-color:${c.card};" bgcolor="${c.card}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="vertical-align:middle;padding-right:10px;">${logo ? `<img src="${e(logo)}" width="32" height="32" alt="Flowboard logo" style="display:block;border:0;width:32px;height:32px;">` : ''}</td>`,
    `<td style="vertical-align:middle;font-family:${FONT_STACK};font-size:20px;font-weight:700;color:${c.plum};">Flowboard</td>`,
    '</tr></table>',
    '</td></tr>',
    // Body.
    `<tr><td style="padding:32px 28px 8px 28px;background-color:${c.card};" bgcolor="${c.card}">`,
    `<h1 style="margin:0 0 12px 0;font-family:${FONT_STACK};font-size:22px;line-height:1.3;font-weight:700;color:${c.ink};">Join ${e(project)}</h1>`,
    `<p style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.5;color:${c.ink};">${e(inviter)} invited you to join <strong>${e(project)}</strong> on Flowboard.</p>`,
    `<p style="margin:0 0 24px 0;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background-color:${c.badge};color:${c.accent};font-family:${FONT_STACK};font-size:13px;font-weight:700;">Role: ${e(role)}</span></p>`,
    '</td></tr>',
    // Primary button.
    `<tr><td style="padding:0 28px 8px 28px;background-color:${c.card};" bgcolor="${c.card}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td bgcolor="${c.accent}" style="border-radius:8px;background-color:${c.accent};">`,
    `<a href="${e(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT_STACK};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">Accept invitation</a>`,
    '</td></tr></table>',
    '</td></tr>',
    // Fallback link and expiry.
    `<tr><td style="padding:20px 28px 8px 28px;background-color:${c.card};" bgcolor="${c.card}">`,
    `<p style="margin:0 0 8px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${c.muted};">If the button does not work, copy this link into your browser:</p>`,
    `<p style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.5;word-break:break-all;"><a href="${e(url)}" target="_blank" style="color:${c.accent};text-decoration:underline;">${e(url)}</a></p>`,
    `<p style="margin:0 0 24px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${c.muted};">This invitation expires on ${e(expires)} (UTC).</p>`,
    '</td></tr>',
    // Footer.
    `<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid ${c.line};background-color:${c.card};" bgcolor="${c.card}">`,
    `<p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};">${e(footerLine)}</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
}
