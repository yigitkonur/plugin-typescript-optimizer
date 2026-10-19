# Acceptance ledger

Every row is filled from a real run: `ran` is the command, `saw` is copied output (secrets masked), status is ✓ / ✗ / UNVERIFIED (+ reason). Never filled from memory. Source of the rows: `docs/design/10-build-plan.md` §2–§8.

| Row | Expect | Ran | Saw | Status |
|---|---|---|---|---|
| 0.1 | `claude plugin validate . --strict` exits 0 | claude plugin validate . --strict; claude plugin validate .claude-plugin/plugin.json --strict | ✔ Validation passed (marketplace manifest); ✔ Validation passed (plugin manifest); exit=0 both; re-run with skills/doctor + hooks/hooks.json present: exit=0 | ✓ |
| 0.2 | F10: `ts-opt detect --brief` prints `typescript: none`, exit 0; H1 golden-stdin run prints nothing, exits 0 in < 50 ms | node --test tests/detect.test.mjs; node tests/harness/hook.mjs tests/hooks/*.case.json | ts-opt detect --brief on F10 → 'typescript: none   root: …/F10', exit 0, no .ts-optimize/ created. PASS H1 silent in a repo with no TypeScript (F10) (2.6 ms, exit 0) stdout="" | ✓ |
| 0.3 | F01: `ts-opt detect --json` equals `tests/golden/F01-detect.json` (pm npm, TS 5.9 js, 1 package, gate legs resolved, engines with `works`) | node --test tests/detect.test.mjs (golden tests/golden/F01-detect.json recorded from the inspected run) | ✔ 0.3 F01 detect matches the golden: pm npm (lockfile), tsc 5.9.3 js, 1 package, typecheck tsc tsconfig.json, test 'npm run test', engines_project knip 6.42.1/biome 2.5.15/type-coverage 2.30.4 works:true | ✓ |
| 0.4 | F02: 7 packages from `pnpm-workspace.yaml` (with a `!` exclusion honoured); libs typecheck via `tsc -b`; per-package typecheck sets | ts-opt detect --brief on F02; node --test tests/detect.test.mjs | pm: pnpm 12.3.4 (packageManager)   packages: 7 (3 apps, 4 libs)   workspaces: pnpm-workspace.yaml ; gate: typecheck ✓ (1 config) [tsc-b via root solution]; packages/legacy excluded by '!packages/legacy' | ✓ |
| 0.5 | F03: exec resolved as `yarn run`; no `node_modules` access attempted (strace-free check: detection works with the directory absent) | ts-opt detect on F03 (no node_modules dir present) | pm: yarn 4.18.1 (packageManager) PnP ; compilers: tsc ? (unknown) via yarn run ; gate: test ✓ yarn run test ; test asserts authoritative.exec == ['yarn','run','tsc'] and node_modules absent | ✓ |
| 0.6 | F09: exactly one TS package (`web/`); no Python file opened (verified by running detect under a read-denied Python dir) | node --test tests/detect.test.mjs (F09 copy with app/ and tests/ chmod 000) | ✔ 0.6 F09 polyglot: one TS package (web/), Python never read; test leg cwd 'web', packages[0].pm npm | ✓ |
| 0.7 | JSONC/YAML/TOML corpora (BOM, CRLF, comments, trailing commas, `extends` arrays, wrangler toml) parse; malformed input never throws out of `detect` | node --test tests/unit/*.test.mjs; node --test tests/detect.test.mjs | 159 parser tests pass (jsonc 32, yaml 46, toml 30, glob 25, semver 26, incl. BOM/CRLF/comments/trailing commas/extends arrays/wrangler); ✔ 0.7 malformed config files never throw out of detect (truncated package.json, bad tsconfig, broken yaml/toml) → ok:true exit 0 | ✓ |
| 0.8 | No git: `doctor` exits 0 with a warning; inside a worktree and a submodule root detection is correct | node --test tests/detect.test.mjs | ✔ 0.8 no git: doctor exits 0 and says 'not a git repo' + 'not a git repository' degradation; git worktree root detected (root ends /wt, subdir → same root) | ✓ |
| 0.9 | `/ts-optimize:doctor` live in `claude --plugin-dir`: the `!` injection renders; output pasted | node tests/harness/live.mjs --fixture F01 --prompt '/ts-optimize:doctor' --row 0.9-doctor-F01; probe plugin with a skill containing !ts-opt detect --brief | claude -p '/ts-optimize:doctor' → Bash 'ts-opt doctor' ran without a prompt (skill allowed-tools grant works), final answer lists knip 6.42.1/biome 2.5.15/type-coverage 2.30.4/ast-grep/rg 'works' and the toolchain degradation; probe skill replied 'typescript: yes   root: …/F01   git: clean on main (ae85ec2)' = ! injection renders, bare ts-opt resolves via plugin bin/ (tests/transcripts/0.9-doctor-F01.md) | ✓ |
| 1.1 | F01 `ts-opt scan --mode sweep --json`: every seeded `must-fire` rule appears; zero `must-not-fire` hits; golden match |  |  | open |
| 1.2 | Determinism: scan + ingest twice with identical verdict input ⇒ byte-identical `findings/` and ids |  |  | open |
| 1.3 | `ts-opt validate` ✓ on generated artifacts; a hand-corrupted finding ⇒ exit 8 naming the field; a file with `schema: …@99` ⇒ exit 8 "incompatible" |  |  | open |
| 1.4 | After a full audit, `git status --porcelain` shows only `.ts-optimize/` (and the generated `.gitignore` excludes `state/`, `.cache/`, `raw/`, `apply/gate/`) |  |  | open |
| 1.5 | F05 (no Knip config): noise gate trips ⇒ one `reach-12` finding; batch 2 candidates withheld from the plan |  |  | open |
| 1.6 | F07: type-coverage smoke probe fails ⇒ `escape-hatch@1` proxy metric recorded; coverage table says `degraded` and why |  |  | open |
| 1.7 | `audit --diff=HEAD~1` limits scope to changed files and skips dead-code engines |  |  | open |
| 1.8 | Live `/ts-optimize:audit` on F01 in a real session: transcript pasted; artifacts exist; **no Edit/Write outside `.ts-optimize/`** (eval `tool_used` negative case) |  |  | open |
| 1.9 | F14 tells-only scan ≤ 60 s, RSS ≤ 500 MB; per-engine timeouts honoured |  |  | open |
| 1.10 | Regex precision suite (`tests/fixtures/rules/*`): all must-fire/must-not-fire cases from doc 06 §11 pass |  |  | open |
| 1.11 | Knip adapter: recorded v5 and v6 JSON outputs both parse to the same candidate set |  |  | open |
| 1.12 | Absence rows: with `rg` removed from PATH the Node tells engine gives the same candidates (slower); with ast-grep absent affected rules are `degraded` and capped at `likely`; with no lint engine slop `auto` fixes are reported as `assisted` |  |  | open |
| 1.13 | F17: `<script lang="ts">` blocks are scanned with correct line offsets; the typecheck leg is the script-defined `vue-tsc`; a template-only consumer is not reported dead by the importer index without a `degraded` note |  |  | open |
| 1.14 | F18: leg `deno check`, no Node-based engines attempted, coverage table says why |  |  | open |
| 1.15 | `consumers`/`touches` for a barrel and an exported symbol come from the importer index and match a hand-built expectation on F01/F02 |  |  | open |
| 2.1 | F05: Next routes/layouts/middleware verdict `false-positive` with Q1 = yes; no deletion proposed; batch-2 high-risk class applied to route-like names |  |  | open |
| 2.2 | F06 (three variants): DO/Workflow classes and `worker-configuration.d.ts` protected; `process.env` finding is `hard` / `warn` / `adv` respectively for the three wrangler variants |  |  | open |
| 2.3 | Live on F02: ≥ 4 `ts-triager` subagents run in parallel (visible Agent calls); the main transcript contains verdict tallies, not file contents |  |  | open |
| 2.4 | `ts-opt suppress F-… --reason …` then re-audit after inserting 10 lines above the symbol ⇒ fingerprint stable, finding `suppressed` |  |  | open |
| 2.5 | F16: injected instructions change no verdict and trigger no tool call outside the triager's allowed set (transcript inspection) |  |  | open |
| 2.6 | `knip-overlay --write` ⇒ overlay file; next scan runs `knip --config` on it; `git diff` of the user's own config files is empty |  |  | open |
| 2.7 | A malformed `verdict add` is rejected (exit 2), nothing written; duplicate verdict for a candidate is rejected |  |  | open |
| 2.8 | F15: decorator-heavy classes produce no dead-member findings on Knip 6 (and `classMembers` is never enabled on 5) |  |  | open |
| 2.9 | H5: a `ts-triager` Bash call `rm`/`sed -i`/`npm i`/redirect is denied, `rg`/`ts-opt verdict add` allowed, `Read .env` denied; the same calls without `agent_type` cost ≤ 5 ms and produce no output |  |  | open |
| 2.10 | Tier-2: triagers' `--codify` entries ⇒ `knip-overlay --from-verdicts` ⇒ `scan --rescan-engine knip`; vanished candidates are dismissed, remaining ones are downgraded to `deferred` with the note |  |  | open |
| 2.11 | Triager sizing: record turns used per chunk on F02 and F05; set `--chunk-size` so the 95th percentile stays under 70 % of `maxTurns` (60); adjust the default if not |  |  | open |
| 2.12 | `verdict status --defer-missing` marks never-judged candidates `deferred` after one retry |  |  | open |
| 3.1 | Live `/ts-optimize:fix` on F01 with ~10 approved findings across waves R0,1,3,B,4: every commit carries `Rule/Finding/Run/Wave` trailers (`git log --format=%B`); `apply/ledger.md` complete; gate green; metrics not regressed; **paste the ledger** |  |  | open |
| 3.2 | Seeded breaker (an un-exported symbol read by a bundler glob): wave gate red ⇒ `bisect` names it ⇒ `revert` ⇒ gate green; finding `reverted` with output reference |  |  | open |
| 3.3 | Raw `git commit` while `applying` ⇒ denied with the H3 message (golden-stdin and live); `ts-opt commit` path works |  |  | open |
| 3.4 | `knip --fix` (no `--fix-type`): deny when applying, `ask` otherwise; `--fix-type exports` allowed; `npx tsc` denied without local TS, allowed with it |  |  | open |
| 3.5 | Dirty tree ⇒ `run begin` exit 5 with list; red baseline ⇒ exit 5; `--allow-red-baseline typecheck` then introduce one new error ⇒ leg fails on the new fingerprint only |  |  | open |
| 3.6 | F13 (no tests): `plan.md` states only waves `B`/`4` schedulable; checking a wave-1 box ⇒ `plan lock` refuses |  |  | open |
| 3.7 | Editing a file outside `touches` ⇒ `ts-opt commit` exit 7 listing it; consumers listed at ingest are accepted |  |  | open |
| 3.8 | Modify a finding's file after the audit ⇒ finding `stale`, removed from the lock |  |  | open |
| 3.9 | Kill the session mid-wave; new session ⇒ H1 pointer text equals golden; `fix` resumes without redoing committed findings |  |  | open |
| 3.10 | F11: un-exporting the TS4060-trap type ⇒ reach-04 pre-check refuses; finding re-expressed as "keep export / register public" |  |  | open |
| 3.11 | Two concurrent `run begin` ⇒ second exit 5 (lock) |  |  | open |
| 3.12 | Repo `pre-commit` hook that fails ⇒ `commit` exit 6 with hook output; never `--no-verify` unless configured |  |  | open |
| 3.13 | F06: staged deletion of `worker-configuration.d.ts` ⇒ exit 7; removing a `ctx.waitUntil(` ⇒ exit 7; added `process.env` in a non-populating variant ⇒ exit 7 |  |  | open |
| 3.14 | `run abort` restores the work branch/tags state described in the log; artifacts remain consistent and valid |  |  | open |
| 3.15 | Baseline/gate probes: `tsc -b --noEmit` unsupported (TS 5.7 composite fixture) ⇒ variant `emit-and-clean`, `git status` clean afterwards |  |  | open |
| 3.16 | Flaky leg (test that fails once) ⇒ `flaky: true`, wave passes; consistently failing ⇒ fails |  |  | open |
| 3.17 | Cascade after lock: wave 2 orphans a file ⇒ `rescan` creates a `cascade:` finding ⇒ `plan amend --cascade` (user yes required by the skill) ⇒ executed in the repeat pass after wave 5; `plan.lock.json.amendments[]` records it |  |  | open |
| 3.18 | Crash recovery: kill during `scan` ⇒ `scan --resume <id>` completes without re-running finished engines; kill during triage ⇒ `verdict status` lists the unjudged candidates |  |  | open |
| 3.19 | Lifecycle: `plan lock` before `run begin` ⇒ exit 5; `scan` while a run is open ⇒ exit 5 unless `--abandon-open`; `run finish` without a green `P` gate ⇒ exit 5; the artifacts commit contains only `.ts-optimize/` files |  |  | open |
| 3.20 | No lint engine: wave `B` is skipped and said so in the plan; `reach-06` residue is handled by `assisted` edits |  |  | open |
| 3.21 | Multi-finding commit (`granularity: batched`) reverted ⇒ all members `reverted` and re-offered as individual `deferred` findings next run |  |  | open |
| 3.22 | Quarantine: a route-like file is moved to `.quarantine/<path>`; Knip/tsc ignore it; `.quarantine/README.md` lists it at `run finish` |  |  | open |
| 4.1 | F08 `fit`: verdict `needs-config`; each removed option reported with `file:line`; `ts-node`, the `ts-morph` script and typescript-eslint listed; the `NODE_OPTIONS` flag found; both compilers timed |  |  | open |
| 4.2 | Live adoption on F08 (branch `chore/upgrade-typescript-go`): after T1–T4 `tsc --version` ≥ 7; six tiers green or the residual (lint on TS 6 via alias) stated; `eslint` still runs; **paste the ledger and tier results** |  |  | open |
| 4.3 | F07 `fit`: `already-native`; `fast-check` uses `tsc`; no `tsgo` script names introduced |  |  | open |
| 4.4 | H4 live on F02: a breaking un-export ⇒ one `additionalContext` naming the consumer error within ≤ 5 s; second batch with unchanged tree ⇒ silent; remove the fast compiler ⇒ silent |  |  | open |
| 4.5 | Divergence ×3 (fixture where the fast compiler fails and the authority passes) ⇒ fast-check disables itself; `SUMMARY.md` records `tsgo-divergence` |  |  | open |
| 4.6 | Offline + no native compiler ⇒ `fit` verdict `cannot-probe` with exactly one next action; `audit`/`fix` unaffected |  |  | open |
| 4.7 | `ts7-compat` triggers (eval `tool_used: Skill`) on the prompt "typescript-eslint says it does not support TS 7.0" |  |  | open |
| 4.8 | After the alias scheme: `node -e "console.log(require('typescript').version)"` ⇒ 6.x while `tsc --version` ⇒ 7.x |  |  | open |
| 4.9 | tc-09 fires on F12 (`@enum`, Closure types) and not on F01 |  |  | open |
| 4.10 | `fit` reports speed-up from measurement (no vendor numbers in output) and includes `--singleThreaded` timing for native compilers |  |  | open |
| 5.1 | F02 deep audit: proposals carry badges; `codebase-health.md` Mermaid parses (`mmdc` or a syntax check in CI) |  |  | open |
| 5.2 | R-wave on a seeded passthrough wrapper: diff-shape check passes, tests untouched, gate green; a variant that edits a test assertion ⇒ commit refused (exit 7) |  |  | open |
| 5.3 | `cn` consolidated across 3 dirs (struct-07): canonical module, call sites redirected, duplicates deleted, cascade rescan reports no new dead files |  |  | open |
| 5.4 | F06 deep: plat-01/02 assisted fixes applied; protected `ctx.waitUntil` count intact |  |  | open |
| 5.5 | A module with no commits for 6 months is not proposed (YAGNI hot-spot scoping) |  |  | open |
| 5.6 | Cascade: pruning a barrel in wave 2 orphans a file ⇒ `rescan` creates `cascade:` finding; grouped approval offered once |  |  | open |
| 6.1 | `ts-opt toolbox install --yes` on a clean machine ≤ 180 s; type-coverage works on F07 via the toolbox; the project's `package.json` untouched (`git diff` empty) |  |  | open |
| 6.2 | Windows runner: F01 audit + fix pass; hooks inactive path documented; `bin/ts-opt.cmd` works |  |  | open |
| 6.3 | F14: full `scan` ≤ 60 s; triage chunk planning ≤ 120 s; RSS ≤ 500 MB |  |  | open |
| 6.4 | `claude plugin eval` (`--runs 3 --threshold 1.0`): all seven cases of doc 11 §10 pass |  |  | open |
| 6.5 | `claude plugin details ts-optimize`: listing cost ≤ 900 tokens |  |  | open |
| 6.6 | `claude plugin validate . --strict` clean; no root `package.json`; no root `CLAUDE.md` |  |  | open |
| 6.7 | Security review (xhigh): artifact injection, argument-array spawning, path traversal via `touches`, secret handling, toolbox integrity (lockfile hashes) |  |  | open |
| 6.8 | Install from the marketplace entry on a fresh profile; run Flow A on a public repo; transcript saved |  |  | open |
