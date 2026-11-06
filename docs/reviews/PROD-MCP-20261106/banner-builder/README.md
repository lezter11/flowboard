# Banner builder handoff — source held

This is builder evidence, not independent approval, deployed Pages behavior, backend authentication or owner acceptance. Base revision: `c69865187cdb53c54633557bfd8e2577e6d9c09a`.

## Actions

Eight UI files implement a global, fixed-copy, polite status banner, a bounded pure controller, the default-inactive public status asset, its no-store header rule, and layout offsets. The exact file list and reachable web/functions/contracts/config hashes are in `held-source-manifest.json`. Source manifest digest: `ef376e4754bb2a0e2d0e128c658755ad8ee82c2dfc084d4c154a2aa5a367f343`.

No API, database, contracts, dependency or root tooling source changed. The earlier held API app and router test retain SHA-256 `cba985234856c3187a1a512afca6f2eec30c545d968b5b115785f8c4a497a471` and `96d951e977ccb0a919170e1db023322cd620058df2027c32b80d34e0e339c016` respectively. No commit, push, cloud call, Docker operation or hosted CI was performed by this builder.

## Why and options

The banner reads one static same-origin file instead of asking the API/database on every poll. For example, a teammate can keep a card draft open while the notice appears or disappears; the controller never changes that draft or reloads the page. An API endpoint adds unnecessary server work, while a build-time-only flag cannot clear itself in an open tab.

The GET uses credentials omit, no-store, redirect error and explicit no-referrer. The response is capped at 1,024 bytes and 1,025 reads, with a five-second abort covering headers and body. Polling occurs about 30 seconds after settlement while visible; visibility return checks promptly. Hidden/unmounted controllers abort, stopped/stale requests cannot publish, and even an abort-ignoring fetch is never overlapped. The last valid value survives malformed content, HTML200, network failures, timeouts and failed statuses. The amended PLAN narrowly defines404/410 as an absent/retired status feature and therefore inactive, allowing open new-version tabs to clear after rollback to legacy Pages. No stale timeout silently ends a notice.

The notice occupies normal sticky document flow. A measured height follows wrapping/font/viewport changes and offsets sticky headers, fixed rails, card drawers and their available viewport heights. Existing controls remain interactive. There are no remote messages, HTML payloads, identities, release versions or URLs in the public status schema.

## Evidence and limits

- `node --test apps/web/test/release-status.test.ts`: six focused tests pass; `release-unit-round2.log`.
- `npm run test --workspace @flowboard/web`:350 pass, zero skipped/failures, exit0; `web-unit-final.log`.
- `npm run typecheck:web`: exit0; `typecheck-round2.log`.
- `NEXT_EXPORT=true NEXT_DIST_DIR=.next-banner-review npm run build:web`: exit0; `build-static-round5.log`. Next writes this static export directly to `apps/web/.next-banner-review`, as confirmed by `.next/export-detail.json`; `apps/web/out` is an older artifact. `held-export-manifest.json` hashes all146 exported files and ties them to the source manifest. The default status asset is false.
- `node docs/reviews/PROD-MCP-20261106/banner-builder/browser-proof.mjs`: final run exit0. `browser-round-2026-11-06T05-31-27.980Z/browser-proof.json` records12 passing actual Chrome scenarios,21 status requests, zero cookies/Referer headers on those requests, zero external traffic, zero unexpected synthetic API requests, zero browser errors, and successful owned browser/server cleanup.
- Screenshots in that final round cover1440px light,320px light/dark, bare sign-in/connect/name step, rail/dialog footer, and the actual mounted card-detail drawer with synthetic frontend API/session fixtures. Drawer Close and Save controls remain within the viewport with the banner active and inactive at320x720 and640x400. Save mutations were not invoked or accepted.
- The200percent test uses640x400 CSS pixels at deviceScaleFactor2 to reproduce1280x800 at200percent reflow. It does not control Chrome's browser-chrome zoom setting. Visibility tests use an explicit synthetic document visibility adapter with the real component listener, not OS tab switching. Controller unmount/abort behavior is unit-tested; browser contexts/documents are actually closed.
- The Node static server proves frontend presentation and request options; it is not Cloudflare Pages ASSETS. The independent reviewer owns actual compiled Pages Functions/ASSETS header and zero-API fastpath verification. Existing Pages middleware already exits on asset filenames containing a dot; it was not edited.
- No ignored Next production env files were present when building (`.env`, `.env.local`, `.env.production`, `.env.production.local` were checked by filename only). The harness uses an owned ephemeral loopback listener and isolated Chrome, blocks external origins, and never uses real credentials, database or hosted APIs.
- Existing old-version tabs cannot acquire this new component without a refresh. New-version tabs follow status changes without reloading. Actual deployment, stage overlays, cache/header checks and production acceptance remain architect/operator-owned.

## Failed attempts retained

The initial loopback attempt failed with sandbox EPERM. The next attempt mistakenly served old `apps/web/out`, producing no banner requests or locator. Those two original shared report files were accidentally overwritten; their observed failures were recovered from captured tool outputs in `browser-round1-failure-recovered.json` and `browser-round2-failure-recovered.json`, explicitly labelled as recovered rather than original artifacts. Round3 then reached the real banner and failed on an incorrect assumed Cancel label; the actual existing dialog uses Close and keep draft. The preserved round3 report is `browser-round3-failure.json` (also copied under the earlier diagnostic filename). Subsequent run directories are unique. The next run failed because the harness sent Escape while focus remained on the navigation trigger; the existing rail handles Escape inside the rail. The harness now uses its actual Close navigation button and asserts the rail closes. These were harness assumptions, not reasons to weaken viewport/overlap assertions. Prior pass10 is in `browser-round-2026-11-06T05-29-54.757Z`; the final pass12 includes the additional card drawer checks.

Build logs and earlier browser rounds remain preserved. The first focused unit invocation failed because the newly specified controller module did not yet exist; assertions were authored before implementation, without claiming a behavioral red-to-green regression against an existing controller.

## Next / input

Source is held. Independent scoped review, real Pages asset/header proof and architect verification must pass before consuming this handoff. No98-feature checklist or backend closure is claimed. No user action is needed from this builder.
