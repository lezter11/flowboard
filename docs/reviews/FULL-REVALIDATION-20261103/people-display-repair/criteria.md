# People display repair acceptance — before implementation

The existing PRJ-05 user decision applies to every full-directory representation, including the name-only `/people` default and `purpose=display` alias. This does not change the feature criteria or review rubric.

- Active Member/Viewer receive 403 without identity data through default/display, including query, cursor, limit and explicit-board variants, with or without board grants. Outsiders/removed actors receive private 404.
- Owner/current Manager retain the directory, search and pagination, including archived projects and Managers without board grants. Supplying a board still requires authorization to that board.
- Board-scoped assignee/mention pickers retain their existing eligible safe identity responses and expose no emails or unrelated board/project people.
- Direct display adapter calls require an actor and the same current Owner/Manager authority. Pool callers own a transaction; caller-supplied clients require an existing transaction.
- Separate PostgreSQL connections demonstrate both orders: a committed demotion preceding directory assembly denies the request, and an authorized read holding membership locks finishes before demotion can commit.
- Preserve failed independent round1 records. New frozen source requires independent review and the full required gate list before closure.

Verification: mounted `people-directory-policy.test.ts`, legacy RBAC/People suites with an explicit administrative positive control, typecheck, then complete frozen gates. Disposable PostgreSQL only (owned container, loopback55931, PostgreSQL17.11-alpine).
