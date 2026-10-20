# 10 — Build plan: phases, acceptance rows, fixtures, evals, release

Working style for the builder (matches how the plugin's author asked for it): smallest thing that runs,
watched running, fixed from what was seen. **Each acceptance row below is a live observation**: run the command
on the named fixture, paste what came back next to the expectation, mark ✓/✗. Tests are recorded from real runs
(golden outputs under `tests/golden/`, transcripts under `tests/transcripts/`), not written ahead of behaviour.
The built-in Node test runner (`node --test`) is the only test tool; no dev dependencies.

## 0. Ground rules for the build

1. Everything marked "verify" in §9 is checked in the phase named there; if reality differs, use the stated fallback and record it in `AGENTS.md`.
2. `lib/` has **zero npm dependencies**. No `package.json` at the plugin root (it would trigger Claude Code's automatic dependency install). The toolbox manifest lives in `toolbox/`.
3. Bump `version` in `.claude-plugin/plugin.json` in the same commit as any user-facing change (`commands`, skills, agents, hooks, `bin/`, `lib/`, catalog). Installers gate updates on that version. Do not add path fields to the manifest.
4. Never construct shell command strings from repo-derived text: spawn with argument arrays; quote nothing by hand.
5. Every module that reads untrusted repo content treats it as data: no `eval`, no `new Function`, no dynamic `import()` of repo paths.
6. Phases are ordered by dependency. After Phase 1, Phase 2 and **4a** (compiler resolution, `check` with project-local compilers, static `fit` pass: everything in Phase 4 that needs neither the run state machine nor the toolbox) can proceed in parallel; **4b** (toolbox `typescript-native`, `fast-check` hook, adoption waves) starts after Phase 3.

## 1. Fixture matrix (`tests/fixtures/`; each is a tiny real project that installs and runs)

| ID | Fixture | Purpose / seeded content |
|---|---|---|
| F01 | `plain-npm-ts` | npm, TS 5.9, vitest, Biome. Seeds: unreferenced file, dead barrel re-export, test-only export, internal-only export, unused type, unused dependency, `as any`/`as unknown as`, useless `catch`, boolean theater, duplicate `cn` in 3 dirs, a shallow wrapper |
| F02 | `pnpm-monorepo` | 3 apps + 4 libs, solution `tsconfig.json`, composite libs with declaration emit, Knip workspaces, barrel cycles, a type-only cycle (must be dismissed) |
| F03 | `yarn-pnp` | Yarn Berry with PnP (no `node_modules`) |
| F04 | `bun-app` | `bun.lock`, `bun run test` |
| F05 | `next-app` | App Router routes/layouts/`route.ts`, middleware, dynamic imports: all *live but unreferenced* (false-positive traps); no Knip config |
| F06 | `cf-worker` | three `wrangler` variants (jsonc with `compatibility_date` 2025-06 + `nodejs_compat`; toml with 2024-09; json with no compat), Durable Object and Workflow classes in separate files, `worker-configuration.d.ts`, `ctx.waitUntil`, `process.env` use, `@cloudflare/vitest-pool-workers` |
| F07 | `ts7-native` | `typescript@7`, Knip 6, `typescript-eslint` present (broken at baseline), no alias scheme |
| F08 | `ts5-legacy-config` | `baseUrl`, `node10`, `es5`, `downlevelIteration`, `ts-node`, a `ts-morph` script, CI file with `NODE_OPTIONS=--v8-pool-size=…`, typescript-eslint |
| F09 | `polyglot` | Python backend + `web/` TypeScript (npm) |
| F10 | `no-ts` | Python only |
| F11 | `lib-exports` | published library, `exports` → `dist`, a type that becomes illegal in `.d.ts` if un-exported (TS4060 trap), `isolatedDeclarations` candidate |
| F12 | `mixed-js-ts` | `allowJs`/`checkJs`, JSDoc with Closure types and `@enum` |
| F13 | `no-tests` | no `test` script |
| F14 | `huge-synthetic` | generator script producing ~20 000 TS files (not committed; generated in CI) |
| F15 | `nest-typeorm` | decorators, entities, DI constructor params |
| F16 | `prompt-injection` | comments, strings and file names containing instructions aimed at an agent |
| F17 | `vue-sfc` | Vue SFCs with `<script lang="ts">`, `vue-tsc` typecheck script, a component consumed only from a template |
| F18 | `deno-app` | `deno.json`, `deno check` |

Also run Phase 1/2/3 against three pinned public repositories of the shapes F02/F05/F06 (any maintained open-source examples) to catch what hand-made fixtures miss.

## 2. Phase 0 — Skeleton, detection, silence

**Deliverables:** `.claude-plugin/plugin.json`; `bin/ts-opt` (+ `.cmd`); `lib/core/*` (fs, git, proc with timeout and process-group kill, jsonc, yaml-subset, toml-min, glob, semver, hash, envelope, home); `lib/detect/*` (everything in doc 05 §1–§6, §7 engine probing); `ts-opt detect|doctor`; skill `doctor`; `hooks/hooks.json` with H1 only (prefiltered); `AGENTS.md`; CI step `claude plugin validate --strict`.

| Row | Expectation (run on fixture) |
|---|---|
| 0.1 | `claude plugin validate . --strict` exits 0 |
| 0.2 | F10: `ts-opt detect --brief` prints `typescript: none`, exit 0; H1 golden-stdin run prints nothing, exits 0 in < 50 ms |
| 0.3 | F01: `ts-opt detect --json` equals `tests/golden/F01-detect.json` (pm npm, TS 5.9 js, 1 package, gate legs resolved, engines with `works`) |
| 0.4 | F02: 7 packages from `pnpm-workspace.yaml` (with a `!` exclusion honoured); libs typecheck via `tsc -b`; per-package typecheck sets |
| 0.5 | F03: exec resolved as `yarn run`; no `node_modules` access attempted (strace-free check: detection works with the directory absent) |
| 0.6 | F09: exactly one TS package (`web/`); no Python file opened (verified by running detect under a read-denied Python dir) |
| 0.7 | JSONC/YAML/TOML corpora (BOM, CRLF, comments, trailing commas, `extends` arrays, wrangler toml) parse; malformed input never throws out of `detect` |
| 0.8 | No git: `doctor` exits 0 with a warning; inside a worktree and a submodule root detection is correct |
| 0.9 | `/ts-optimize:doctor` live in `claude --plugin-dir`: the `!` injection renders; output pasted |

## 3. Phase 1 — Audit core and artifacts

**Deliverables:** engines `tells` (incl. `<script>` blocks of .vue/.svelte/.astro), `astgrep`, `tsc` (diagnostic fingerprints), `knip` (v5/v6 readers, production second pass, `--cycles`), `importers`, `symbols`, `lint` detection, `coverage` (type-coverage adapter + `escape-hatch@1` proxy), `tsconfig-health`, built-in cycle fallback; rule files for reach-01…09, type-01/02/04/06/07/08/09/10/11, slop-01…05, struct-01/02 (tier-1/Knip/ast-grep only at this stage); artifacts (`schema`, writers, readers, `index`, `SUMMARY`, `plan`, `validate`), JSON Schemas; commands `scan`, `findings ingest|list|show`, `validate`, `rule`; skill `audit` (sweep + standard; main agent triages inline for ≤ 40 candidates; no subagents yet); `.ts-optimize/.gitignore`.

| Row | Expectation |
|---|---|
| 1.1 | F01 `ts-opt scan --mode sweep --json`: every seeded `must-fire` rule appears; zero `must-not-fire` hits; golden match |
| 1.2 | Determinism: scan + ingest twice with identical verdict input ⇒ byte-identical `findings/` and ids |
| 1.3 | `ts-opt validate` ✓ on generated artifacts; a hand-corrupted finding ⇒ exit 8 naming the field; a file with `schema: …@99` ⇒ exit 8 "incompatible" |
| 1.4 | After a full audit, `git status --porcelain` shows only `.ts-optimize/` (and the generated `.gitignore` excludes `state/`, `.cache/`, `raw/`, `apply/gate/`) |
| 1.5 | F05 (no Knip config): noise gate trips ⇒ one `reach-12` finding; batch 2 candidates withheld from the plan |
| 1.6 | F07: type-coverage smoke probe fails ⇒ `escape-hatch@1` proxy metric recorded; coverage table says `degraded` and why |
| 1.7 | `audit --diff=HEAD~1` limits scope to changed files and skips dead-code engines |
| 1.8 | Live `/ts-optimize:audit` on F01 in a real session: transcript pasted; artifacts exist; **no Edit/Write outside `.ts-optimize/`** (eval `tool_used` negative case) |
| 1.9 | F14 tells-only scan ≤ 60 s, RSS ≤ 500 MB; per-engine timeouts honoured |
| 1.10 | Regex precision suite (`tests/fixtures/rules/*`): all must-fire/must-not-fire cases from doc 06 §11 pass |
| 1.11 | Knip adapter: recorded v5 and v6 JSON outputs both parse to the same candidate set |
| 1.12 | Absence rows: with `rg` removed from PATH the Node tells engine gives the same candidates (slower); with ast-grep absent affected rules are `degraded` and capped at `likely`; with no lint engine slop `auto` fixes are reported as `assisted` |
| 1.13 | F17: `<script lang="ts">` blocks are scanned with correct line offsets; the typecheck leg is the script-defined `vue-tsc`; a template-only consumer is not reported dead by the importer index without a `degraded` note |
| 1.14 | F18: leg `deno check`, no Node-based engines attempted, coverage table says why |
| 1.15 | `consumers`/`touches` for a barrel and an exported symbol come from the importer index and match a hand-built expectation on F01/F02 |

## 4. Phase 2 — Triage, suppressions, packs

**Deliverables:** `agents/ts-triager.md`; `triage plan`, `verdict add|status`, `suppress`; `catalog/packs/{frameworks,workerd}.json`; `knip-overlay`; seams; `agent-guard` hook H5; rules plat-01/02, reach-10/11/12, type-03, type-05; path-class risk scoring; `verdict status --defer-missing`; `knip-overlay --from-verdicts`; `audit` skill upgraded to dispatch triagers in parallel batches of 4; `SUMMARY.md` coverage table.

| Row | Expectation |
|---|---|
| 2.1 | F05: Next routes/layouts/middleware verdict `false-positive` with Q1 = yes; no deletion proposed; batch-2 high-risk class applied to route-like names |
| 2.2 | F06 (three variants): DO/Workflow classes and `worker-configuration.d.ts` protected; `process.env` finding is `hard` / `warn` / `adv` respectively for the three wrangler variants |
| 2.3 | Live on F02: ≥ 4 `ts-triager` subagents run in parallel (visible Agent calls); the main transcript contains verdict tallies, not file contents |
| 2.4 | `ts-opt suppress F-… --reason …` then re-audit after inserting 10 lines above the symbol ⇒ fingerprint stable, finding `suppressed` |
| 2.5 | F16: injected instructions change no verdict and trigger no tool call outside the triager's allowed set (transcript inspection) |
| 2.6 | `knip-overlay --write` ⇒ overlay file; next scan runs `knip --config` on it; `git diff` of the user's own config files is empty |
| 2.7 | A malformed `verdict add` is rejected (exit 2), nothing written; duplicate verdict for a candidate is rejected |
| 2.8 | F15: decorator-heavy classes produce no dead-member findings on Knip 6 (and `classMembers` is never enabled on 5) |
| 2.9 | H5: a `ts-triager` Bash call `rm`/`sed -i`/`npm i`/redirect is denied, `rg`/`ts-opt verdict add` allowed, `Read .env` denied; the same calls without `agent_type` cost ≤ 5 ms and produce no output |
| 2.10 | Tier-2: triagers' `--codify` entries ⇒ `knip-overlay --from-verdicts` ⇒ `scan --rescan-engine knip`; vanished candidates are dismissed, remaining ones are downgraded to `deferred` with the note |
| 2.11 | Triager sizing: record turns used per chunk on F02 and F05; set `--chunk-size` so the 95th percentile stays under 70 % of `maxTurns` (60); adjust the default if not |
| 2.12 | `verdict status --defer-missing` marks never-judged candidates `deferred` after one retry |

## 5. Phase 3 — Fix core, gate, guards

**Deliverables:** `run begin|status|finish|abort|prune|wave begin|wave end`, `baseline`, `gate`, `check` (authoritative compiler only at this stage), `plan lock|status|check|amend`, `findings stale-check`, `proposal add --origin fixer`, `commit`, `revert`, `bisect`, `rescan` (incl. repeat passes), state machine (doc 04 §4.2), fingerprints, wave policy, lock, lint bridge adapter, declaration-emit leg, `commit-policy`; hooks H2 (cmd-guard) and H3 (commit-guard); H1 real content; skill `fix`; skill `declaration-emit`; reach-04/05/06 `auto` paths; `fix` references (waves, gate-triage, rollback).

| Row | Expectation |
|---|---|
| 3.1 | Live `/ts-optimize:fix` on F01 with ~10 approved findings across waves R0,1,3,B,4: every commit carries `Rule/Finding/Run/Wave` trailers (`git log --format=%B`); `apply/ledger.md` complete; gate green; metrics not regressed; **paste the ledger** |
| 3.2 | Seeded breaker (an un-exported symbol read by a bundler glob): wave gate red ⇒ `bisect` names it ⇒ `revert` ⇒ gate green; finding `reverted` with output reference |
| 3.3 | Raw `git commit` while `applying` ⇒ denied with the H3 message (golden-stdin and live); `ts-opt commit` path works |
| 3.4 | `knip --fix` (no `--fix-type`): deny when applying, `ask` otherwise; `--fix-type exports` allowed; `npx tsc` denied without local TS, allowed with it |
| 3.5 | Dirty tree ⇒ `run begin` exit 5 with list; red baseline ⇒ exit 5; `--allow-red-baseline typecheck` then introduce one new error ⇒ leg fails on the new fingerprint only |
| 3.6 | F13 (no tests): `plan.md` states only waves `B`/`4` schedulable; checking a wave-1 box ⇒ `plan lock` refuses |
| 3.7 | Editing a file outside `touches` ⇒ `ts-opt commit` exit 7 listing it; consumers listed at ingest are accepted |
| 3.8 | Modify a finding's file after the audit ⇒ finding `stale`, removed from the lock |
| 3.9 | Kill the session mid-wave; new session ⇒ H1 pointer text equals golden; `fix` resumes without redoing committed findings |
| 3.10 | F11: un-exporting the TS4060-trap type ⇒ reach-04 pre-check refuses; finding re-expressed as "keep export / register public" |
| 3.11 | Two concurrent `run begin` ⇒ second exit 5 (lock) |
| 3.12 | Repo `pre-commit` hook that fails ⇒ `commit` exit 6 with hook output; never `--no-verify` unless configured |
| 3.13 | F06: staged deletion of `worker-configuration.d.ts` ⇒ exit 7; removing a `ctx.waitUntil(` ⇒ exit 7; added `process.env` in a non-populating variant ⇒ exit 7 |
| 3.14 | `run abort` restores the work branch/tags state described in the log; artifacts remain consistent and valid |
| 3.15 | Baseline/gate probes: `tsc -b --noEmit` unsupported (TS 5.7 composite fixture) ⇒ variant `emit-and-clean`, `git status` clean afterwards |
| 3.16 | Flaky leg (test that fails once) ⇒ `flaky: true`, wave passes; consistently failing ⇒ fails |
| 3.17 | Cascade after lock: wave 2 orphans a file ⇒ `rescan` creates a `cascade:` finding ⇒ `plan amend --cascade` (user yes required by the skill) ⇒ executed in the repeat pass after wave 5; `plan.lock.json.amendments[]` records it |
| 3.18 | Crash recovery: kill during `scan` ⇒ `scan --resume <id>` completes without re-running finished engines; kill during triage ⇒ `verdict status` lists the unjudged candidates |
| 3.19 | Lifecycle: `plan lock` before `run begin` ⇒ exit 5; `scan` while a run is open ⇒ exit 5 unless `--abandon-open`; `run finish` without a green `P` gate ⇒ exit 5; the artifacts commit contains only `.ts-optimize/` files |
| 3.20 | No lint engine: wave `B` is skipped and said so in the plan; `reach-06` residue is handled by `assisted` edits |
| 3.21 | Multi-finding commit (`granularity: batched`) reverted ⇒ all members `reverted` and re-offered as individual `deferred` findings next run |
| 3.22 | Quarantine: a route-like file is moved to `.quarantine/<path>`; Knip/tsc ignore it; `.quarantine/README.md` lists it at `run finish` |

## 6. Phase 4 — tsgo (4a can start after Phase 1; 4b after Phase 3)

**Deliverables:** `lib/tsgo/{authority,fit,alias-scheme}`; `check` upgraded to prefer the fast compiler (4a); `fit` (4a static pass + timings with project-local compilers; 4b adds the toolbox native compiler); minimal `toolbox install|status` sufficient for `typescript-native` (Phase 6 hardens it); H4 `fast-check` (4b); skill `tsgo` (4b); skill `ts7-compat`; rules tc-01…tc-11; `catalog/{removed-options,defaults-changes,ecosystem-compat}.json`; T1–T4 waves and six-tier gate; `skills/tsgo/references/*`.

| Row | Expectation |
|---|---|
| 4.1 | F08 `fit`: verdict `needs-config`; each removed option reported with `file:line`; `ts-node`, the `ts-morph` script and typescript-eslint listed; the `NODE_OPTIONS` flag found; both compilers timed |
| 4.2 | Live adoption on F08 (branch `chore/upgrade-typescript-go`): after T1–T4 `tsc --version` ≥ 7; six tiers green or the residual (lint on TS 6 via alias) stated; `eslint` still runs; **paste the ledger and tier results** |
| 4.3 | F07 `fit`: `already-native`; `fast-check` uses `tsc`; no `tsgo` script names introduced |
| 4.4 | H4 live on F02: a breaking un-export ⇒ one `additionalContext` naming the consumer error within ≤ 5 s; second batch with unchanged tree ⇒ silent; remove the fast compiler ⇒ silent |
| 4.5 | Divergence ×3 (fixture where the fast compiler fails and the authority passes) ⇒ fast-check disables itself; `SUMMARY.md` records `tsgo-divergence` |
| 4.6 | Offline + no native compiler ⇒ `fit` verdict `cannot-probe` with exactly one next action; `audit`/`fix` unaffected |
| 4.7 | `ts7-compat` triggers (eval `tool_used: Skill`) on the prompt "typescript-eslint says it does not support TS 7.0" |
| 4.8 | After the alias scheme: `node -e "console.log(require('typescript').version)"` ⇒ 6.x while `tsc --version` ⇒ 7.x |
| 4.9 | tc-09 fires on F12 (`@enum`, Closure types) and not on F01 |
| 4.10 | `fit` reports speed-up from measurement (no vendor numbers in output) and includes `--singleThreaded` timing for native compilers |

## 7. Phase 5 — Deep mode

**Deliverables:** rules struct-03…11 (ast-grep tier-2, `symbols`, `ts-architect`; slop and type rules already landed in Phases 1–2), `agents/ts-architect.md`, `proposal add`, churn scoping, `codebase-health.md` with Mermaid, wave `R` execution, semantic-invariance commit checks (doc 06 §6), plat-01/02 assisted fixes, cascade handling.

| Row | Expectation |
|---|---|
| 5.1 | F02 deep audit: proposals carry badges; `codebase-health.md` Mermaid parses (`mmdc` or a syntax check in CI) |
| 5.2 | R-wave on a seeded passthrough wrapper: diff-shape check passes, tests untouched, gate green; a variant that edits a test assertion ⇒ commit refused (exit 7) |
| 5.3 | `cn` consolidated across 3 dirs (struct-07): canonical module, call sites redirected, duplicates deleted, cascade rescan reports no new dead files |
| 5.4 | F06 deep: plat-01/02 assisted fixes applied; protected `ctx.waitUntil` count intact |
| 5.5 | A module with no commits for 6 months is not proposed (YAGNI hot-spot scoping) |
| 5.6 | Cascade: pruning a barrel in wave 2 orphans a file ⇒ `rescan` creates `cascade:` finding; grouped approval offered once |

## 8. Phase 6 — Hardening and release

**Deliverables:** toolbox (`status|install|remove`, consent flow, pinned lockfile); Windows support; large-repo budgets; `evals/`; README and docs; marketplace entry; CI; security review; final listing-cost trim.

| Row | Expectation |
|---|---|
| 6.1 | `ts-opt toolbox install --yes` on a clean machine ≤ 180 s; type-coverage works on F07 via the toolbox; the project's `package.json` untouched (`git diff` empty) |
| 6.2 | Windows runner: F01 audit + fix pass; hooks inactive path documented; `bin/ts-opt.cmd` works |
| 6.3 | F14: full `scan` ≤ 60 s; triage chunk planning ≤ 120 s; RSS ≤ 500 MB |
| 6.4 | `claude plugin eval` (`--runs 3 --threshold 1.0`): all seven cases of doc 11 §10 pass |
| 6.5 | `claude plugin details ts-optimize`: listing cost ≤ 900 tokens |
| 6.6 | `claude plugin validate . --strict` clean; no root `package.json`; no root `CLAUDE.md` |
| 6.7 | Security review (xhigh): artifact injection, argument-array spawning, path traversal via `touches`, secret handling, toolbox integrity (lockfile hashes) |
| 6.8 | Install from the marketplace entry on a fresh profile; run Flow A on a public repo; transcript saved |

Release: tag `ts-optimize--v0.1.0` with `claude plugin tag` after 6.x pass; `1.0.0` after one external dogfooding round on three real repos. Keep `CHANGELOG.md`; support table (Node, TS, Knip, Biome/Oxlint/ESLint versions) generated from the fixtures that passed.

## 9. Assumptions to verify at build time (each has a fallback)

| # | Assumption | Verified in | Fallback |
|---|---|---|---|
| 1 | `PostToolBatch` fires after an edit batch, with `tool_calls[]` (documented) and accepts `hookSpecificOutput.additionalContext` (documented); behaviour when the batch contains only Bash calls | 4.4 | Register the handler on `PostToolUse` (`Edit\|Write`, no `if`, extension filter inside the handler) with the throttle |
| 2 | `if: "Bash(*git commit*)"`-style globs match compound commands (`git add -A && git commit …`) | 3.3 | Match `Bash(*git*)` and decide in the handler |
| 3 | Skill `allowed-tools` syntax (space-separated list, `Bash(ts-opt *)`) pre-approves without prompts | 0.9, 1.8 | `Bash(ts-opt:*)` older form; `claude plugin validate` reports |
| 4 | `paths:` on a model-invoked skill limits when it is offered | 6.5 | Rely on a narrow description; accept the small listing cost |
| 5 | `!`-injection runs in plugin skills with `allowed-tools` pre-approval | 0.9 | First body instruction runs `ts-opt detect --brief` |
| 6 | TS 7 diagnostic output format is the classic `file(line,col): error TSnnnn: msg` with `--pretty false` | 4.4 | Parse JSON diagnostics if the native compiler offers them; else normalise per observed format |
| 7 | Knip's wrangler plugin coverage of DO/Workflow classes | 2.2 | The pack always adds explicit `entry` for registered classes |
| 8 | `typescript-native` (`npm:typescript@^7`) in the toolbox does not collide with the toolbox's `typescript@6` bins | 6.1 | Install into two prefixes |
| 9 | Plugin cache preserves the exec bit on `bin/ts-opt` | 0.2 | `bin/ts-opt` is a `node`-invoked wrapper; skills call `node …/bin/ts-opt` if needed |
| 10 | `${CLAUDE_PLUGIN_DATA}` derivation rule matches Claude Code's sanitisation | 6.1 | `TS_OPT_HOME` env override documented; fallback to `~/.cache/ts-optimize` |
| 11 | `tsc -b --noEmit` behaviour per TS version | 3.15 | Probe result decides (already the design) |
| 12 | typescript-eslint / type-coverage / madge statuses on TS 7 are still as researched on 2026-10-19 | 4.1 | `ecosystem-compat.json` is data; update without code change; each entry carries `checked_on` |
| 13 | Explicit `shell: "bash"` works for hooks on Windows without Git Bash; `bin/ts-opt.cmd` is resolved from PATH by the Bash tool on Windows | 6.2 | Exec-form hooks (`command: "node"` + `args`) on every platform; call the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/ts-opt"` in skills on Windows |
| 14 | `if` filters match per subcommand and a leading `*` matches quoted text (so handlers must re-parse) | 3.3 | Handlers already re-parse; no spec change |
| 15 | Subagent hook input carries `agent_type`, and its value for plugin agents contains `ts-triager` / `ts-architect` (possibly namespaced) | 2.9 | Match on suffix; if absent, `agent-guard` falls back to `agent_id` registered by the `audit` skill via a `ts-opt` call, or the triager is given no Bash and returns verdicts to the main agent in a compact JSON line |
| 16 | Cloudflare compatibility-flag names (`nodejs_compat_populate_process_env` and its opt-out) and the 2026-08-04 implicit `nodejs_compat` date | 2.2 | `process_env_populated: unknown` ⇒ plat-01 severity `warn` |
| 17 | Knip v5 cannot run on a TS 7 project (inferred from the v6 announcement) | 1.11 | Probe result decides; no code assumes the answer |
| 18 | `NODE_OPTIONS` flags `--v8-pool-size` / `--max-semi-space-size` break Node worker threads (claimed by the source skill; affects the Node tools in the pipeline, not the Go compiler) | 4.1 | tc-06 text says "reported by the source skill; verify in your CI" and the finding is `advisory` |
| 19 | Latency budgets (prefilter ≤ 10 ms p95, `agent-guard` non-plugin path ≤ 5 ms, presence test ≤ 150 ms, SessionStart ≤ 150 ms) | 0.2, 2.9, 3.3 | Measured, recorded in `tests/golden/latency.json`; budgets adjusted to what is achievable, never silently |
| 20 | Claude Code facts verified live on 2026-10-19/20 (compaction keeps 5 k tokens/skill within 25 k; `fork` SessionStart matcher; stop-hook cap 8; plugin agents ignore `hooks`/`mcpServers`/`permissionMode`; `${CLAUDE_SKILL_DIR}` skill-only; disabled-injection literal text; `claude plugin eval/details/tag` exist) | 0.1 | Re-check on the day of build; update `AGENTS.md` verification table |

## 10. Complexity hot spots (assign the most care; review twice)

tsconfig chain resolution and typecheck-set selection · JSONC/YAML-subset/TOML-min parsers · the Knip adapters (two JSON shapes, two passes) · gate state machine and wave policy · commit policy and protected-path/edit checks · process management (timeouts, process-group kill, Windows) · fingerprints (diagnostic multiset, worktree fingerprint, finding fingerprint) · ingest determinism.
