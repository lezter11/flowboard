# Import UI bounded handoff

Actions: actual status polling, complete preview/result cursors, explicit unknown-status mappings, guarded atomic confirmation with retained original replay identity, URL batch recovery, receipt/card links, safe server CSV download and honest cancellation/error states implemented. Only actual committed status reports creation.

Why and options: a2xx may represent work in progress; the backend status is authoritative. Confirmation binds the original digest/default/version/key; temporary preview upload cannot be deduplicated before its id is returned, so an uncertain upload stays explicit and never automatically repeats.

Evidence and limits: 281/281 web tests, typecheck and optimized build19/19 passed. Exact4-file source hashes/raw logs/six new meaningful boundary+state cases and browser cases are in ui-import-implementation.json. IMP11 actor/timestamp metadata is absent from current contract; root was notified. Backend inherited mapping-key risk also reported. No browser/PG acceptance or score/closure claimed.

Next / your input: root runs synthetic workbook integration and final independent immutable review; hostedUAT pending deployment. Continuing preferences/Google avatar phase using its separately frozen criteria.
