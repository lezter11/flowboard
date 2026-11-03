# Invitation UI bounded handoff

Actions: paged status history, explicit loaded counts, safe delivery states, original-operation retries and actor/project-scoped unsent draft memory implemented. Expired/revoked invitations prepare a new create, pending replacements use resend. Revoke confirms and clears the one-time link. Token remains in memory and clears when the dialog closes.

Why and options: accepting a create request queues delivery, so success copy says link created and uses the backend list delivery summary for provider outcome. An uncertain response may follow commit: fields/other writes lock until the same original key/payload/action succeeds. A first definitive refusal permits correction.

Evidence and limits: 269/269 web tests, web typecheck and optimized build (19/19) passed. Exact source hashes, seven new meaningful transport/state tests, raw logs and retained failed rounds are in ui-invitation-implementation.json. Source and controlled tests do not establish actual browser/PG acceptance, final review or hosted readiness.

Next / your input: root can run the listed synthetic browser cases. No feature closure or score claimed. Continuing the cursor-feed phase.
