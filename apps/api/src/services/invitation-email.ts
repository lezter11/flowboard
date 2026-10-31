/**
 * Invitation email content (B-10, redesigned as a board card in B-15). Every user-supplied value is
 * either bounded and stripped of control characters (the subject and the plain text) or HTML-escaped
 * (the HTML body). The accept link uses the shape the web accept screen reads: `/invitation?token=...`.
 *
 * The email is styled like a card in an "In progress" column. Only the invitation id, the recipient
 * and the project and inviter names are shown. The token appears only in the accept link.
 */

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface InvitationEmailInput {
  projectName: string;
  inviterName: string;
  role: string;
  expiresAt: string;
  acceptUrl: string;
  /** The invitation id (inv_<uuid>). The card key comes from its tail only, never from the token. */
  invitationId: string;
  /** The invitee. Shown in the assignee row and the source of the initials. Never logged. */
  recipientEmail: string;
  appOrigin?: string;
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

/** The palette a theme needs. Every text and fill pair in both themes is checked for WCAG AA. */
export interface EmailTheme {
  canvas: string;
  card: string;
  tint: string;
  ink: string;
  muted: string;
  plum: string;
  accent: string;
  line: string;
  col: string;
  colInk: string;
  btn: string;
  btnInk: string;
}

/** Light theme, from the approved card preview (design/flowboard-ui/invite-email-card-preview.html). */
export const EMAIL_COLORS: EmailTheme = {
  canvas: '#F8F5FA',
  card: '#FFFFFF',
  tint: '#F1EBF5',
  ink: '#2D2532',
  muted: '#5F5468',
  plum: '#302638',
  accent: '#684B7C',
  line: '#E3D9E9',
  col: '#DCEEFD',
  colInk: '#1D4A73',
  btn: '#684B7C',
  btnInk: '#FFFFFF',
};

/** Dark theme, from the same preview. Applied by the @media (prefers-color-scheme: dark) block. */
export const EMAIL_COLORS_DARK: EmailTheme = {
  canvas: '#151018',
  card: '#241C2A',
  tint: '#2D2335',
  ink: '#F1EAF5',
  muted: '#B9ABC4',
  plum: '#2A2132',
  accent: '#B79AD0',
  line: '#3A2F42',
  col: '#1A2A3B',
  colInk: '#A9CDF2',
  btn: '#B79AD0',
  btnInk: '#1F1626',
};

export interface Chip {
  bg: string;
  ink: string;
}

/** Role chip colours. Each text colour clears 4.5:1 on its own chip, in both themes. */
export const ROLE_CHIP: Record<string, Chip> = {
  manager: { bg: '#E9DDF2', ink: '#4B2F63' },
  member: { bg: '#D7F3E2', ink: '#1E5A36' },
  viewer: { bg: '#DCEEFD', ink: '#1D4A73' },
};
export const ROLE_CHIP_DARK: Record<string, Chip> = {
  manager: { bg: '#34273F', ink: '#E2CCF2' },
  member: { bg: '#1E3A2A', ink: '#A8E3BE' },
  viewer: { bg: '#1B3550', ink: '#BCDDF8' },
};

/** The due chip (the invitation expiry date) and the "You are here" chip. */
export const EXPIRY_CHIP: Chip = { bg: '#FBEFD9', ink: '#6B4A12' };
export const EXPIRY_CHIP_DARK: Chip = { bg: '#3B2E14', ink: '#F2D9A0' };
export const YOU_CHIP: Chip = { bg: '#E9DDF2', ink: '#4B2F63' };
export const YOU_CHIP_DARK: Chip = { bg: '#34273F', ink: '#E2CCF2' };

/** What the role can do: three short, warm items per role. */
export const ROLE_ABILITIES: Record<string, [string, string, string]> = {
  manager: ['Manage boards', 'Manage people', 'Create and move cards'],
  member: ['Create and move cards', 'Comment on cards', 'Upload images'],
  viewer: ['View cards', 'Read comments', 'View images'],
};

/** One line under the card title, by role. */
export const ROLE_DESCRIPTION: Record<string, string> = {
  member: 'Join as a Member. Boards appear once an Owner shares them with you.',
  manager: 'Join as a Manager. You can manage boards and people.',
  viewer: 'Join as a Viewer. You can view the boards an Owner shares with you.',
};

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** The hosted header lockup on the app origin. It is a public static file and carries alt text. */
export function emailImageUrls(appOrigin: string) {
  return {
    lockup: `${appOrigin}/email/flowboard-lockup-dark.png`,
  };
}

/**
 * Initials for the assignee avatar, from the recipient's email local part. Letters only. The local
 * part splits on anything that is not a letter (dots, underscores, hyphens, digits, plus tags). Two
 * parts give the first letter of each. One part gives its first two letters. Nothing gives "F".
 */
export function recipientInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[^\p{L}]+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '').slice(0, 2);
  return (letters || 'F').toUpperCase();
}

/** Card key INV-XXXX: the last four letters or digits of the invitation id. Never the token. */
export function cardKey(invitationId: string): string {
  const tail = String(invitationId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
  return `INV-${tail || '0000'}`;
}

/** Day-only UTC date. The input is shortened to YYYY-MM-DD and any other text is dropped. */
export function expiryDate(value: string): string {
  const match = /\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : '';
}

/** "Due 7 Nov" from a YYYY-MM-DD date, or '' when the date is not a real calendar day. */
export function dueLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `Due ${day} ${MONTHS[month - 1]}`;
}

/**
 * Dark-mode rules, generated from the dark theme so the two cannot drift. Each class's inline light
 * value is overridden only inside prefers-color-scheme: dark, with !important.
 */
function darkStyleBlock(): string {
  const d = EMAIL_COLORS_DARK;
  const rules = [
    `.fb-cv{background-color:${d.canvas} !important}`,
    `.fb-card{background-color:${d.card} !important}`,
    `.fb-plum{background-color:${d.plum} !important}`,
    `.fb-col{background-color:${d.col} !important}`,
    `.fb-tint{background-color:${d.tint} !important}`,
    `.fb-btn{background-color:${d.btn} !important}`,
    `.fb-accent-bg{background-color:${d.accent} !important}`,
    `.fb-line-bg{background-color:${d.line} !important}`,
    `.fb-ink{color:${d.ink} !important}`,
    `.fb-mut{color:${d.muted} !important}`,
    `.fb-colink{color:${d.colInk} !important}`,
    `.fb-btnink{color:${d.btnInk} !important}`,
    `.fb-accent{color:${d.accent} !important}`,
    `.fb-stripe{border-left-color:${d.accent} !important}`,
    `.fb-role-manager{background-color:${ROLE_CHIP_DARK.manager!.bg} !important;color:${ROLE_CHIP_DARK.manager!.ink} !important}`,
    `.fb-role-member{background-color:${ROLE_CHIP_DARK.member!.bg} !important;color:${ROLE_CHIP_DARK.member!.ink} !important}`,
    `.fb-role-viewer{background-color:${ROLE_CHIP_DARK.viewer!.bg} !important;color:${ROLE_CHIP_DARK.viewer!.ink} !important}`,
    `.fb-due{background-color:${EXPIRY_CHIP_DARK.bg} !important;color:${EXPIRY_CHIP_DARK.ink} !important}`,
    `.fb-you{background-color:${YOU_CHIP_DARK.bg} !important;color:${YOU_CHIP_DARK.ink} !important}`,
  ];
  return `<style>@media (prefers-color-scheme: dark){${rules.join('')}}</style>`;
}

export function buildInvitationEmail(input: InvitationEmailInput): InvitationEmailContent {
  const project = plainLine(input.projectName, 100) || 'a project';
  const inviter = plainLine(input.inviterName, 100) || 'A Flowboard member';
  const recipient = plainLine(input.recipientEmail, 254);
  const roleKey = ROLE_CHIP[input.role] ? input.role : 'member';
  const role = ROLE_LABELS[roleKey] ?? 'Member';
  const expires = expiryDate(input.expiresAt);
  const due = dueLabel(expires);
  const key = cardKey(input.invitationId);
  const url = input.acceptUrl;
  const subject = plainLine(`${inviter} invited you to ${project} on Flowboard`, 160);
  const preheader = `${inviter} invited you to ${project} as ${role}.`;
  const description = ROLE_DESCRIPTION[roleKey]!;
  const footerLine = `Sent because ${inviter} invited you. Not expecting it? Ignore this email.`;
  const abilities = ROLE_ABILITIES[roleKey]!;
  const chip = ROLE_CHIP[roleKey]!;
  const expiresLine = expires ? `This invitation expires on ${expires} (UTC).` : '';

  const text = [
    `${inviter} invited you to a project.`,
    '',
    'In progress (1)',
    `  Join ${project}`,
    `  ${key} | ${role}${due ? ` | ${due}` : ''}`,
    `  ${description}`,
    '  Progress: 1 of 3',
    '  [x] Invitation sent',
    '  [>] Accept invitation (you are here)',
    '  [ ] Open project',
    `  Assigned to you: ${recipient}`,
    '',
    `Accept invitation: ${url}`,
    '',
    `You can: ${abilities.join('; ')}.`,
    ...(expiresLine ? [expiresLine] : []),
    '',
    footerLine,
  ].join('\n');

  const c = EMAIL_COLORS;
  const e = escapeHtml;
  const img = input.appOrigin ? emailImageUrls(input.appOrigin) : null;
  const dueChip = due
    ? `<td align="right" style="text-align:right;"><span class="fb-due" style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:${EXPIRY_CHIP.bg};color:${EXPIRY_CHIP.ink};font-family:${FONT_STACK};font-size:12px;font-weight:700;">${e(due)}</span></td>`
    : '';
  const roleClass = `fb-role-${roleKey}`;
  const abilityPills = abilities
    .map((label) => `<span class="fb-tint fb-ink" style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border-radius:999px;background-color:${c.tint};color:${c.ink};font-family:${FONT_STACK};font-size:13px;line-height:1.3;">${e(label)}</span>`)
    .join('');

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${e(subject)}</title>`,
    darkStyleBlock(),
    '</head>',
    `<body class="fb-cv" style="margin:0;padding:0;background-color:${c.canvas};font-family:${FONT_STACK};" bgcolor="${c.canvas}">`,
    `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${e(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-cv" bgcolor="${c.canvas}" style="background-color:${c.canvas};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-card" style="width:100%;max-width:600px;border-radius:16px;overflow:hidden;" bgcolor="${c.card}">`,
    // Header band: dark plum with the lockup.
    `<tr><td align="left" class="fb-plum" bgcolor="${c.plum}" style="padding:22px 28px;background-color:${c.plum};">`,
    img
      ? `<img src="${e(img.lockup)}" width="200" height="48" alt="Flowboard" style="display:block;border:0;outline:none;text-decoration:none;width:200px;height:48px;">`
      : `<span style="font-family:${FONT_STACK};font-size:22px;font-weight:700;color:#e6d7f0;">Flowboard</span>`,
    '</td></tr>',
    // Intro line.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:24px 28px 8px 28px;background-color:${c.card};font-family:${FONT_STACK};font-size:16px;line-height:1.45;color:${c.ink};">`,
    `<span class="fb-ink"><strong>${e(inviter)}</strong> invited you to a project.</span>`,
    '</td></tr>',
    // The "In progress" column, with one card in it.
    `<tr><td style="padding:12px 24px 0 24px;background-color:${c.card};" class="fb-card" bgcolor="${c.card}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-col" bgcolor="${c.col}" style="border-radius:16px;background-color:${c.col};"><tr><td style="padding:12px;">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td class="fb-colink" style="font-family:${FONT_STACK};font-size:13px;font-weight:700;color:${c.colInk};padding:0 4px 10px 2px;">In progress</td>`,
    `<td align="right" style="padding:0 2px 10px 0;"><span class="fb-card fb-colink" style="display:inline-block;padding:1px 9px;border-radius:999px;background-color:${c.card};color:${c.colInk};font-family:${FONT_STACK};font-size:12px;font-weight:700;">1</span></td>`,
    '</tr></table>',
    // The card: plum left stripe, role chip, key, due date, title, description, progress and steps.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-card" bgcolor="${c.card}" style="background-color:${c.card};border-radius:12px;"><tr>`,
    `<td class="fb-stripe" width="5" style="width:5px;border-left:5px solid ${c.accent};border-radius:12px 0 0 12px;font-size:1px;line-height:1px;">&nbsp;</td>`,
    '<td style="padding:16px 18px 16px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td><span class="${roleClass}" style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:${chip.bg};color:${chip.ink};font-family:${FONT_STACK};font-size:12px;font-weight:700;">${e(role)}</span>`,
    `&nbsp;<span class="fb-tint fb-mut" style="display:inline-block;padding:3px 8px;border-radius:6px;background-color:${c.tint};color:${c.muted};font-family:${MONO_STACK};font-size:11px;">${e(key)}</span></td>`,
    dueChip,
    '</tr></table>',
    `<p class="fb-ink" style="margin:12px 0 4px 0;font-family:${FONT_STACK};font-size:19px;line-height:1.3;font-weight:700;color:${c.ink};">Join ${e(project)}</p>`,
    `<p class="fb-ink" style="margin:0 0 14px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.45;color:${c.ink};">${e(description)}</p>`,
    // Progress: 1 of 3, filled to a third.
    `<p class="fb-mut" style="margin:0 0 6px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.4;color:${c.muted};text-align:right;">1 of 3</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td width="33%" class="fb-accent-bg" bgcolor="${c.accent}" style="width:33%;height:6px;line-height:6px;font-size:1px;border-radius:3px 0 0 3px;background-color:${c.accent};">&nbsp;</td>`,
    `<td class="fb-tint" bgcolor="${c.tint}" style="height:6px;line-height:6px;font-size:1px;border-radius:0 3px 3px 0;background-color:${c.tint};">&nbsp;</td>`,
    '</tr></table>',
    // Steps: sent (done), accept (current, "You are here"), open project (to do).
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">`,
    `<tr><td class="fb-mut" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;color:${c.muted};"><span aria-hidden="true" class="fb-accent" style="color:${c.accent};">&#10003;</span>&nbsp; Invitation sent</td></tr>`,
    `<tr><td class="fb-ink" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;font-weight:700;color:${c.ink};"><span aria-hidden="true" class="fb-accent" style="color:${c.accent};">&#9679;</span>&nbsp; Accept invitation&nbsp;<span class="fb-you" style="display:inline-block;padding:1px 8px;border-radius:999px;background-color:${YOU_CHIP.bg};color:${YOU_CHIP.ink};font-size:11px;font-weight:700;">You are here</span></td></tr>`,
    `<tr><td class="fb-mut" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;color:${c.muted};"><span aria-hidden="true">&#9675;</span>&nbsp; Open project</td></tr>`,
    '</table>',
    // Divider and the assignee row.
    `<div class="fb-line-bg" style="height:1px;line-height:1px;font-size:1px;background-color:${c.line};margin:14px 0 12px 0;">&nbsp;</div>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td valign="middle" width="28" align="center" class="fb-btn" bgcolor="${c.btn}" style="width:28px;height:28px;border-radius:14px;background-color:${c.btn};font-family:${FONT_STACK};font-size:11px;font-weight:700;color:${c.btnInk};">`,
    `<span class="fb-btnink" style="color:${c.btnInk};">${e(recipientInitials(recipient))}</span></td>`,
    `<td valign="middle" style="padding-left:10px;font-family:${FONT_STACK};font-size:12px;line-height:1.35;">`,
    `<span class="fb-mut" style="color:${c.muted};">Assigned to you</span><br>`,
    `<span class="fb-ink" style="font-weight:700;color:${c.ink};word-break:break-all;">${e(recipient)}</span>`,
    '</td></tr></table>',
    '</td></tr></table>',
    '</td></tr></table>',
    '</td></tr>',
    // Primary button: full width, a table cell with the fill, so Outlook draws it too.
    `<tr><td style="padding:20px 24px 4px 24px;background-color:${c.card};" class="fb-card" bgcolor="${c.card}">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td align="center" class="fb-btn" bgcolor="${c.btn}" style="padding:16px 20px;border-radius:14px;background-color:${c.btn};">`,
    `<a href="${e(url)}" target="_blank" class="fb-btnink" style="display:block;font-family:${FONT_STACK};font-size:17px;line-height:20px;font-weight:700;color:${c.btnInk};text-decoration:none;">Accept invitation &rarr;</a>`,
    '</td></tr></table>',
    '</td></tr>',
    // Fallback: the full link as text.
    `<tr><td align="center" class="fb-card" bgcolor="${c.card}" style="padding:8px 24px 8px 24px;background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};word-break:break-all;">`,
    `<span class="fb-mut">Or copy:</span> <span class="fb-colink" style="color:${c.colInk};">${e(url)}</span>`,
    '</td></tr>',
    // You can: the three abilities for the role.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:12px 28px 0 28px;background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.4;color:${c.muted};">`,
    `<span class="fb-mut" style="color:${c.muted};">You can</span>`,
    '</td></tr>',
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:6px 28px 12px 28px;background-color:${c.card};">${abilityPills}</td></tr>`,
    // Footer: why the person received it.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:14px 28px 26px 28px;border-top:1px solid ${c.line};background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};">${e(footerLine)}</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
}
