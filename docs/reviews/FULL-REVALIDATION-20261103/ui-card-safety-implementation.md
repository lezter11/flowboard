# Card safety bounded handoff

Actions: field saving and status movement are explicit separate operations; uncertain field/status/create/undo requests keep original inputs and keys. Actor/card/board memory retains drafts across view remounts. Undo uses its dedicated endpoint with the original move result version. Confirmed full-form creation is separate from current-card reads. Session refusal clears protected cached board/card data while own drafts stay separate. Drawer/nested-dialog inert behavior and keyboard focus are repaired; internal links/programmatic route changes have an unsaved guard.

Why and options: separate operations avoid claiming that a two-endpoint Save is atomic. Replaying an uncertain request must not silently become a new write. Undo cannot adopt a teammate's later version. Current permission is required even when own draft text exists.

Evidence and limits: 293/293 web tests, typecheck and optimized19/19 build passed. Eight new payload/state regressions, exact31-file manifest, failed rounds and browser cases in ui-card-safety-implementation.json. Root backend exact-gap/one-use undo repairs and browser acceptance are pending. Native Back/Forward retains critical memory drafts but is not synchronously blocked; other forms under native traversal remain an explicit gap. No score/feature closure.

Next / your input: root integration/final review; consume confirmed import actor receipt and mappingEntries in a small follow-up next. HostedUAT follows deployment.
