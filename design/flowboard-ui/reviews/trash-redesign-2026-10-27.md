# Trash redesign — local preview

The redesigned screen shows one project's deleted cards with board context, the deletion time, 24-hour deadline, remaining time and recovery status. It supports project selection and search, uses the existing Flowboard palette in light and dark themes, and respects reduced motion. The list is filtered using the preview's project and board visibility.

The original prototype's Restore action did not actually return the card to its board. Restore is therefore disabled and clearly labeled as unconnected until a verified restore flow is available. The countdown uses the device clock and sample data; it is not a server deadline or authorization check. The preview's roles are global fixture roles rather than verified project-specific server grants.

Verification: six focused VM tests cover project and board scope, role eligibility, expiry boundary, search and read-only rendering. Browser inspection covered the layout, role switching, project filter, and light/dark themes. These checks do not validate a real server, restore, pagination, or integrated authorization.
