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

/** Brand tokens (apps/web/src/styles). Every text and fill pair is checked for WCAG AA in the tests. */
export const EMAIL_COLORS = {
  canvas: '#F8F5FA',
  card: '#FFFFFF',
  tint: '#F1EBF5',
  ink: '#2D2532',
  muted: '#5F5468',
  plum: '#302638',
  accent: '#684B7C',
  line: '#E3D9E9',
  code: '#F8F5FA',
} as const;

/** Role chip colours: background and text. Each text colour clears 4.5:1 on its own chip. */
export const ROLE_CHIP: Record<string, { bg: string; ink: string }> = {
  manager: { bg: '#E9DDF2', ink: '#4B2F63' },
  member: { bg: '#D7F3E2', ink: '#1E5A36' },
  viewer: { bg: '#DCEEFD', ink: '#1D4A73' },
};
export const EXPIRY_CHIP = { bg: '#FBEFD9', ink: '#6B4A12' } as const;

/** What the role can do: three short, warm items per role. */
export const ROLE_ABILITIES: Record<string, [string, string, string]> = {
  manager: ['Manage boards', 'Manage people', 'Create and move cards'],
  member: ['Create and move cards', 'Comment on cards', 'Upload images'],
  viewer: ['View cards', 'Read comments', 'View images'],
};

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** Hosted images on the app origin. They are public static files and carry alt text. */
export function emailImageUrls(appOrigin: string) {
  return {
    lockup: `${appOrigin}/email/flowboard-lockup-dark.png`,
    hero: `${appOrigin}/email/invite-board-hero.png`,
    mark: `${appOrigin}/apple-touch-icon.png`,
  };
}

/** Two initials from the inviter's name: the first letter of the first two words. Letters only. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words
    .map((w) => w.match(/\p{L}/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return (letters || 'F').toUpperCase();
}

/** Day-only UTC date for the chip. The input is shortened to YYYY-MM-DD and any other text is dropped. */
export function expiryDate(value: string): string {
  const match = /\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : '';
}

export function buildInvitationEmail(input: InvitationEmailInput & { appOrigin?: string }): InvitationEmailContent {
  const project = plainLine(input.projectName, 100) || 'a project';
  const inviter = plainLine(input.inviterName, 100) || 'A Flowboard member';
  const roleKey = ROLE_CHIP[input.role] ? input.role : 'member';
  const role = ROLE_LABELS[roleKey] ?? 'Member';
  const expires = expiryDate(input.expiresAt) || plainLine(input.expiresAt, 40).slice(0, 10);
  const url = input.acceptUrl;
  const subject = plainLine(`${inviter} invited you to ${project} on Flowboard`, 160);
  const preheader = `${inviter} invited you to ${project} as ${role}.`;
  const footerLine = `You received this because ${inviter} invited you to a Flowboard project. If you do not expect this, ignore it.`;
  const abilities = ROLE_ABILITIES[roleKey]!;
  const chip = ROLE_CHIP[roleKey]!;

  const text = [
    `${inviter} invited you to join ${project} on Flowboard as ${role}.`,
    '',
    `Accept the invitation: ${url}`,
    '',
    `You can: ${abilities.join('; ')}.`,
    `This invitation expires on ${expires} (UTC).`,
    '',
    footerLine,
  ].join('\n');

  const c = EMAIL_COLORS;
  const e = escapeHtml;
  const img = input.appOrigin ? emailImageUrls(input.appOrigin) : null;
  const ability = (label: string) =>
    `<td width="33%" valign="top" bgcolor="${c.tint}" style="width:33%;padding:12px 10px;background-color:${c.tint};border-radius:12px;font-family:${FONT_STACK};font-size:14px;line-height:1.4;color:${c.ink};">${e(label)}</td>`;
  const abilityCells = abilities
    .map((label, i) => (i === 0 ? ability(label) : `<td width="8" style="width:8px;font-size:1px;line-height:1px;">&nbsp;</td>${ability(label)}`))
    .join('');
  const divider = `<tr><td style="padding:0 32px;"><div style="height:1px;line-height:1px;font-size:1px;background-color:${c.line};">&nbsp;</div></td></tr>`;

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
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-radius:16px;overflow:hidden;" bgcolor="${c.card}">`,
    // Header band: dark plum with the gradient lockup.
    `<tr><td align="left" bgcolor="${c.plum}" style="padding:22px 28px;background-color:${c.plum};">`,
    img
      ? `<img src="${e(img.lockup)}" width="200" height="48" alt="Flowboard" style="display:block;border:0;outline:none;text-decoration:none;width:200px;height:48px;">`
      : `<span style="font-family:${FONT_STACK};font-size:22px;font-weight:700;color:#e6d7f0;">Flowboard</span>`,
    '</td></tr>',
    // Hero: the kanban illustration on a pale tint.
    `<tr><td align="center" bgcolor="${c.tint}" style="padding:24px 24px 20px 24px;background-color:${c.tint};">`,
    img
      ? `<img src="${e(img.hero)}" width="552" height="184" alt="Illustration of a three-column Flowboard board: To do, Doing and Done, with pastel cards." style="display:block;border:0;width:552px;height:184px;max-width:100%;">`
      : '',
    '</td></tr>',
    // Inviter with an initials avatar (a table cell, not an image).
    `<tr><td style="padding:28px 32px 0 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td valign="middle" width="44" bgcolor="${c.accent}" align="center" style="width:44px;height:44px;border-radius:22px;background-color:${c.accent};font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#FFFFFF;">${e(initialsOf(inviter))}</td>`,
    `<td valign="middle" style="padding-left:12px;font-family:${FONT_STACK};font-size:16px;line-height:1.4;color:${c.ink};"><strong>${e(inviter)}</strong> invited you to join Flowboard</td>`,
    '</tr></table>',
    '</td></tr>',
    // Heading and project summary card.
    `<tr><td style="padding:24px 32px 8px 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    `<h1 style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:26px;line-height:1.25;font-weight:700;color:${c.ink};">You are invited to ${e(project)}</h1>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${c.line};border-radius:16px;" bgcolor="${c.canvas}">`,
    `<tr><td style="padding:18px 20px 16px 20px;background-color:${c.canvas};">`,
    `<p style="margin:0 0 4px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${c.muted};">Project</p>`,
    `<p style="margin:0 0 14px 0;font-family:${FONT_STACK};font-size:22px;line-height:1.3;font-weight:700;color:${c.ink};">${e(project)}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="padding-right:8px;"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:${chip.bg};color:${chip.ink};font-family:${FONT_STACK};font-size:13px;font-weight:700;">${e(role)}</span></td>`,
    `<td><span style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:${EXPIRY_CHIP.bg};color:${EXPIRY_CHIP.ink};font-family:${FONT_STACK};font-size:13px;font-weight:700;">Expires ${e(expires)} (UTC)</span></td>`,
    '</tr></table>',
    '</td></tr></table>',
    '</td></tr>',
    // Abilities for the role.
    `<tr><td style="padding:24px 32px 8px 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    `<p style="margin:0 0 12px 0;font-family:${FONT_STACK};font-size:16px;font-weight:700;color:${c.ink};">What you will be able to do</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    abilityCells,
    '</tr></table>',
    '</td></tr>',
    // Primary button: a table cell with the fill and padding, so Outlook draws it too.
    `<tr><td align="center" style="padding:28px 32px 12px 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td align="center" bgcolor="${c.plum}" style="padding:16px 40px;border-radius:14px;background-color:${c.plum};">`,
    `<a href="${e(url)}" target="_blank" style="display:inline-block;font-family:${FONT_STACK};font-size:17px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;">Accept invitation</a>`,
    '</td></tr></table>',
    '</td></tr>',
    // Secondary: the full link in a monospace box.
    `<tr><td style="padding:12px 32px 8px 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    `<p style="margin:0 0 8px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${c.muted};">Or copy this link</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td bgcolor="${c.code}" style="padding:12px 14px;border:1px solid ${c.line};border-radius:10px;background-color:${c.code};font-family:${MONO_STACK};font-size:13px;line-height:1.5;color:${c.ink};word-break:break-all;">${e(url)}</td>`,
    '</tr></table>',
    '</td></tr>',
    divider,
    // Footer: the small mark, the reason, and nothing else.
    `<tr><td style="padding:20px 32px 28px 32px;background-color:${c.card};" bgcolor="${c.card}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    img ? `<td valign="top" style="padding-right:10px;"><img src="${e(img.mark)}" width="24" height="24" alt="" style="display:block;border:0;width:24px;height:24px;"></td>` : '',
    `<td valign="top" style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};">${e(footerLine)}</td>`,
    '</tr></table>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
}
