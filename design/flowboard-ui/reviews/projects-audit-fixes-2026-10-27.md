# Projects preview audit fixes — 2026-10-27

Scope: the local HTML design preview, not the production application or backend.

- Added project membership management using the preview's existing synthetic people. Board access remains separately granted; removing a project member removes their board grants, and re-adding them does not restore those grants.
- Project and board context flows into People and Settings and the Share link. People and Settings display portfolio data read-only because their older mutation model is not connected to it. Invitations are simulated and no email is sent.
- Project and access mutations report failed browser storage and roll back. Board changes remain in the current tab on storage failure, with a warning and retry control; they are not durable until storage succeeds.
- Project board counts and access information remain visible at narrow widths, and small project labels are larger.

Verification: JavaScript syntax checks and `git diff --check` passed. The local mock board regression script and additional model checks passed for project membership, reload, board grants, revoke/re-add and storage failures. An independent source review checked script initialization, access fallback and stale People data after role changes. The browser session inspected during review served stale content, so visual layout, browser role switching, clipboard behavior and end-to-end flows remain unverified. No numeric UI score is claimed. These checks do not verify backend authorization or integrated persistence.
