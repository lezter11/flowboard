import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvitationEmail, EMAIL_COLORS, EXPIRY_CHIP, escapeHtml, expiryDate, initialsOf, ROLE_ABILITIES, ROLE_CHIP, emailImageUrls } from '../src/services/invitation-email.ts';

// B-12: the invitation email in the Flowboard theme. Structure, escaping, colour contrast and subject.

const ORIGIN = 'https://flowboard-app-uat.pages.dev';
const URL_ = `${ORIGIN}/invitation?token=SAMPLE`;
const base = {
  appOrigin: ORIGIN,
  projectName: 'Spring Launch',
  inviterName: 'Asha Rao',
  role: 'manager',
  expiresAt: '2026-11-06T10:00:00.000Z',
  acceptUrl: URL_,
};

// The tag sequence of the rendered HTML, as a fingerprint. A change to the layout changes this line.
const STRUCTURE =
  'html head meta meta meta meta title /title /head body div /div table tr td table tr td img /td /tr tr td img /td /tr tr td table tr td /td td strong /strong /td /tr /table /td /tr tr td h1 /h1 table tr td p /p p /p table tr td span /span /td td span /span /td /tr /table /td /tr /table /td /tr tr td p /p table tr td /td td /td td /td td /td td /td /tr /table /td /tr tr td table tr td a /a /td /tr /table /td /tr tr td p /p table tr td /td /tr /table /td /tr tr td div /div /td /tr tr td table tr td img /td td /td /tr /table /td /tr /table /td /tr /table /body /html';

/** Relative luminance and WCAG contrast, to check the palette. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('B-12 email structure: table layout, 600px cap, preheader, logo, and the fingerprint', () => {
  const { html } = buildInvitationEmail(base);
  const tags = [...html.matchAll(/<(\/?[a-zA-Z0-9]+)/g)].map((m) => m[1]).join(' ');
  assert.equal(tags, STRUCTURE, 'the layout changed: review it, then update the fingerprint');
  assert.ok(html.includes('max-width:600px'), '600px maximum width');
  assert.ok(html.includes('role="presentation"'), 'layout tables are presentation tables');
  assert.ok(html.includes('name="color-scheme" content="light dark"'), 'colour-scheme meta');
  assert.ok(html.includes('name="supported-color-schemes" content="light dark"'), 'supported schemes meta');
  assert.ok(html.includes('display:none;max-height:0'), 'hidden preheader');
  assert.ok(html.includes('Asha Rao invited you to Spring Launch as Manager'), 'preheader text');
  assert.ok(html.includes(`src="${ORIGIN}/email/flowboard-lockup-dark.png"`), 'gradient lockup image on the app origin');
  assert.ok(html.includes('alt="Flowboard"'), 'lockup has alt text');
  assert.equal(emailImageUrls(ORIGIN).mark, `${ORIGIN}/apple-touch-icon.png`);
});

test('B-12 email: inline styles only, no script, no web font, no external stylesheet', () => {
  const { html } = buildInvitationEmail(base);
  assert.ok(!/<style/i.test(html), 'no style element');
  assert.ok(!/<script/i.test(html), 'no script');
  assert.ok(!/<link\b/i.test(html), 'no external stylesheet or font link');
  assert.ok(!/@import|url\(/i.test(html), 'no CSS imports or url() fonts');
  assert.ok(!/font-face/i.test(html), 'no web font rules');
  assert.ok(html.includes('font-family:-apple-system'), 'system font stack');
});

test('B-12 email: one primary button to the accept link, and a plain fallback link under it', () => {
  const { html, text } = buildInvitationEmail(base);
  const links = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(links)], [URL_], 'every link goes to the accept URL');
  assert.ok(html.includes('>Accept invitation</a>'), 'primary button text');
  assert.ok(html.includes(`>${URL_}</td>`), 'the full URL shows in the copy box');
  assert.ok(html.includes('>Manager</span>'), 'role chip');
  assert.ok(html.includes('Expires 2026-11-06 (UTC)'), 'expiry chip');
  assert.ok(text.includes(URL_), 'plain text carries the link');
});

test('B-12 email footer: states why the person received it', () => {
  const { html, text } = buildInvitationEmail(base);
  const footer = 'You received this because Asha Rao invited you to a Flowboard project. If you do not expect this, ignore it.';
  assert.ok(html.includes(footer));
  assert.ok(text.includes(footer));
});

test('B-12 escaping: names with markup become text, and no raw < from a name reaches the HTML', () => {
  const hostile = buildInvitationEmail({
    ...base,
    projectName: 'Launch <img src=x onerror=alert(1)> "&\'',
    inviterName: '<script>alert(2)</script>',
  });
  assert.ok(!hostile.html.includes('<script>alert(2)'), 'no raw script from the inviter name');
  assert.ok(!hostile.html.includes('<img src=x'), 'no raw image from the project name');
  assert.ok(hostile.html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), 'inviter escaped');
  assert.ok(hostile.html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'project escaped');
  assert.ok(hostile.html.includes('&quot;&amp;&#39;'), 'quotes and ampersands escaped');
  // Every '<' left in the HTML belongs to the template: each tag opens with a known name.
  const tagNames = new Set(['html', 'head', 'meta', 'title', 'body', 'div', 'table', 'tr', 'td', 'img', 'h1', 'p', 'strong', 'span', 'a']);
  for (const m of hostile.html.matchAll(/<\/?([a-zA-Z0-9]+)/g)) {
    assert.ok(tagNames.has(m[1]!.toLowerCase()), `unexpected tag ${m[1]}`);
  }
});

test('B-12 subject: names only, one line, bounded, no header injection', () => {
  const crlf = buildInvitationEmail({
    ...base,
    projectName: 'Project\r\nBcc: victim@example.net',
    inviterName: 'Eve\nSubject: spoof',
  });
  assert.ok(!/[\r\n]/.test(crlf.subject), 'subject has no CR or LF');
  assert.ok(crlf.subject.length <= 160, 'subject is bounded');
  assert.ok(crlf.subject.endsWith('on Flowboard'));
  const long = buildInvitationEmail({ ...base, projectName: 'P'.repeat(400) });
  assert.ok(long.subject.length <= 160);
  assert.equal(buildInvitationEmail(base).subject, 'Asha Rao invited you to Spring Launch on Flowboard');
});

test('B-12 colours: every text and button pair meets WCAG AA (4.5:1)', () => {
  const c = EMAIL_COLORS;
  const pairs: Array<[string, string, string]> = [
    ['ink on card', c.ink, c.card],
    ['muted on card', c.muted, c.card],
    ['muted on canvas', c.muted, c.canvas],
    ['white on accent button', '#FFFFFF', c.accent],
    ['plum wordmark on card', c.plum, c.card],
    ['white on plum band text', '#FFFFFF', c.plum],
    ['initials white on avatar', '#FFFFFF', c.accent],
    ['ability text on tint', c.ink, c.tint],
    ['monospace link on code box', c.ink, c.code],
    ['footer on canvas', c.muted, c.canvas],
    ['role chip: manager', ROLE_CHIP.manager!.ink, ROLE_CHIP.manager!.bg],
    ['role chip: member', ROLE_CHIP.member!.ink, ROLE_CHIP.member!.bg],
    ['role chip: viewer', ROLE_CHIP.viewer!.ink, ROLE_CHIP.viewer!.bg],
    ['expiry chip', EXPIRY_CHIP.ink, EXPIRY_CHIP.bg],
    ['accent link on card', c.accent, c.card],
  ];
  for (const [label, fg, bg] of pairs) {
    assert.ok(contrast(fg, bg) >= 4.5, `${label}: ${contrast(fg, bg).toFixed(2)}`);
  }
});

test('B-12 escapeHtml: the five characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('B-13 design: the header is the dark plum band with the gradient lockup, and the hero is hosted', () => {
  const { html } = buildInvitationEmail(base);
  assert.ok(html.includes(`bgcolor="${EMAIL_COLORS.plum}"`), 'plum header band with a bgcolor fallback');
  assert.ok(html.includes('width="200" height="48"'), 'lockup has width and height');
  assert.ok(html.includes(`src="${ORIGIN}/email/invite-board-hero.png"`), 'hero hosted on the app origin');
  assert.ok(html.includes('alt="Illustration of a three-column Flowboard board'), 'hero has descriptive alt text');
  assert.ok(html.includes('width="552" height="184"'), 'hero has width and height');
});

test('B-13 design: an initials avatar is a table cell, not an image', () => {
  const { html } = buildInvitationEmail(base);
  assert.ok(html.includes(`bgcolor="${EMAIL_COLORS.accent}"`));
  assert.ok(html.includes('>AR</td>'), 'initials from the inviter name');
  assert.equal(initialsOf('asha rao'), 'AR');
  assert.equal(initialsOf('Zoë'), 'Z');
  assert.equal(initialsOf('<img>'), 'I', 'markup contributes letters only');
  assert.equal(initialsOf('  '), 'F', 'fallback when there are no letters');
});

test('B-13 design: the abilities follow the role, and the role chip is coloured per role', () => {
  for (const role of ['manager', 'member', 'viewer']) {
    const { html, text } = buildInvitationEmail({ ...base, role });
    for (const item of ROLE_ABILITIES[role]!) {
      assert.ok(html.includes(`>${item}</td>`), `${role}: ${item}`);
      assert.ok(text.includes(item));
    }
    assert.ok(html.includes(`background-color:${ROLE_CHIP[role]!.bg};color:${ROLE_CHIP[role]!.ink}`), `${role} chip`);
  }
  const viewer = buildInvitationEmail({ ...base, role: 'viewer' }).html;
  assert.ok(!viewer.includes('Manage boards'), 'a viewer is not told it can manage boards');
});

test('B-13 design: the expiry chip carries a date only; copy-link box holds the full URL', () => {
  assert.equal(expiryDate('2026-11-06T10:00:00.000Z'), '2026-11-06');
  assert.equal(expiryDate('nonsense <b>'), '');
  const { html } = buildInvitationEmail(base);
  assert.ok(html.includes('Expires 2026-11-06 (UTC)'));
  assert.ok(html.includes(`font-family:ui-monospace`), 'monospace link box');
  assert.ok(html.includes(`>${URL_}</td>`), 'the full URL in the copy box');
});

test('B-13 design: the primary button is a table cell with fill and padding, so Outlook draws it', () => {
  const { html } = buildInvitationEmail(base);
  assert.ok(/<td align="center" bgcolor="#302638" style="padding:16px 40px;/.test(html), 'button cell carries the fill and padding');
  assert.ok(html.includes('>Accept invitation</a>'));
});
