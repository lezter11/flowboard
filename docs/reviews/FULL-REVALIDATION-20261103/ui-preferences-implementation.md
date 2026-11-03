# Preferences/avatar UI bounded handoff

Actions: owner-only workspace name/timezone form, current-version conflict recovery and actor/workspace-scoped memory drafts implemented. Safe Google-managed avatars render where typed metadata exists, with initials fallback, anonymous/no-referrer loading and a narrow CSP allowlist.

Why and options: a Manager role in a shared project cannot authorize workspace administration. Polling must preserve edited values and their original version rather than silently rebasing an overwrite. Google owns avatar/email; no manual upload is introduced.

Evidence and limits: 285/285 web tests, typecheck and optimized19/19 build passed. Source hashes, meaningful URL/timezone/OCC/wire regressions, failedround and browsercases in ui-preferences-implementation.json. ActualGoogle, browser/API/PG acceptance, finalindependent review and hostedUAT are not claimed.

Next / your input: root browser validation and backendtimezone validation; continuing frozen card-save/undo/navigation/a11y phase. No score or closure.
