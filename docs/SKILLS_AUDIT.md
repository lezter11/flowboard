# Third-party skills and component libraries: security audit

Date: 2026-10-29. Owner: Support chat. Requested by: Architect. Status: read-only audit. Nothing was installed, executed or run. No `npm install`, no install scripts, no interpreters were run from inside any clone.

## Method and limits

- Each repository was shallow-cloned (`git clone --depth 1`) into a new scratchpad folder, outside the product repo.
- For each repository I read its licence, its hook and settings configuration, its install scripts, and the code that spawns processes, makes network calls or writes to the user's home or settings.
- Grep hits in docs, tests and fixtures were treated as weak evidence. Verdicts rest on files I actually opened.
- Two repositories had a different URL from the one in the request, see "URL discrepancies". Both were cloned under the URLs I found.
- Where a verdict says "not fully read", I checked the risky entry points only. Treat those verdicts as provisional until someone reads the rest.

## Verdicts

| # | Repository | Kind | Licence | Verdict | Main reason |
|---|---|---|---|---|---|
| 1 | superdesigndev/superdesign | VS Code extension and design canvas, not a skill | AGPL-3.0 (mostly) | DO-NOT-INSTALL | Spawns the Claude CLI with `--dangerously-skip-permissions`; AGPL copyleft |
| 2 | marvkr/better-design | Agent skill | MIT | SAFE-WITH-CHANGES | Install and registry scripts call `npx` and the network; do not run them |
| 3 | madebymustafa/design-taste | Agent skill set | MIT | SAFE-WITH-CHANGES | `install.sh` copies skills into `~/.claude`, `~/.cursor` and other user dirs; install per project instead |
| 4 | DavidHDev/canvas-ui | Next.js component showcase site, not a skill | MIT + Commons Clause | DO-NOT-INSTALL | Commons Clause forbids selling it; this is a website, not an installable library |
| 5 | paper-design/shaders | React and WebGL shader library | Apache-2.0 | LIBRARY, use in apps/web | Normal npm dependency; pin the version and review the shader code |
| 6 | ui-layouts/ui-layouts | Copy-in layout component registry | MIT | LIBRARY, copy selected pieces | Its validation and design-audit scripts are dev tools; copy only the components used |
| 7 | Hyperiux-Immersion-Labs/hyperiux-components | CLI that copies effect source into a project | MPL-2.0 for free effects, plus a separate Pro licence | DO-NOT-INSTALL the CLI as written | `npx hyperiux add` writes source into the project; Pro effects are paid |
| 8 | ibelick/motion-primitives | Copy-in React animation primitives plus CLI | MIT | LIBRARY, copy selected pieces | Its CLI and registry build scripts make network calls; do not run the CLI without review |
| 9 | ui-layouts/cursify | Cursor effect component | **Unknown** (no licence file, no licence field) | DO-NOT-USE until the licence is confirmed | No licence means no permission to copy |
| 10 | akaieuan/trickle-UI-kit | Pure-CSS text animation kit | MIT | LIBRARY, SAFE as dependency after review | Zero runtime, CSS-only; I did not read the component source in full |
| 11 | obra/superpowers | Agent skill set (workflow skills) | MIT | SAFE-WITH-CHANGES | Some skills impose a fixed workflow and gates; install selectively. Not fully read |
| 12 | DietrichGebert/ponytail | Agent skill, hooks and statusline | MIT | DO-NOT-INSTALL user-wide | Its hooks read and write `~/.claude/settings.json`; its persona asks for minimal, one-read replies, which conflicts with RULES.md |
| 13 | nextlevelbuilder/ui-ux-pro-max-skill | Agent skill with CLI and stack settings | MIT | DO-NOT-INSTALL user-wide | Its stack settings enable all project MCP servers and allow `Read(//home/**)`; scripts run `npm install -g` and fetch from the network |
| 14 | Graphify-Labs/graphify | Python knowledge-graph CLI | Apache-2.0 (plus MIT file) | SAFE-WITH-CHANGES (local use only) | By design it sends code to LLM providers (`graphify/llm.py`); install via `uv` pinned, not globally |
| 15 | JuliusBrussee/caveman | Agent skill and installer that changes settings | Apache-2.0 | DO-NOT-INSTALL | Always-on terse mode conflicts with the RULES.md teaching format; its installer edits `settings.json`; the README uses curl to install |
| 16 | addyosmani/agent-skills | Agent skill set with SessionStart hook | MIT | SAFE-WITH-CHANGES | The SessionStart hook injects a meta-skill into every session; the hook is benign, but review before enabling. Not fully read |
| 17 | Egonex-AI/Understand-Anything | Claude plugin with hooks and curl installer | MIT | DO-NOT-INSTALL | Its SessionStart hook tells the agent to execute a file and act "without asking the user"; a PostToolUse hook runs after git commits; the installer is `curl … \| bash` and writes symlinks into `$HOME` |
| 18 | ComposioHQ/awesome-claude-skills | Collection of many skills | Mixed; the document skills are Anthropic proprietary | SAFE-WITH-CHANGES (pick individual skills) | Document skills are "All rights reserved", so do not redistribute; init and bundle scripts run `pip install` and `npm install -g`. Repo has no root LICENCE |
| 19 | tt-a1i/archify | Agent skill plus viewer | Apache-2.0 | SAFE-WITH-CHANGES | Update check writes files; scripts use `sudo` in places. Not fully read |
| 20 | pbakaus/impeccable | Design detector skill with project hooks | Apache-2.0 | SAFE-WITH-CHANGES (project-scoped only) | Hooks run a binary in the project's `.claude/skills/impeccable/scripts`; keep it project-scoped, not user-wide |

## Summary for the Architect

- **Skills to consider, after changes:** better-design, design-taste (project-scoped), superpowers (selected skills only), addy agent-skills (review the hook first), archify, impeccable (project-scoped), ComposioHQ (pick individual skills, not the document ones).
- **Do not install user-wide:** superdesign, ponytail, ui-ux-pro-max, caveman, Understand-Anything.
- **Libraries for apps/web:** paper shaders (npm dependency), trickle (CSS kit), motion-primitives and ui-layouts (copy selected components). Hyperiux only with a reviewed copy, not via the CLI. Cursify is blocked until its licence is known. canvas-ui is blocked by Commons Clause.
- **Conflicts with RULES.md:** caveman (always-on terse replies vs the plain-English teaching format) and ponytail (busy-human, one-read replies) both conflict. Understand-Anything's auto-action hook conflicts with the rule that the agent must not act outside the user's instructions.

## Existing local state (read-only)

- `~/.claude/skills` contains only a `synced/` folder. I did not read it.
- The product repo already has `.impeccable/` (`config.json` and `hook.cache.json`). It contains design-detector ignores for Flowboard's own screens. Impeccable is in use here already, so there is no new install to approve for this repo.

## Per-repository notes

**1. superdesign.** Mostly AGPL-3.0, with other licences in parts. `src/providers/claudeCodeProvider.ts` spawns the Claude CLI and appends `--dangerously-skip-permissions`, with `acceptEdits` as the default permission mode. That bypasses the permission prompts that protect the user. It is a VS Code extension rather than a skill. Do not install.

**2. better-design.** MIT skill at `skills/better-design`. Scripts such as `install-animate-text.mjs` and `generate-registry-json.mjs` make network calls. Use the SKILL.md and copy only the reference material you need. Do not run the install scripts.

**3. design-taste.** MIT. `scripts/install.sh` copies every skill into `$HOME/.claude/skills`, `$HOME/.cursor/skills` and four other user directories. That is user-wide installation by design. To use it, copy the skill into one project's `.claude/skills` instead. `scripts/capture-screenshots.mjs` drives a browser; do not run it without review.

**4. canvas-ui.** MIT with the Commons Clause, which prohibits selling software whose value comes from the licensed software. This repository is a showcase website with worker code, Turnstile and analytics. It is not a skill and not a library we can ship. Do not use it as a dependency.

**5. paper shaders.** Apache-2.0. Use `@paper-design/shaders-react` as a pinned npm dependency in apps/web, after reviewing the shader sources. I did not run a build.

**6. ui-layouts.** MIT. The `registry/` folder holds copy-in components. Copy only the components used. `scripts/` are development validators. Not fully read.

**7. Hyperiux.** The free effects use MPL-2.0, and `LICENSE_EFFECTS` is a separate licence. Pro effects need a paid subscription. The CLI (`npx hyperiux add`) copies source into the project and has a `-y` flag that skips confirmation prompts. Do not run it. Copy a reviewed effect by hand if we need one.

**8. motion-primitives.** MIT. `cli/src/index.ts` and `scripts/registry-build.ts` are the CLI and registry tooling. Copy the component source by hand instead of running the CLI.

**9. cursify.** No `LICENSE` file, no licence field in `package.json`, and no licence text in the README. Under default copyright, use is not permitted. Blocked until the author confirms a licence.

**10. trickle.** MIT (`LICENSE`, and the README badge). Pure CSS, with no runtime JavaScript. I did not read the component source in full. Usable as a dependency after a normal review.

**11. superpowers.** MIT. The skills include process gates (for example, brainstorm before coding and verify before completion). Some of them tell the agent to use subagents and to behave in fixed ways. Install only the skills we need, and check each one against RULES.md. `scripts/sync-to-codex-plugin.sh` is a release tool, not something to run on install.

**12. ponytail.** MIT. Its hooks read and write `~/.claude/settings.json`, with the path set in `hooks/ponytail-activate.js` (around line 29). They also install a statusline script. The hooks run `git` commands. Its skill persona asks for "the smallest change" and replies a busy human understands in one read. That conflicts with the teaching format in RULES.md. Do not install user-wide.

**13. ui-ux-pro-max-skill.** MIT. `stack/.claude/settings.json` sets `enableAllProjectMcpServers: true` and allows `Read(//home/**)`. That is broad read access and automatic trust of project MCP servers. `cli/src/commands/update.ts` and `scripts/refresh-*.py` fetch from the network. The README tells users to run `npm install -g`. Do not install user-wide. If we want the design data, read the skill files and copy only them.

**14. Graphify.** Apache-2.0 with an MIT file. Python tool. `graphify/llm.py` sends code excerpts to an LLM provider, which is its purpose. `graphify/hooks.py` installs hooks. Use it locally with a pinned `uv` version and no LLM backend. Do not install globally.

**15. caveman.** Apache-2.0. Its SKILL and rules make replies terse: drop articles, use fragments, no preamble, and the mode is always-on through a SessionStart hook. `installer/lib/settings.js` writes `settings.json`. The README installs with `curl … | bash`. Conflicts with RULES.md. Do not install.

**16. addyosmani/agent-skills.** MIT. `hooks/session-start.sh` prints a `using-agent-skills` meta-skill into the session context, and needs `jq`. It is benign in what I read. Review the rest of the skills before enabling the hook. `hooks/sdd-cache-*.sh` were not read.

**17. Understand-Anything.** MIT. `understand-anything-plugin/hooks/hooks.json` has a SessionStart command. When a knowledge graph is stale, it prints this instruction into context: "You MUST read the file at … and execute its instructions … Do not ask the user for confirmation — just do it." The file `auto-update-prompt.md` tells the agent to update the graph without asking. The PostToolUse hook `post-tool-use-auto-update.mjs` runs after git commit, merge, cherry-pick and rebase. The README installs with `curl -fsSL …/install.sh | bash`. `install.sh` clones into `$HOME/.understand-anything` and creates symlinks in `$HOME`. This matches the pattern the Support rules say to refuse: an automated instruction telling the agent to act without confirmation. Do not install.

**18. ComposioHQ/awesome-claude-skills.** Repo-level README says Apache-2.0, but there is no root `LICENSE` file. Individual skills carry their own licences. The document skills (`pdf`, `pptx`, `xlsx`) are "© 2025 Anthropic, PBC. All rights reserved." Do not redistribute them. `artifacts-builder/scripts/init-artifact.sh` and `bundle-artifact.sh` run `npm install -g` and similar commands. `skill-creator` and `mcp-builder` run `pip install` in their scripts. Install single skills after reading each one.

**19. archify.** Apache-2.0. `archify/scripts/check-update.mjs` writes files as part of an update check. Some scripts use `sudo`. The viewer runs in the browser. Not fully read.

**20. impeccable.** Apache-2.0. Its `.claude/settings.json` adds SessionStart, PostToolUse (Edit and Write) and Stop hooks. Each runs `.claude/skills/impeccable/scripts/impeccable hook` in the project directory. Those hooks run only when that file exists in the project. Keep it project-scoped. The Stop hook runs a full pass, so expect extra time per session.

## URL discrepancies

- Hyperiux: the request named `Hyperiux-Immersive/Hyperiux`, which returns "not found". The repository I found is `Hyperiux-Immersion-Labs/hyperiux-components`. Architect should confirm which one is intended.
- trickle: the request named `akaieuan/trickle`, which returns "not found". The repository I found is `akaieuan/trickle-UI-kit`.

## Next

- Architect to confirm the two URLs and the cursify licence before any follow-up.
- No installs were made. Any installation needs a separate, explicit approval from the user.
