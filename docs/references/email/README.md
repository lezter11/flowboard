# Invitation email preview (B-12)

- `invitation-preview.html`: the generated email body, exactly as `buildInvitationEmail` renders it (sample data, placeholder token).
- `invitation-600px-light.png`: the email at 600px, headless Chrome.
- `invitation-375px-light.png`: the email at 375px. Chrome will not lay out a window narrower than 500px, so the email was centred in a 500px render and cropped to 375px.
- No dark-mode screenshots. The template sets explicit colours and no dark styles, so a headless browser shows the same light render. Real dark-mode output depends on each mail client's own inversion, and this environment cannot reproduce it. Check dark mode in the target clients during UAT.
- Regenerate the preview after any template change: run `buildInvitationEmail` from `apps/api/src/services/invitation-email.ts` and write its `html` to `invitation-preview.html`.
