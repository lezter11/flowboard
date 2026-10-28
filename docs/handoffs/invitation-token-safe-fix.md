# Invitation token: what a safe fix needs (decision for the Architect)

Status: proposal only. Invitation create and resend behavior is unchanged tonight.

1. **Today:** `POST /api/v1/projects/:id/invitations` (`apps/api/src/http/routes/invitations.ts:98`) and resend (`:336`) return the raw invitation token in the JSON body, so the inviter's client sees the bearer credential.
2. **Delivery gap:** `apps/api/src/services/email-adapter.ts` is a simulation (it records calls and never sends). No real channel delivers the token, so today the token in the response is the only way an invitee can accept.
3. **Consequence of removing it now:** no invitee can accept an invitation until a delivery channel exists. Removing the field alone breaks invitations entirely.
4. **Interim option (recommended):** return the token only when the request sets `revealToken: true` and the actor is the workspace owner. Other actors never receive it. This is a response-shape addition, so it needs approval.
5. **Required change:** a real email adapter sends the invitation link. Then remove `token` from create and resend responses, and check that receipts never store it.
6. **Preview endpoint:** `GET /api/v1/invitations/preview?token=…` returns only project name, role, inviter display name, expiry, status and whether the signed-in email matches. It never echoes the token, lists members, or reveals project description.
7. **Preview failure states:** invalid, expired, revoked, accepted, superseded, email mismatch, already a member. Unauthenticated preview is allowed but rate-limited.
8. **Acceptance tests:** no token in any JSON response or receipt row; preview for every failure state; replay of accept returns the same outcome and does not re-add access.
9. **Contract impact:** removing `token` from create and resend responses changes a shared response shape, so it needs your explicit decision and an OpenAPI update.
10. **Not done here:** no token removal, no preview route, no email adapter change.
