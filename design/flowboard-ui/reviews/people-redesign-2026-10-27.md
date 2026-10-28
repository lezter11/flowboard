# People redesign — local preview

The People screen is a compact project directory with a member summary, project and role selectors, search, role labels, and a link to the project overview. It uses Flowboard's existing workspace colors, responsive layout and reduced-motion treatment. Project membership and board access are presented as separate concepts.

The preview shows the directory only to project Owners and known project Managers, and clears the prior roster and counts on loss of access. Membership management remains in the project overview for the Owner preview; invitation and role edits are not connected on this screen. The sample roles come from global fixture records and are not authoritative project-scoped grants.

Verification: focused VM tests cover scope, filters, navigation, role-change clearing and no mutations. Browser inspection covered the roster, project and role filtering, role switch and light/dark views. These checks do not establish production authorization, invitation delivery, server data or integrated acceptance.
