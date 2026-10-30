# Invitation email preview (B-12, restyled in B-13)

- `invitation-preview.html`: the email body as `buildInvitationEmail` renders it, with sample data and a placeholder token. The hosted image URLs point at the local files in `apps/web/public/email/` (and `apps/web/public/apple-touch-icon.png`) so the preview shows the real PNGs.
- `invitation-600px-light.png`: 600px, headless Chrome.
- `invitation-375px-light.png`: 375px. Chrome will not lay out a window narrower than 500px, so the email was placed in a 375px container, offset to the centre of a 500px render, and cropped to 375px.
- `invitation-600px-dark-page.png`: 600px on a dark page background. This checks that the plum header and the pastel hero read on dark. It is not a mail-client dark-mode render: the template uses explicit colours, and real inversion depends on each client. Check dark mode in the target clients during UAT.
- `src/lockup.html`, `src/hero.html`: sources for the two hosted PNGs. Rendered at 1.25x (lockup, 625x150) and 2x (hero, 1200x400), transparent backgrounds.
- Hosted files: `apps/web/public/email/flowboard-lockup-dark.png` (36,375 bytes, limit 40 KB) and `apps/web/public/email/invite-board-hero.png` (32,543 bytes, limit 60 KB).

Regenerate the preview after any template change: run `buildInvitationEmail` from `apps/api/src/services/invitation-email.ts`, then point the hosted URLs at the local files as described above.
