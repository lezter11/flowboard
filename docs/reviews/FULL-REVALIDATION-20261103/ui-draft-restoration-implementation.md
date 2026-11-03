# Native traversal draft restoration handoff

Actions: Settings project/board/profile, project brief/create, board create/edit, columns/new-column and import target/File now retain actor/context-scoped tab-memory drafts. Reopening/polling does not reset edited values. Stale board/column edits keep their original version until explicit review. Dirty markers survive unmount, and explicit Discard clears only the relevant draft. Project/board uncertain creation retries retain original input/key through remount.

Why and options: native Back/Forward need not be intercepted if the same actor can return to the exact unsent values. Plain fields, baseline references, immutable selected File and retained commands stay only in tab memory; reload/close warns about losing them. Navigation copy matches this behavior.

Evidence and limits: 300/300 web tests, typecheck after optimized19/19 build and diff check passed. Exact12-file manifest, five meaningful state/query-client/File/wire tests, raw logs and browser cases are in ui-draft-restoration-implementation.json. Real Back/Forward component behavior remains root browser acceptance; no score/closure.

Next / your input: root runs the native traversal cases and freezes the complete final target for independent review; hostedUAT follows local gates and deployment.
