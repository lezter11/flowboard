# Drawer and Drive links release

Application commit `7cc0059d8456a5db5848fe49eebf4b904f1dd4b2`. [GitHub CI](https://github.com/lezter11/flowboard/actions/runs/43612222774) passed 22 of 22 steps. Local PostgreSQL 17.11 aggregate passed 1,968 API, 140 contracts, 22 MCP and one artifact test. The exact final web export passed 357 web tests, eight drawer scenarios and three Drive scenarios in Chrome. Independent Drive backend review passed local acceptance with 9.18. The executable feature handoff record remains a separate checklist item.

| Environment | Worker version | Canonical Pages deployment | Signed-out smoke |
| --- | --- | --- | --- |
| UAT | `bba4fc93-b423-4962-b6f7-e9b34f13d892` | `a96eb6f8-c11a-429a-8d84-360ee4500c7b` | 11/11 |
| Production | `5e0695d0-f47a-444a-9640-7b350c19505d` | `51c03bd3-8483-4b93-9484-4464e4510c24` | 11/11 |

Both verified Neon branches advanced from `0027` to `0029`. The migration adds card document links, with two validated constraints and a purge trigger. Its second run applied nothing. Native binary document upload remains archived separately. Cloudflare confirmed the existing environment-specific Neon bindings. The Aiven rehearsal was outside this release.

Production restore point `br-wandering-sun-a1lp4rcv` was verified ready before the migration, with no compute or removal of existing backups. It expires 2026-11-16 at 15:53 UTC. The rollback anchors are production Worker `cc432b3b-ecd0-4e4c-8939-3c1504a49623` and Pages `83456258-6b73-436f-80de-d6bb3f329767`. A code rollback leaves additive `0029` and any saved links in place. Restoring the whole database would discard later edits and is outside this deployment.

Production serves an active planned-maintenance notice. Chrome confirmed it at 320 px with no page error. [Signed-in checks](SMOKE-CHECKLIST.md) are for the owner. The banner is active until the owner requests clearing or clears it after acceptance.
