# Hosted browser Linux setup diagnosis

**Actions.** Read-only diagnosis of frozen `e5c5687aadfac676699e35015477d2c3d4df72b3` and failed CI41869035713. No product/source edits, Docker restart, hosted rerun, push or deployment.

## Observed failure versus established defect

The sanitized CI step log records `cases:0`, `failures:0`, `setupFailed:true`, `sourceChanges:0`, then exit1. Dependency verification passed first. No browser acceptance case ran. The log contains **no underlying exception message or setup stack**: `scripts/e2e/hosted-mcp-browser.mjs:550` deliberately records only `errorType` for setup errors. Therefore the exact thrown CI exception cannot honestly be quoted from this log.

There is a deterministic platform defect at **`scripts/e2e/hosted-mcp-browser.mjs:217`**:

```js
browser = await chromium.launch({ headless: true, executablePath: process.env.FLOWBOARD_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
```

When the override is absent, Linux receives an explicit macOS Google Chrome path. The CI step supplies no override. Earlier CI installs the pinned Playwright Chromium with `npx --no-install playwright install --with-deps chromium`; the legacy browser step then passes. That installed browser is bypassed by the hosted runner's explicit path. Installed Playwright1.64.1 checks explicit path existence and throws `Failed to launch chromium because executable doesn't exist at ...` (`node_modules/playwright-core/lib/coreBundle.js:41343–41348`). This is the expected error once this line is reached, **not an observed CI stack**. Another earlier setup error cannot be excluded solely from the intentionally sparse log.

The working comparison is already in the same source: `scripts/e2e/diagnostic.mjs:34–35` applies the macOS path only on Darwin and omits `executablePath` on Linux. It is the runner that passed immediately before the hosted step.

`launch-options-proof.mjs/.json` evaluates the actual source launch statements in a capturing VM context. Linux/Windows hosted options contain the macOS path; legacy options omit the explicit path. Both preserve an explicit override. This is **source-derived option proof, not a real browser or Linux runtime test**.

## Minimal proposed repair

Use the already-established legacy runner pattern in the hosted runner only:

```js
const executablePath = process.env.FLOWBOARD_CHROME_EXECUTABLE ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
```

The managed pinned browser is selected by Playwright on Linux; explicit overrides and the existing macOS default remain available. An invalid explicit executable must still fail. Keep all24cases, assertions, synthetic provider/callback interception, external-request refusal, console checks, source hashes, random-schema ownership and cleanup unchanged. No application authentication, UI or transport changes are indicated by this evidence. Do not replace a failed setup with a skip.

**Why and options.** A browser test must choose a browser that exists on its host. Playwright's managed binary follows the pinned package; a macOS application path is host-specific. Reusing the working platform choice is narrower than introducing a new launch abstraction, changing workflow browser installation or adding packages. Additional credential-safe setup phase labels could improve future diagnosis, but are a separate optional change; raw setup errors may contain sensitive URLs and must not simply be dumped.

## Local proof plan before another hosted run

1. Freeze criteria and authorize only the bounded launch change. Preserve this failed CI log and current official review records.
2. After approval, start Docker only for a concrete isolated Linux proof. Reuse the cached exact Node24.15.0 image/Linux dependencies after checking versions; a package-only setup stage installs the pinned Playwright1.64.1 Chromium and system libraries. No database URLs, credentials, HOME or user profiles enter setup. The existing Linux image may need `git` because the runner inventories tracked source.
3. Use a fresh public `e5c5687` source snapshot plus the proposed small runner change, a disposable local Git index for its existing `git ls-files` inventory, isolated Next output and a dedicated synthetic `flowboard_ui_test` PostgreSQL database. Keep the original checkout and approved evidence untouched. Reuse the existing runner rather than build a substitute acceptance harness.
4. First prove an actual Linux managed headless Chromium launch with no override; then execute the unchanged full `npm run test:hosted-mcp-browser` path. Require24/24, zero setup failure, sourceChanges0, clean expected console/network classification and own-resource cleanup. Existing synthetic Google/Claude interception must remain; no external provider action is authorized.
5. Independently review the exact repair, bind fresh local evidence and only then allow the parent-controlled single exact-candidate CI confirmation. API/legacy browser success from this CI run remains evidence for its own frozen target, not blanket approval for a later target.

**Evidence and limits.** No local Linux browser execution occurred in this diagnosis. Docker remains off. The evidence proves a platform-specific launch defect and a minimal existing fix pattern; it does not prove all hosted-browser cases pass on Linux after that fix. No user action needed for diagnosis; Architect owns criteria, implementation authorization and the next local proof.
