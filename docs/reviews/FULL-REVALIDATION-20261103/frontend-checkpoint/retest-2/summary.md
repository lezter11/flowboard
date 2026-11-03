# Independent FCP-01–04 repair retest 2

**Actions:** All four original checkpoint defects are repaired under the named inverse assertions. The original failures and retest1 remain preserved. This reviewer made no application-source edits. [Structured result](result.json) records scope, counts and limits; no score or release approval is assigned.

| Finding | Independent verification |
|---|---|
| FCP-01 portfolio visibility | Actual Member hub refreshes board rename and card count24→25 without navigation, then removes the board after Owner grant revocation; authenticated canonical list200[]. Source traces current list/stat poll registration, omission/refusal erasure and removed-resource snapshot/stat invalidation. |
| FCP-02 private module baselines |23 explicit inverse assertions erase clean base/draft data on refusal, preserve user changes including an explicit empty description, rehydrate authorized clean fields with review, retain exact unknown-command payload/key and isolate actors. Actual Settings survives unrelated project addition: unsent name and clean description retained, existing database version unchanged, Save enabled and no spurious conflict. |
| FCP-03 nested dialogs | Actual keyboard Enter opens navigation confirmation above Invite; lower parent is inert. One Escape removes only the top confirmation, preserves parent/draft and returns focus to its original link. No invitationPOST. |
| FCP-04 repeat full creation | First successful receipt survives native Back. Visible Create another card clears title/priority. Two explicit intended creations produce exactly two distinct database cards. |

**Why and options:** Clear fetched private copies when access is lost; preserve only the person's changes and any original uncertain request. Adding another accessible project is a scope gain and must leave existing authorized forms intact. These differences need explicit tests because passing a form helper does not establish visible browser behavior.

**Evidence and limits:** Independently ran **315/315 web tests**, **23 explicit memory assertions**, and **4/4 real Chrome/API/PostgreSQL browser groups**, with zero failed groups. [Web log](raw/web-tests.log), [memory result](raw/private-memory-result.json), [browser result](raw/browser-01/result.json), [exact executed browser source](raw/browser-01/probe-source.mjs). The367-file manifest includes frontend/contracts source/tests/config, actual API runtime source, migrations and harness. Before/after hashes differ only for generated `apps/web/next-env.d.ts` changing its route-types reference from `.next-build` to `.next-e2e`; the other366 input files remained unchanged. This exception is explicit in [manifest-after](manifest-after.json).

The browser used isolated Chrome156, synthetic sessions, owned localhost44931/44932 and disposable PostgreSQL55931 random schema; external page HTTP was blocked. Own browser/server children and schema were cleaned. No real credentials, cookies, invitation tokens or authentication snapshots were recorded. UI-owner typecheck/optimized build logs are supplied evidence, not independently rerun here. This bounded retest does not establish exhaustive74-UI/all98-feature acceptance, every generic settings/brief/workspace restoration path, Google/email/R2/hosted Pages or final backend/Worker/image acceptance.

**Next / your input:** Root may incorporate these four bounded repairs into its full final-source freeze and independent acceptance. No user action needed. Ports44931/44932 are released.
