# Cursor-feed UI bounded handoff

Actions: My Tasks now queries one selected project with actual server due/priority/cursor parameters and canonical workspace calendar context. Inbox, project activity and trash retain full cursors, loaded-only counts/search scope, recovery and polling. Current session expiry overrides cached authentication; scope changes purge protected query caches and refused feeds erase cached rows while preserving the refusal.

Why and options: a first page cannot establish a global total or global search result. Controls say what is loaded and expose further pages. Due-date comparison belongs to the selected workspace; the required backend asOfDate/timezone fields are displayed directly.

Evidence and limits: 275/275 web tests, typecheck and optimized Next build19/19 passed; exact15-file manifest and raw logs in ui-feed-implementation.json. New tests include actual TanStack infinite observer refresh/replacement and refused-cache clearing. These are local tests, not real browser/API/PG acceptance. No score or feature closure.

Next / your input: root owns listed browser cases/final review/hostedUAT. Continue imports/results then preferences/avatar and card-save/undo/navigation phases.
