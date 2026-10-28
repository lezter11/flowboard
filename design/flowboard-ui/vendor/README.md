# Vendored motion libraries — Inbox design artifact

These files exist so the Inbox screen works **offline**, from disk or the local server, with no CDN at review time. They are not part of the production stack decision; [ADR 0003](../../../docs/decisions/0003-nextjs-frontend.md) governs that.

| File | Library | Version | Bytes | SHA-256 |
|---|---|---|---:|---|
| `gsap.min.js` | [GSAP](https://gsap.com/) core | 3.13.0 | 72,435 | `96c01b81f44a3290e2b4532f55e2c9534b2adc43273a19f3756b2cb41f0fd0b6` |
| `lenis.min.js` | [Lenis](https://github.com/darkroomengineering/lenis) | 1.3.26 | 18,722 | `53195c9797e7ce7bf9d7fa9242b08209e57f46de4c9dac126a6494fa780e3346` |

Sources: `https://unpkg.com/gsap@3.13.0/dist/gsap.min.js` and `https://unpkg.com/lenis@1.3.26/dist/lenis.min.js`, fetched 27 October 2026.

## Licenses

- **GSAP** is used under the [GSAP standard license](https://gsap.com/standard-license) (no-charge use; the header is retained in the file). No Club/paid plugin is included — only core `gsap`, which is what the Inbox timeline needs. The Flip plugin is **not** vendored; list reflow uses a small first-last-invert-play helper in `screens/inbox.js`.
- **Lenis** is MIT-licensed; its minified bundle is unmodified.

## Why these two, and where they stop

- **GSAP** runs one authored sequence: the triage timeline (row exit, neighbour reflow, count roll-up, reading-pane crossfade) plus the staggered list entrance. Ordinary hover, focus and pressed feedback stay in CSS. ADR 0003 reserves GSAP for "a measured, complex sequence"; the Inbox triage is that case because four animations must stay in sync after a state change.
- **Lenis** smooths **one** scroll container: the notification stream. The board, columns, card drawer and page keep native scrolling, so drag-and-drop and `position: sticky` are unaffected. `respectReducedMotion` is left at its default (`true`) and the instance is destroyed when the user prefers reduced motion.
- Neither library is a production dependency claim. The artifact is design evidence; production would adopt the same libraries through the Next.js app only after the ADR 0003 gate.

## Updating

Replace both files, then update this table and the hashes in the review manifest. Re-run `node --check` on the Inbox script and verify the reduced-motion path still destroys the Lenis instance.
