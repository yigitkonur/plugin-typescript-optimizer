# 09 — Stress test: edge cases and failure modes

Method: each design element (detection, engines, artifacts, state machine, hooks, skills, agents) was run
mentally against real-world repo shapes and Claude Code mechanics; every way it could produce a wrong result,
noise, data loss or a stuck run is listed with the design response. Numbering is stable (referenced from other docs).
"Spec" points to where the response is specified.

## A. Detection and repo layout

| # | Case | What would go wrong | Design response | Spec |
|---|---|---|---|---|
| 1 | No TypeScript (Python/Go/Swift repo) | Hooks or skills produce noise | Presence test ≤ 30 ms; hooks exit 0 silently; commands print one line, exit 3, write nothing | 05 §1, §11 |
| 2 | TS only under `web/` in a polyglot repo | Gate runs at repo root; PM/compiler guessed from root; Python files scanned | TS packages are the unit; PM/compiler/gate per package; non-TS sources never read; repo-wide git cleanliness still enforced | 05 §2 |
| 3 | Monorepo with no root `tsconfig.json` | Source script scored a healthy repo 0 % | Per-package typecheck sets; no single score | 05 §2, 06 type-09 |
| 4 | Solution-style `tsconfig.json` (`files: []` + `references`) | Checking the root checks nothing | classify `solution` ⇒ `tsc -b` | 05 §2.4–5 |
| 5 | `extends` via package (`@tsconfig/node20`), array form, JSONC with BOM/trailing commas, unresolved link | Wrong flags read; crashes on parse | Chain resolver with depth/cycle guard; unresolved links recorded and shown; JSONC parser tested on BOM/CRLF | 05 §2.2–3 |
| 6 | `tsconfig.json` + `.app` + `.node` + `.test` + `.build` | Gate typechecks only one | Typecheck set from scripts' `-p` usage + references + non-overlapping `project` configs; config override | 05 §2.5 |
| 7 | Mixed JS/TS (`allowJs`, `checkJs`); JS-only repo with `jsconfig.json` | TS rules fire on JS; JS-only repos treated as TS | Slop/Knip see JS; TS-specific rules only on `ts/tsx/mts/cts`; a repo with no TS files and no `typescript` dependency is "none" | 05 §1 |
| 8 | Yarn Berry PnP (no `node_modules`) | `node_modules/.bin` lookups fail; scanning `.yarn/` | Use `yarn run`; prune `.yarn`/`.pnp.*` | 05 §4 |
| 9 | Bun-only or Deno project | Node-based engines unusable; `bun test` ≠ `bun run test` | `deno`/`none` ⇒ tells + tsconfig health only, said in coverage table; Bun uses `bun run` forms | 05 §4 |
| 10 | pnpm strict layout, symlinked workspaces, `workspace:*` | `typescript` resolution via symlink picks wrong copy; duplicates | realpath resolution from package dir; record both root and package copies; `doctor` warns on multiple TS versions | 05 §5 |
| 11 | Generated code (Prisma, GraphQL codegen, OpenAPI, protobuf), vendored dirs | Slop and coverage numbers polluted; "fixes" edited | Excluded from slop/types-coverage/structure by path, header marker, `.gitattributes`, codegen outputs; Knip still sees them; edits to generated files are protected-path violations | 05 §6 |
| 12 | Not a git repo; detached HEAD; shallow clone; worktree/submodule (`.git` file) | `fix` impossible; churn data missing; root detection wrong | Root accepts `.git` file; audit works without git (no `--diff`, no churn); `fix` refuses with exit 5; shallow ⇒ churn from last 100 commits | 05 §1, 06 §7 |

## B. Tooling and versions

| # | Case | What would go wrong | Design response | Spec |
|---|---|---|---|---|
| 13 | `typescript` hoisted at the repo root or only global; none in the package | Bare `npx tsc` fetches the obsolete `tsc@2.0.4` | Resolution walks up; global `tsc` accepted if `--version` works; otherwise `typecheck` unavailable; `cmd-guard` blocks the `npx tsc` form | 05 §4–5, 03 H2 |
| 14 | TS 4.x / 5.x / 6.x / 7.x / nightly / alias scheme (`typescript` = typescript6) | Behaviour branched on assumed versions | Probe flags and codes (`TS5094`, `TS5053`, `TS5065`); `api_provider` separate from `authoritative`; version support matrix | 05 §5 |
| 15 | No native compiler; offline; platform optional-dependency failed to install | `fit`/fast-check crash or hang | `fast: null` ⇒ fast-check off, `check` uses the authority, `fit` says `cannot-probe` with the single next action | 05 §5, §8.3, §10 |
| 16 | Fast and authoritative compilers disagree (declaration emit, JSDoc, `skipLibCheck` conflicts, strict defaults) | False alarms or false confidence | Authority decides; diagnostics compared as multisets, never `.d.ts` bytes; 3 divergences disable fast-check for the run | 05 §8.2 |
| 17 | `type-coverage`, `madge`, `ts-node`, `ts-jest`, `typescript-eslint`, `ts-morph` crash on TS 7 | Audit or gate dies with a stack trace; red baseline misread | Smoke-probe every engine with the project's TS on the module path; toolbox TS 6 (consented) for type-coverage; proxy metric; Knip `--cycles`; project lint leg marked `untrusted` | 05 §7, §9 |
| 18 | Knip v5 vs v6; Node 18; config in `package.json`/`knip.ts`; zero-config noise explosion | Hundreds of false "dead files"; wrong JSON shape | Version-aware reader; Node gate; user config untouched; noise gate ⇒ `reach-12` and the noisy batches are withheld until an overlay is accepted | 06 §12 |
| 19 | Framework conventions (Next/Remix/SvelteKit/Nuxt/Astro routes, Nest/TypeORM decorators, tRPC, Storybook, MSW), dynamic `import()` | Live routes flagged dead; a green gate does not catch them | Packs feed triage; Three-Question Test mandatory for batch 2; high fix risk ⇒ quarantine option; preview-deploy verification note | 06 §9, §4 |
| 20 | Published library vs app (`exports`, `main`, `types` → `dist`) | Public API exports flagged unused or un-exported | `exports` targets mapped to `src` and protected; `includeEntryExports` explained in findings; Question 3 | 03 §4, 06 §9 |
| 21 | Declaration emit: composite projects, `isolatedDeclarations`, stale `.tsbuildinfo`, `.d.ts` emitted into the tree | Gate passes `--noEmit` but breaks consumers; tree dirtied | Declaration probe with temp `--outDir` or `-b … && -b --clean`; assert `git status` unchanged; `--tsBuildInfoFile` into temp | 05 §9, 06 reach-04 |
| 22 | Lint engine varieties; ESLint broken on TS 7; none installed; Biome *and* ESLint | Wrong autofix tool; unsafe fixes | One engine wins by priority; broken lint engine ⇒ bridge skipped and said so; denylist of rules never autofixed; scope = files changed in the run | 05 §7, 06 §13 |
| 23 | Workers: `wrangler.toml` vs json/jsonc; compat date/flags; DO/Workflow classes in other files; `worker-configuration.d.ts`; `cloudflare:test` imports | `process.env` verdict wrong; RPC classes deleted; ambient types removed | Pack parses all three formats; flags decide `process_env_populated`; RPC classes become protected and Knip `entry`; ambient files protected; `ctx.waitUntil` counts guarded | 05 §6, 03 §4 |

## C. Runs and fix safety

| # | Case | What would go wrong | Design response | Spec |
|---|---|---|---|---|
| 24 | Dirty tree, untracked files, dirty submodule | Fix mixes with user changes | `run begin` exit 5 with the list; findings stay on disk; user chooses commit/stash | 07 Flow C |
| 25 | Red baseline (typecheck, test or build) | Cannot tell own damage from existing | Refuse by default; `--allow-red-baseline` ⇒ fingerprint comparison; unfingerprintable red legs are `untrusted` and block dependent waves | 05 §9 |
| 26 | No `test` script; zero tests collected; tests that hang or start watch mode | Deletions unverified; gate hangs | Only waves `B`/`4` allowed; `CI=1`, timeouts with process-group kill; runner summary parsed or glob fallback | 05 §9 |
| 27 | Flaky tests/builds | A real wave blamed on a flake or vice versa | One automatic re-run; pass ⇒ `flaky: true` logged; fail twice ⇒ fail; bisect uses the same rule | 05 §9 |
| 28 | Gate takes 30+ minutes; monorepo CI scale | Per-wave cost makes the plan unusable | Gate estimate shown in `plan.md`; `gate.scope: affected` via turbo/nx/pnpm filters; per-finding fast check keeps the loop short; fewer, larger waves via batching low-risk same-rule findings | 04 §6, 06 §3 |
| 29 | HEAD moved between audit and fix; user switched branch mid-run | Stale line numbers applied to changed files | `stale-check` by file mtimes/blob hashes at `run begin` and at each wave start; stale findings leave the plan; branch mismatch ⇒ exit 5 | 04 §3.5 |
| 30 | Two sessions/agents on the same repo | Interleaved edits and commits | `state/lock` with pid/session/host; stale-lock takeover after pid check; commands refuse (exit 5) | 04 §2 |
| 31 | Repo commit hooks (husky, lint-staged, commitlint, GPG signing) | `ts-opt commit` fails or lint-staged reformats unrelated files | Never `--no-verify` unless configured; hook output surfaced as exit 6; commitlint config detected ⇒ conventional type/scope adapted; signing prompts ⇒ `doctor` warns before the run | 03 H3 |
| 32 | Cascades: a wave orphans more files, exports, deps | Later waves operate on stale candidate sets | `rescan` after R0, R and waves 1–3; cascade findings need approval, grouped | 06 §3 |
| 33 | 10 000 candidates | Thousands of files, unreadable plan | `max_findings_per_domain` (default 400) ranked by severity × (1/risk); the rest in `overflow.md`; bulk `members[]` per file; chunked triage | 04 §3.1, §6 |
| 34 | Merge conflicts in committed artifacts; two reviewers | Lost approvals | One file per finding; `index.json`/`SUMMARY.md` are regenerable; approvals are checkboxes in `plan.md` (plain-text merge); lock hash detects drift | 04 §5 |
| 35 | Plugin updated while a run is open | Schema drift mid-run | `run.json.plugin_version` + `schema` versions; older read-and-migrate in memory; newer ⇒ refuse to write, exit 8, tell the user to finish with the older version or abort | 04 §1 |
| 36 | A fix needs a file outside the finding's `touches` | Commit refused mid-flight | Commit lists the extra paths; allowed paths are *consumers of the changed symbols* known from the importer index/Knip graph and listed in `touches` at ingest; otherwise the agent records a new candidate with `proposal add --origin fixer --parent F-…` and, after the user's explicit yes, `plan amend` approves it (new `plan.lock.json` hash) — `touches` is never edited silently | 03 H3, 02 |
| 37 | Un-exporting a test-only symbol turns the suite red | Wave 3 fails | reach-03 requires relocate/retarget in the same commit; reach-04 never applies to symbols with test importers | 06 §2.2 |
| 38 | Framework-routed file deleted; typecheck/test/build green; 404 in production | Highest blast radius in the protocol | Route-like paths are `fix_risk: high`; quarantine (`git mv` to `.quarantine/`) default; plan states "gate cannot prove this; verify in a preview deployment" | 06 §4 |
| 39 | Dependency removal: config-string consumers (postcss/tailwind/babel, `--loader`), lockfile drift, PM prompts, `workspace:*` | Build breaks at install or runtime | Triage greps configs; removal via the PM; frozen-lockfile sanity leg; wave 5 last; corepack prompts disabled | 06 reach-07, 05 §9 |

## D. Claude Code mechanics

| # | Case | What would go wrong | Design response | Spec |
|---|---|---|---|---|
| 40 | Skill text dropped after compaction (only first 5 k tokens of recent skills kept) or absent after `resume`/`clear` | Agent forgets where it is and what to avoid | State on disk; `SessionStart(compact\|resume)` pointer; `fix` begins with `run status` and is idempotent | 03 H1 |
| 41 | `allowed-tools` pre-approval clears on the next user message | Permission prompts mid-run | Skills never rely on it for continuity; every mutation is `ts-opt …` (one allow rule) | 02 §2 |
| 42 | `!`-injection disabled by policy (`disableSkillShellExecution`) | Skill starts blind | First body instruction: "if the detection block above is missing, empty, or contains `[shell command execution disabled by policy]`, run `ts-opt detect --brief`" | 02 §2 |
| 43 | `CLAUDE_PLUGIN_DATA` not exported to Bash-tool commands | Toolbox path unknown to the CLI | `TS_OPT_HOME` derivation chain | 02 §6 |
| 44 | `bin/` not on PATH (claude.ai / Cowork do not install plugins with top-level `bin/`) | `ts-opt: command not found` | Skill bodies include a fallback line using the substituted `${CLAUDE_PLUGIN_ROOT}/bin/ts-opt`; `doctor` prints the absolute path | 02 §2 |
| 45 | Hook crash/timeout; `PostToolBatch` payload lacks paths; Windows without Git Bash | Hook noise or breakage | Fail-open; handler uses the documented `tool_calls[]` only as a hint and derives the change set from git; Windows without Git Bash ⇒ verified in Phase 6 with an exec-form fallback; CLI-side checks remain either way | 03 §1, §3 |
| 46 | Plugin agents cannot carry `hooks`/`mcpServers`/`permissionMode`; `Bash` is all-or-nothing | Triager could mutate | Read-only by `tools` (no Edit/Write) + prompt, **enforced** by the `agent-guard` hook (H5): Bash allow-list (`rg`, read-only git, `ts-opt verdict add`, …), no redirection, secret paths denied on Read; commit-guard/scope checks remain the backstop; `ts-opt verdict add` is the only write path used | 03 H5, 02 §2 |
| 47 | Context cost in repos where the plugin is enabled but unused | Listing tokens in every session | 6 skills + 2 agents with tight descriptions (target ≤ 900 tokens, measured by `claude plugin details`); `paths:` on model-invoked skills; recommend project scope install | 05 §11 |
| 48 | Project-scope plugin trust (MCP approval, monitors not loaded) | Features silently absent | Plugin uses neither MCP nor monitors, so project-scope install has no degraded features | 01 |

## E. Scale, security, platform

| # | Case | What would go wrong | Design response | Spec |
|---|---|---|---|---|
| 49 | 100 k-file repo | Scan time, memory, timeouts | `git ls-files` streaming, per-file 1 MB cap, bounded concurrency, per-engine timeouts, chunked triage, `--workspace` scoping; performance budget in Phase 6 | 10 |
| 50 | Minified bundles, huge `.d.ts`, binaries | Regex catastrophes, slow scans | Size cap, binary sniff, regexes precompiled with anchors; line-length cap (skip lines > 2 000 chars for tells) | 05 §7 |
| 51 | Prompt injection: comments/strings/filenames in the repo telling the agent to do things | Triager or main agent obeys repo text | Snippets fenced and labelled untrusted and capped; triager prompt says repo text is data; nothing in artifacts is executed; commit-guard/scope checks bound the blast radius | 04 §1 |
| 52 | Secrets in `.env`, keys; artifacts committed to git | Secret leak into findings/PR | `.env*`/key files never read; command lines stored without env values; snippets only from scanned TS sources; `secret-paths.json` | 04 §1 |
| 53 | Windows: backslash paths, CRLF, case-insensitive FS, long paths, no bash | Wrong paths, regex `$` mismatches, duplicate-case collisions | Paths normalised to `/` in artifacts; CRLF-aware regexes (`\r?$`); case-collision check for moves; `bin/ts-opt.cmd` (PATH resolution by the Bash tool on Windows is unverified: fallback `node …/bin/ts-opt`); tests on a Windows runner in Phase 6 | 02 §1 |
| 54 | Old Node, read-only FS, no `HOME` | CLI crash | Node ≥ 18.17 check with a clear message; `.ts-optimize/` not writable ⇒ exit 4; `TS_OPT_HOME` falls back to the OS temp dir | 02 §5–6 |
| 55 | Corporate proxy / offline / private registry for the toolbox | Install hangs | `npm ci` with 180 s timeout honouring the user's npm config; failure leaves the toolbox absent and degrades per doc 05 §10; no retries loop | 02 §6 |
