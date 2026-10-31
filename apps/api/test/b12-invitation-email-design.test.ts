import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvitationEmail,
  cardKey,
  dueLabel,
  EMAIL_COLORS,
  EMAIL_COLORS_DARK,
  EXPIRY_CHIP,
  EXPIRY_CHIP_DARK,
  escapeHtml,
  expiryDate,
  emailImageUrls,
  recipientInitials,
  ROLE_ABILITIES,
  ROLE_CHIP,
  ROLE_CHIP_DARK,
  ROLE_DESCRIPTION,
  YOU_CHIP,
  YOU_CHIP_DARK,
} from '../src/services/invitation-email.ts';

// B-12 and B-15: the invitation email as a board card in an "In progress" column. Structure, escaping,
// the dark-mode block, colour contrast in both themes, the three roles, and the subject.

const ORIGIN = 'https://flowboard-app-uat.pages.dev';
const TOKEN = 'SAMPLE-TOKEN-7f3a';
const URL_ = `${ORIGIN}/invitation?token=${TOKEN}`;
const base = {
  appOrigin: ORIGIN,
  projectName: 'Spring Launch',
  inviterName: 'Asha Rao',
  role: 'manager',
  expiresAt: '2026-11-06T10:00:00.000Z',
  acceptUrl: URL_,
  invitationId: 'inv_3c9f0a1b-22de-4e5f-8a7b-0123456789ab',
  recipientEmail: 'shubham.singh@example.com',
};

// The tag sequence of the rendered HTML, as a fingerprint. A change to the layout changes this line.
const STRUCTURE =
  'html head meta meta meta meta title /title style /style /head body div /div table tr td table tr td img /td /tr tr td span strong /strong /span /td /tr tr td table tr td table tr td /td td span /span /td /tr /table table tr td /td td table tr td span /span span /span /td td span /span /td /tr /table p /p p /p p /p table tr td /td td /td /tr /table table tr td span /span /td /tr tr td span /span span /span /td /tr tr td span /span /td /tr /table div /div table tr td span /span /td td span /span br span /span /td /tr /table /td /tr /table /td /tr /table /td /tr tr td table tr td a /a /td /tr /table /td /tr tr td span /span span /span /td /tr tr td span /span /td /tr tr td span /span span /span span /span /td /tr tr td /td /tr /table /td /tr /table /body /html';

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

test('B-15 structure: nested tables, 600px cap, preheader, lockup, and the fingerprint', () => {
  const { html } = buildInvitationEmail(base);
  const tags = [...html.matchAll(/<(\/?[a-zA-Z0-9]+)/g)].map((m) => m[1]).join(' ');
  assert.equal(tags, STRUCTURE, 'the layout changed: review it, then update the fingerprint');
  assert.ok(html.includes('max-width:600px'), '600px maximum width');
  assert.ok(html.includes('role="presentation"'), 'layout tables are presentation tables');
  assert.ok(html.includes('name="color-scheme" content="light dark"'), 'colour-scheme meta');
  assert.ok(html.includes('name="supported-color-schemes" content="light dark"'), 'supported schemes meta');
  assert.ok(html.includes('display:none;max-height:0'), 'hidden preheader');
  assert.ok(html.includes('Asha Rao invited you to Spring Launch as Manager'), 'preheader text');
  assert.ok(html.includes(`src="${ORIGIN}/email/flowboard-lockup-dark.png"`), 'lockup on the app origin');
  assert.ok(html.includes('alt="Flowboard"'), 'lockup has alt text');
  assert.ok(html.includes('width="200" height="48"'), 'lockup has width and height');
  assert.equal(emailImageUrls(ORIGIN).lockup, `${ORIGIN}/email/flowboard-lockup-dark.png`);
  assert.ok(!html.includes('invite-board-hero'), 'no hero image in the card design');
});

test('B-15 email: the intro, column, card and steps follow the approved preview', () => {
  const { html } = buildInvitationEmail(base);
  assert.ok(html.includes('<strong>Asha Rao</strong> invited you to a project.'), 'intro line');
  assert.ok(html.includes('>In progress</td>'), 'column label');
  assert.ok(html.includes('>Join Spring Launch</p>'), 'card title');
  assert.ok(html.includes(ROLE_DESCRIPTION.manager!), 'role description');
  assert.ok(html.includes('>1 of 3</p>'), 'progress label');
  assert.ok(html.includes('width="33%"'), 'progress filled to a third');
  assert.ok(html.includes('&#10003;') && html.includes('&#9679;') && html.includes('&#9675;'), 'step glyphs');
  assert.ok(html.includes('>You are here</span>'), 'current step chip');
  assert.ok(html.includes('Assigned to you'), 'assignee label');
  assert.ok(html.includes('shubham.singh@example.com'), 'recipient address on the card');
  assert.ok(html.includes('border-left:5px solid'), 'plum left stripe');
  assert.ok(html.includes('Accept invitation &rarr;</a>'), 'primary button text');
  assert.ok(html.includes(`>${URL_}</span>`), 'full accept link in the fallback line');
});

test('B-15 email: inline styles only, dark mode in one style block, no script, no web font', () => {
  const { html } = buildInvitationEmail(base);
  assert.equal((html.match(/<style/gi) ?? []).length, 1, 'exactly one style element');
  assert.ok(/<head>[\s\S]*<style>@media \(prefers-color-scheme: dark\)\{/.test(html), 'the style block is in the head and is a dark-mode query');
  assert.ok(!/<script/i.test(html), 'no script');
  assert.ok(!/<link\b/i.test(html), 'no external stylesheet or font link');
  assert.ok(!/@import|url\(/i.test(html), 'no CSS imports or url() fonts');
  assert.ok(!/font-face/i.test(html), 'no web font rules');
  assert.ok(!/gradient|background-clip|text-fill/i.test(html), 'no gradient text or text-clip (not email-safe)');
  assert.ok(html.includes('font-family:-apple-system'), 'system font stack');
});

test('B-15 dark mode: every dark class in the style block uses the dark palette', () => {
  const { html } = buildInvitationEmail(base);
  const d = EMAIL_COLORS_DARK;
  for (const rule of [
    `.fb-cv{background-color:${d.canvas} !important}`,
    `.fb-card{background-color:${d.card} !important}`,
    `.fb-col{background-color:${d.col} !important}`,
    `.fb-colink{color:${d.colInk} !important}`,
    `.fb-btn{background-color:${d.btn} !important}`,
    `.fb-btnink{color:${d.btnInk} !important}`,
    `.fb-stripe{border-left-color:${d.accent} !important}`,
    `.fb-role-manager{background-color:${ROLE_CHIP_DARK.manager!.bg} !important;color:${ROLE_CHIP_DARK.manager!.ink} !important}`,
    `.fb-due{background-color:${EXPIRY_CHIP_DARK.bg} !important;color:${EXPIRY_CHIP_DARK.ink} !important}`,
    `.fb-you{background-color:${YOU_CHIP_DARK.bg} !important;color:${YOU_CHIP_DARK.ink} !important}`,
  ]) {
    assert.ok(html.includes(rule), `dark rule: ${rule}`);
  }
  assert.ok(html.includes('<body class="fb-cv"'), 'the body carries the dark class');
});

test('B-15 email: one primary button to the accept link, and a plain fallback link under it', () => {
  const { html, text } = buildInvitationEmail(base);
  const links = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(links)], [URL_], 'every link goes to the accept URL');
  assert.equal(links.length, 1, 'one anchor: the button');
  assert.ok(html.includes(`>${URL_}</span>`), 'the full URL shows as text');
  assert.ok(text.includes(`Accept invitation: ${URL_}`), 'plain text carries the link');
});

test('B-15 email footer: states why the person received it, in both parts', () => {
  const { html, text } = buildInvitationEmail(base);
  const footer = 'Sent because Asha Rao invited you. Not expecting it? Ignore this email.';
  assert.ok(html.includes(footer));
  assert.ok(text.includes(footer));
});

test('B-15 cards for all three roles: role chip, description, abilities, due date, and card key', () => {
  for (const role of ['manager', 'member', 'viewer'] as const) {
    const { html, text } = buildInvitationEmail({ ...base, role });
    const label = role[0]!.toUpperCase() + role.slice(1);
    assert.ok(html.includes(`>${label}</span>`), `${role}: role chip`);
    assert.ok(html.includes(`class="fb-role-${role}"`), `${role}: role chip class for dark mode`);
    assert.ok(html.includes(ROLE_DESCRIPTION[role]!), `${role}: description`);
    for (const item of ROLE_ABILITIES[role]!) {
      assert.ok(html.includes(`>${item}</span>`), `${role}: ability ${item}`);
      assert.ok(text.includes(item), `${role}: text ability ${item}`);
    }
    assert.ok(html.includes('>Due 6 Nov</span>'), `${role}: due chip is the expiry date`);
    assert.ok(html.includes('>INV-89AB</span>'), `${role}: card key from the invitation id`);
    assert.ok(text.includes('INV-89AB | '), `${role}: text card key`);
    assert.ok(text.includes('Due 6 Nov'), `${role}: text due`);
  }
  const viewer = buildInvitationEmail({ ...base, role: 'viewer' }).html;
  assert.ok(!viewer.includes('Manage boards'), 'a viewer is not told it can manage boards');
});

test('B-15 card key and initials: from the invitation id tail and the recipient local part only', () => {
  assert.equal(cardKey('inv_3c9f0a1b-22de-4e5f-8a7b-0123456789ab'), 'INV-89AB');
  assert.equal(cardKey('inv_ab'), 'INV-NVAB', 'the tail of the whole id, prefix included, for short ids');
  assert.equal(cardKey(''), 'INV-0000');
  assert.equal(recipientInitials('shubham.singh@example.com'), 'SS');
  assert.equal(recipientInitials('asha@example.com'), 'AS');
  assert.equal(recipientInitials('a1b@example.com'), 'AB', 'digits split the local part');
  assert.equal(recipientInitials('o_brien-kate@example.com'), 'OB', 'underscores and hyphens split too');
  assert.equal(recipientInitials('+@example.com'), 'F', 'no letters falls back');
  assert.equal(recipientInitials('zoë@example.com'), 'ZO');
});

test('B-15 the token appears only inside the accept link, never in the card key or initials', () => {
  const { html, text } = buildInvitationEmail({ ...base, invitationId: 'inv_ab12cd34', recipientEmail: 'ab@example.com' });
  assert.ok(html.includes('>INV-CD34</span>'), 'the key is the invitation id tail');
  for (const copy of [html, text]) {
    for (const hit of copy.matchAll(new RegExp(TOKEN, 'g'))) {
      const at = hit.index ?? 0;
      assert.equal(copy.slice(at - 'invitation?token='.length, at), 'invitation?token=', 'the token sits only after the link path');
    }
  }
});

test('B-12 escaping: names with markup become text, and no raw < from a name reaches the HTML', () => {
  const hostile = buildInvitationEmail({
    ...base,
    projectName: 'Launch <img src=x onerror=alert(1)> "&\'',
    inviterName: '<script>alert(2)</script>',
    recipientEmail: '<b>x</b>@example.com',
  });
  assert.ok(!hostile.html.includes('<script>alert(2)'), 'no raw script from the inviter name');
  assert.ok(!hostile.html.includes('<img src=x'), 'no raw image from the project name');
  assert.ok(!hostile.html.includes('<b>x</b>'), 'no raw markup from the recipient address');
  assert.ok(hostile.html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), 'inviter escaped');
  assert.ok(hostile.html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'project escaped');
  assert.ok(hostile.html.includes('&quot;&amp;&#39;'), 'quotes and ampersands escaped');
  // Every '<' left in the HTML belongs to the template: each tag opens with a known name.
  const tagNames = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'div', 'table', 'tr', 'td', 'img', 'p', 'strong', 'span', 'a', 'br']);
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

test('B-15 colours: every text and fill pair meets WCAG AA in both themes, and every graphic meets 3:1', () => {
  const themes: Array<[string, typeof EMAIL_COLORS, typeof ROLE_CHIP, typeof EXPIRY_CHIP, typeof YOU_CHIP]> = [
    ['light', EMAIL_COLORS, ROLE_CHIP, EXPIRY_CHIP, YOU_CHIP],
    ['dark', EMAIL_COLORS_DARK, ROLE_CHIP_DARK, EXPIRY_CHIP_DARK, YOU_CHIP_DARK],
  ];
  for (const [theme, c, roles, due, you] of themes) {
    const pairs: Array<[string, string, string]> = [
      [`${theme}: ink on card`, c.ink, c.card],
      [`${theme}: muted on card`, c.muted, c.card],
      [`${theme}: muted on canvas`, c.muted, c.canvas],
      [`${theme}: ink on tint (ability pills)`, c.ink, c.tint],
      [`${theme}: muted on tint (card key)`, c.muted, c.tint],
      [`${theme}: column label on column`, c.colInk, c.col],
      [`${theme}: column count on card`, c.colInk, c.card],
      [`${theme}: fallback link on card`, c.colInk, c.card],
      [`${theme}: accent step glyph on card`, c.accent, c.card],
      [`${theme}: button label on button`, c.btnInk, c.btn],
      [`${theme}: avatar initials on avatar`, c.btnInk, c.btn],
      [`${theme}: due chip`, due.ink, due.bg],
      [`${theme}: you-are-here chip`, you.ink, you.bg],
      ...(['manager', 'member', 'viewer'] as const).map((r): [string, string, string] => [`${theme}: role chip ${r}`, roles[r]!.ink, roles[r]!.bg]),
    ];
    for (const [label, fg, bg] of pairs) {
      assert.ok(contrast(fg, bg) >= 4.5, `${label}: ${contrast(fg, bg).toFixed(2)}`);
    }
    const graphics: Array<[string, string, string]> = [
      [`${theme}: plum stripe on card`, c.accent, c.card],
      [`${theme}: progress fill on track`, c.accent, c.tint],
    ];
    for (const [label, fg, bg] of graphics) {
      assert.ok(contrast(fg, bg) >= 3, `${label}: ${contrast(fg, bg).toFixed(2)}`);
    }
  }
});

test('B-15 colours: the dark theme is the approved palette', () => {
  assert.equal(EMAIL_COLORS_DARK.canvas, '#151018');
  assert.equal(EMAIL_COLORS_DARK.card, '#241C2A');
  assert.equal(EMAIL_COLORS_DARK.ink, '#F1EAF5');
  assert.equal(EMAIL_COLORS_DARK.muted, '#B9ABC4');
  assert.equal(EMAIL_COLORS_DARK.accent, '#B79AD0');
  assert.equal(EMAIL_COLORS_DARK.col, '#1A2A3B');
  assert.equal(EMAIL_COLORS_DARK.colInk, '#A9CDF2');
  assert.equal(EMAIL_COLORS_DARK.btnInk, '#1F1626');
});

test('B-12 escapeHtml: the five characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('B-15 due date: a real UTC day only, and no due chip without one', () => {
  assert.equal(expiryDate('2026-11-06T10:00:00.000Z'), '2026-11-06');
  assert.equal(expiryDate('nonsense <b>'), '');
  assert.equal(dueLabel('2026-11-07'), 'Due 7 Nov');
  assert.equal(dueLabel('2026-13-01'), '');
  assert.equal(dueLabel(''), '');
  const none = buildInvitationEmail({ ...base, expiresAt: 'nonsense' });
  assert.ok(!none.html.includes('class="fb-due"'), 'no due chip for an invalid expiry');
  assert.ok(!none.text.includes('expires on'), 'no expiry sentence for an invalid expiry');
});

test('B-15 plain text mirrors the card: column, card, steps, abilities, footer', () => {
  const { text } = buildInvitationEmail({ ...base, role: 'member' });
  for (const line of [
    'Asha Rao invited you to a project.',
    'In progress (1)',
    '  Join Spring Launch',
    '  INV-89AB | Member | Due 6 Nov',
    `  ${ROLE_DESCRIPTION.member}`,
    '  Progress: 1 of 3',
    '  [x] Invitation sent',
    '  [>] Accept invitation (you are here)',
    '  [ ] Open project',
    '  Assigned to you: shubham.singh@example.com',
    'You can: Create and move cards; Comment on cards; Upload images.',
    'This invitation expires on 2026-11-06 (UTC).',
    'Sent because Asha Rao invited you. Not expecting it? Ignore this email.',
  ]) {
    assert.ok(text.includes(line), `text has: ${line}`);
  }
});
