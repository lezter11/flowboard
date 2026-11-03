# People directory alias repair — local implementation evidence

The user-confirmed Owner/Project Manager directory policy also protects the default and explicit display form of `/projects/:id/people`. Members/Viewers retain eligible board-scoped assignee/mention pickers. Names alone are still directory data.

The mounted route checks the current role under held authorization locks before optional board lookups. The display adapter independently requires an actor, locks workspace ownership and active membership through assembly, and owns a transaction for direct Pool calls. A caller-supplied client must already be in a transaction.

New mounted tests first reproduced3failures: roster exposure, missing direct adapter actor requirement, and disclosure after a preceding Manager demotion. `red-tests.log` command exit1. Administrative and existing picker controls already passed. After repair, `green-final-tests.log` records **41/41, zero skips, command exit0**, combining9People tests with existing mounted RBAC and cleanup/People suites. The stale Member display expectation now denies403, with an explicit Owner search positive control. PostgreSQL17.11-alpine disposable container `flowboard-full-revalidation-20261103`, loopback55931; no hosted data.

Independent reviewer `/root/formal_projects_boards_round1` separately reran the3original failed assertions plus current9policy tests and3new direct-Pool/board/picker controls: **15/15, zero skips**, including both real blocked-connection demotion orders. Its5held source files were unchanged before/after. Evidence: `../people-display-retest-round1/result.json` and retained logs/manifests. This clears the reproduced defect for those bytes; it is not a complete global review or release approval.

Next: updated full frozen local gates, fresh independent domain review, then UAT-only acceptance. Prior failed formal round1 records remain intact.
