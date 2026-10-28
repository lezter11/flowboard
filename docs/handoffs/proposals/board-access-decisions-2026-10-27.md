# Board access decisions — 27 October 2026

These product decisions supersede conflicting older project-inheritance statements. They are design decisions, not evidence of implemented or verified authorization.

- Existing project members receive **no automatic board grants** at migration. The workspace Owner explicitly grants access per board.
- Only the workspace Owner can grant or revoke board access. A project role does not become stronger because of a board grant.
- A project Manager can create a board in a project they administer. Board creation does not automatically grant that Manager or other project members access; the Owner must grant it. This preserves the Owner-only grant authority.
- A non-Owner needs both active project membership and access to the particular board. An Owner has implicit access to all boards in their own workspace; ownership in another workspace grants no extra rights here. A combined view remains inside one project.

The full cutover is described in [the access proposal](project-board-access-v2-2026-10-27.md) and [frozen acceptance criteria](../../reviews/BOARD-ACCESS-20261027/criteria.json). Until every affected path and the independent review gate pass, neither a grant table nor a subset of protected routes establishes the new security boundary. Existing deployment, backend handoff, and feature-checklist statuses are unchanged.

## Working implementation choices

These conservative choices flesh out the product decisions for development; they are not additional user-confirmed policy or evidence of implementation.

- Owner creation may include explicit initial grants to current project members; a Manager creation request must not include grants. A Manager creating a board cannot open it until the Owner grants access.
- Invitations and membership changes grant no boards. Removing or leaving project membership invalidates all associated board grants; rejoining does not resurrect them.
- Owners and project Managers retain the current project-level people directory, without exposing board membership. Board-specific assignee and mention pickers must limit candidates to people who can access that board.
- Project membership can expose the project itself even with zero board grants. Board listings return an empty set in that case. Unknown, foreign, and inaccessible boards and descendants share the existing non-enumerating not-found response.
- Freeze board-grant edits while the project or board is archived, consistent with the existing preview; restore access administration when reopened. Removal of project membership must still revoke effective board access while archived.
- Grants and revocations need auditable outcomes and must coordinate with protected writes; duplicate requests are no-ops, not extra audit events. Grant revisions invalidate board-scoped paging, and any combined-query cursor must also bind its accessible board set.
- Security enforcement is an atomic cutover across all board-derived routes. Draft files and helper tests must remain unmounted until the route inventory, schemas, grant-admin API and complete adversarial tests are ready. Do not deploy an intermediate state that gives non-Owners access using the old project-only checks.
