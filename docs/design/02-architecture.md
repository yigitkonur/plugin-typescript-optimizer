# 02 — Architecture

## 1. Component tree of the plugin (the build target)

```
ts-optimize/                                  plugin root (git repo root of the plugin)
├─ .claude-plugin/plugin.json                 manifest (§2)
├─ skills/
│  ├─ audit/        SKILL.md  references/{modes.md, triage-protocol.md}          user-invoked
│  ├─ fix/          SKILL.md  references/{waves.md, gate-triage.md, rollback.md}  user-invoked
│  ├─ tsgo/         SKILL.md  references/{config-migration.md, ecosystem.md,
│  │                                       troubleshooting.md, ci-ide.md}         user-invoked
│  ├─ doctor/       SKILL.md                                                      user-invoked
│  ├─ declaration-emit/ SKILL.md references/matrix.md                             model-invoked
│  └─ ts7-compat/   SKILL.md  references/{breaks.md, alias-scheme.md}             model-invoked
├─ agents/ts-triager.md  agents/ts-architect.md
├─ hooks/hooks.json                           (doc 03)
├─ bin/ts-opt  bin/ts-opt.cmd                 thin launcher → lib/cli/main.mjs
├─ lib/                                       zero-dependency ESM (.mjs), Node ≥ 18.17 (§5)
│  ├─ cli/            one module per command + main.mjs (arg parsing, envelope, exit codes)
│  ├─ core/           fs, git, proc (spawn w/ timeout+kill-tree), jsonc, yaml-subset, toml-min,
│  │                  glob (mini: * ** ! {a,b}), semver, hash, log, envelope, clock, home (§6)
│  ├─ detect/         root, typescript-presence, workspaces, package-manager, compilers,
│  │                  frameworks, engines, scripts, packs, generated-code, brief
│  ├─ engines/        tells (regex tier, incl. `<script>` blocks of .vue/.svelte/.astro), astgrep, tsc (diagnostics + fingerprint), knip (adapter v5/v6),
│  │                  importers (import-edge index: file→file edges, tsconfig `paths`/extension resolution; supplies `consumers`, the built-in cycle fallback, single-consumer and test-importer classification),
│  │                  symbols (declaration index: exported names, kinds, line spans, LOC, normalised-token hash for duplicate detection),
│  │                  lint (biome/oxlint/eslint/ultracite), tsgolint, cycles, coverage, tsconfig-health
│  ├─ artifacts/      schema, finding-writer, finding-reader, ingest, index, summary, plan, validate, prune
│  ├─ gate/           legs, baseline, fingerprint, state-machine, wave-policy, commit-policy, bisect
│  ├─ hooks/          session-start.mjs, cmd-guard.mjs, commit-guard.mjs, agent-guard.mjs, fast-check.mjs
│  └─ tsgo/           authority (compiler resolution), fit (probe), alias-scheme (planner)
├─ catalog/
│  ├─ rules/<id>-<slug>.md                    52 rule files (doc 06)
│  ├─ waves.json  risk.json  seams.json  secret-paths.json  lint-denylist.json
│  ├─ removed-options.json  defaults-changes.json  ecosystem-compat.json  astgrep/*.yml
│  └─ packs/{frameworks.json, workerd.json}
├─ schemas/{candidate,chunk,verdict,proposal,rule,finding,findings-index,run,plan,plan-lock,baseline,suppressions,config,envelope,fit,log-event}.schema.json
├─ references/                                shared prose loaded on demand via ${CLAUDE_PLUGIN_ROOT}
│  ├─ slop-origins.md  pocock-tenets.md  types-strictness.md  knip-pitfalls.md
│  ├─ lint-bridge.md   platform-workerd.md  structure-playbook.md  gate-spec.md
├─ toolbox/package.json  toolbox/package-lock.json      optional engines (§6); NOT at plugin root on purpose
├─ evals/                                     `claude plugin eval` cases (dev-time only)
├─ tests/{fixtures,golden,transcripts,hooks}/ fixture repos, golden outputs, recorded live transcripts, hook golden-stdin cases (doc 10)
├─ AGENTS.md  README.md  LICENSE
```

Why no `package.json` at the plugin root: Claude Code auto-installs Node dependencies when the plugin root has a `package.json` and a lockfile (60 s limit, scripts disabled). The engine toolbox must be lazy and consented, so its manifest lives under `toolbox/`.

## 2. Manifest and frontmatter (illustrative; exact fields verified against the live docs)

`.claude-plugin/plugin.json`
```json
{
  "name": "ts-optimize",
  "version": "0.1.0",
  "description": "Audit TypeScript for dead code, AI slop, weak types and tsgo readiness; write reviewable findings; fix them under a verified, traceable gate. Silent in repos without TypeScript.",
  "author": {"name": "<owner>", "url": "<url>"},
  "homepage": "<repo-url>", "repository": "<repo-url>", "license": "MIT",
  "keywords": ["typescript", "tsgo", "knip", "dead-code", "refactor", "audit"]
}
```
No path fields (auto-discovery only), no `userConfig`, no `settings`, no `dependencies`. `name` must not start with `claude-`/`anthropic-`. Bump `version` on every user-facing change (installers gate updates on it; carried from the reference plugin's AGENTS.md).

`skills/audit/SKILL.md` frontmatter
```yaml
---
name: audit
description: Audit a TypeScript codebase for dead code, unused dependencies, AI slop, weak types, tangled imports and tsgo readiness. Writes reviewable findings to .ts-optimize/ and changes no source. Use for "clean up this TS project", "find dead code", "AI slop", "tighten types".
argument-hint: "[path] [--mode sweep|standard|deep] [--domains platform,reachability,types,structure,slop,toolchain] [--diff[=base]]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Agent Bash(ts-opt *) Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git rev-parse *)
---
```
`fix`: same pattern, with `allowed-tools: Read Grep Glob Edit Write Bash(ts-opt *) Bash(git status *) Bash(git diff *) Bash(git log *)`. It deliberately does **not** pre-approve `git add` or `git commit`: commits go through `ts-opt commit`. (`allowed-tools` grants clear on the next user message; the skill therefore never relies on them for continuity, and the CLI is the only mutating shell path.) `tsgo`: same set as `fix` (it edits config). `doctor`: read-only set plus `Bash(ts-opt *)`.

`declaration-emit` / `ts7-compat` frontmatter
```yaml
---
name: declaration-emit
description: Explains and fixes TypeScript declaration-emit errors (TS4023, TS4058, TS4060, TS4081, TS4082, TS2742, TS2883, "cannot be named") and gives the pre-un-export checklist. Use when these codes appear or before removing an `export`.
paths: ["**/*.ts", "**/*.tsx", "**/tsconfig*.json"]
---
```
(Verify at build time that `paths` limits activation as intended; if not, the description alone must keep the skill quiet in non-TS repos.)

Skill bodies call the CLI by bare name (`ts-opt …`, on the Bash PATH via `bin/`) and render plugin paths with `${CLAUDE_PLUGIN_ROOT}` (skill and agent bodies) and `${CLAUDE_SKILL_DIR}` (skill bodies only; it resolves to the *skill's* subdirectory, not the plugin root, and is not documented for agent bodies, so agents and shared files use `${CLAUDE_PLUGIN_ROOT}/…`; **not** available inside Bash-tool commands, so no skill may tell the model to type `$CLAUDE_PLUGIN_ROOT` into a shell).

Dynamic injection used by all four user-invoked skills (`audit`, `fix`, `tsgo`, `doctor`) as their first lines (zero model turns, deterministic):
```
!`ts-opt detect --brief`
```
Contract: `detect --brief` always exits 0 (prints `typescript: none` when nothing is found) so an aborted injection never cancels the skill. If injection is disabled by policy, Claude Code replaces the command with the literal text `[shell command execution disabled by policy]` (the block is not absent), so the first instruction in the body is: "if the detection block above is missing, empty, or contains `[shell command execution disabled by policy]`, run `ts-opt detect --brief` yourself." Whether `!` injection runs inside plugin skills is documented only indirectly (the disabling setting names plugin sources); it is verified in Phase 0 (doc 10 §9 #5).

Agents (`agents/ts-triager.md`)
```yaml
---
name: ts-triager
description: Verifies candidate findings from `ts-opt scan` by reading the code and applying the Three-Question Test; records one verdict per candidate with `ts-opt verdict add`. Read-only. Dispatched by /ts-optimize:audit, not for general review.
tools: Read, Grep, Glob, Bash
model: sonnet
effort: high
maxTurns: 60
omitClaudeMd: true
---
```
`ts-architect`: same tools, `model: sonnet`, `effort: high`, `maxTurns: 80`, `skills: []`; output is `ts-opt proposal add` calls (doc 06 §7). Neither agent has `hooks`, `mcpServers` or `permissionMode` (ignored by Claude Code for plugin agents). Read-only behaviour is enforced, not just requested: `tools` omits Edit/Write, and hook H5 `agent-guard` (doc 03) allow-lists the Bash commands a plugin subagent may run and denies secret-path reads, because plugin agents cannot carry their own hooks or `permissionMode`. `commit-guard` and the scope check remain the backstop.

## 3. `ts-opt` — CLI contract

### 3.1 Conventions
- `stdout` is data only; `stderr` is logs. `--json` prints one envelope object; without it, a compact human text. Workflow skills always pass `--json` except `detect --brief` and `doctor` (text).
- Envelope: `{"ok": bool, "schema": "ts-optimize/envelope@1", "result": …, "warnings": [str], "next_actions": [{"cmd": str, "why": str}], "error": null | {"code": int, "name": str, "message": str, "hint": str|null}}`.
- Exit codes: `0` ok · `2` usage · `3` nothing to do (no TypeScript, or no matching run) · `4` required capability missing (degraded: cannot perform the requested action) · `5` precondition failed (dirty tree, red baseline, stale findings, lock held, not a git repo) · `6` gate/check failed · `7` guard violation (scope, protected path, missing trailer) · `8` artifact invalid or incompatible schema · `70` internal error.
- Every spawned process has a timeout and is killed as a process group. No command reads from a TTY. Child env: `CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0`, `NODE_OPTIONS` sanitised (worker-incompatible flags removed, `--max-old-space-size` kept), `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `NPM_CONFIG_UPDATE_NOTIFIER=false`.
- All paths in artifacts are repo-relative with `/`.
- Global flags: `--cwd <dir>`, `--run <id|latest|open>`, `--json`, `--quiet`, `--no-color`.

### 3.2 Commands

| Command | Purpose | Mutates |
|---|---|---|
| `detect [--brief] [--refresh]` | project model (doc 05 §1–6); cached in `.ts-optimize/.cache/` keyed by mtimes of lockfiles/tsconfigs/package.jsons | cache only |
| `doctor` | capability matrix + degradations + config validation + toolbox state | none |
| `toolbox status\|install\|remove` | lazy isolated engines in `$TS_OPT_HOME/toolbox` (§6); `install` needs consent flag `--yes` after the skill asked | `$TS_OPT_HOME` |
| `scan --mode sweep\|standard\|deep\|tsgo --domains … [--diff[=base]] [--workspace …] [--resume <id>] [--abandon-open] [--rescan-engine knip]` | runs engines + tier-1 tells; writes `raw/` and `candidates.jsonl`; creates the run; filters already-suppressed fingerprints before chunking; `--resume` continues a crashed `scanning` run; refuses (exit 5) while another run is open unless `--abandon-open`; `--rescan-engine` re-runs one engine inside the current run (e.g. after an overlay is written) | `.ts-optimize/` |
| `triage plan [--kind verify\|structure] [--chunk-size 40]` | `verify`: writes `raw/chunks/Cnn.json` for agent-triage candidates; `structure`: writes hot-module group files for `ts-architect`; prints the list | `.ts-optimize/` |
| `verdict add\|status [--defer-missing --reason …]` | record/inspect verdicts (`verdict add` is what `ts-triager` calls; `status --defer-missing` marks never-judged candidates `deferred` after one retry); record shapes in doc 04 §12 | `.ts-optimize/` |
| `proposal add --origin architect\|fixer …` | `ts-architect` records a structure proposal; during `fix` the agent records a discovered extra file/consumer as a new candidate (`--origin fixer --parent F-…`) in the parent's wave; both enter the plan as `open` findings needing approval (doc 04 §12) | `.ts-optimize/` |
| `findings ingest` | verdicts + suppressions + seams → `findings/`, `index.json`, `SUMMARY.md`, `plan.md` | `.ts-optimize/` |
| `findings list\|show\|stale-check` | read access; `stale-check` marks findings whose files changed since the audit as `stale` (also run inside `run begin` and at each wave start) | `stale-check` edits finding files |
| `suppress <F-id> --reason … [--expires]` | add a suppression entry | `suppressions.json` |
| `plan lock\|status\|check\|amend` | `lock`: approvals from `plan.md` checkboxes; `check [--risk low] [--mode auto] [--rule …] [--cascade]`: bulk-tick checkboxes (the chat shortcut for "approve all low-risk auto findings"); `amend F-… --approve` (after the lock: approve a finding added mid-run by `proposal add`, updates `plan.lock.json` with a new hash; the `fix` skill must have the user's explicit yes first); `amend --cascade` approves, in one step and with a new lock hash, the cascade findings the last `rescan` produced | `plan.md`, finding files, `run.json`, `plan.lock.json` |
| `baseline [--legs …] [--save]` | run gate legs, capture metrics | `baseline.json` (only with `--save`), `run.json` |
| `run begin\|status\|finish\|abort\|prune\|wave begin <id>\|wave end <id>` | `begin`: pre-flight (git, clean tree, work branch, stale-check, full baseline, lock) ⇒ `ready`; `wave begin/end`: tags, wave bookkeeping (`wave begin B` recomputes the bridge finding `reach-06` and its `touches` from `git diff --name-only <base>…HEAD`); `finish`: ledger, artifacts commit, outcome; `status`: `result.state`, `waves_pending`, `waves_done`, `finding_in_progress` | git (branch/tags/artifacts commit), `.ts-optimize/` |
| `gate [--wave id] [--legs …]` | authoritative gate; records result against the worktree fingerprint | `run.json`, `apply/` |
| `check` | fast loop: fast compiler typecheck, **new** errors vs baseline fingerprints | `state/fast-check.json` |
| `commit <F-id…> [-m summary]` | scope + trailer + check/gate preconditions, then `git commit` | git, finding files |
| `revert <F-id>` | `git revert` of that finding's commits; marks `reverted` | git, finding files |
| `bisect --wave id` | culprit search over the wave's finding commits using `gate --quiet` | git (temporary) |
| `rescan --wave id` | re-run producing engines after a wave; re-validate pending findings; create `cascade:` candidates | `.ts-optimize/` |
| `fit [--root …] [--status]` | tsgo fit probe (doc 05 §8); run-less: writes `.ts-optimize/fit/latest/{fit.json,tsgo-fit.md}` (copied into a run by `scan --mode tsgo`); `--status` prints compilers + last verdict; `cannot-probe` exits 4 but still prints the result | `.ts-optimize/fit/` |
| `validate [path]` | schema validation of artifacts | none |
| `rule <id>` | print one rule's recipe/triage notes from the catalog | none |
| `knip-overlay [--write] [--from-verdicts]` | compute the minimal Knip overlay config for codifying false positives: bootstrap from detection alone, or (`--from-verdicts`) refine it with the triagers' `--codify` entries | `.ts-optimize/knip.config.jsonc` only with `--write` |

### 3.2a Result contracts (the `result` object the skills read; all inside the envelope)

| Command | `result` keys (stable names; extra keys allowed) |
|---|---|
| `detect` | `typescript` (bool), `root`, `git{clean,branch,head}`, `pm{name,version,source}`, `packages[{path,name,tsconfigs,typecheck_set,declaration_signal}]`, `compilers{authoritative,fast,api_provider}`, `engines{<name>{version,source,works,reason}}`, `lint{engine,autofix}`, `packs[]`, `frameworks[]`, `gate{legs[],unavailable[]}`, `open_run` |
| `scan` | `run`, `mode`, `counts{by_domain,by_rule}`, `noise_gate{tripped,percent}`, `degraded[{domain,part,reason}]`, `candidates` (path), `triage{deterministic,agent}` |
| `triage plan` | `chunks[{id,path,domain,package,candidates}]`, `groups[]` (structure kind) |
| `verdict status` | `judged`, `pending`, `by_chunk{}`, `deferred_missing` |
| `findings ingest` | `findings`, `dismissed`, `suppressed`, `superseded`, `overflow`, `agent_suppressions[]`, `summary` (path), `plan` (path), `needs_decision` |
| `run status` | `run`, `state`, `mode`, `branch`, `waves_pending[]`, `waves_done[]`, `finding_in_progress`, `pass`, `uncommitted_files`, `last_green_wave` |
| `plan lock` | `approved`, `skipped`, `not_eligible[{id,reason}]`, `hash` |
| `check` | `engine`, `ms`, `new_errors[{file,line,code,message}]`, `baseline_errors`, `fingerprint` |
| `gate` | `wave`, `legs{<id>{status,ms,flaky,variant,tail}}`, `passed`, `fingerprint` |
| `commit` | `sha`, `ids[]`, `files[]`, `trailers{}` |
| `fit` | `verdict`, `packages[{path,authoritative,fast,ms{auth,fast,fast_single},diag_equal,only_authoritative[],only_native[],removed_options[{option,file,line}],blockers[{rule,detail}]}]`, `ecosystem[{tool,status,remedy}]`, `ci[]`, `cannot_probe_reason` |

Each result shape has a JSON Schema in `schemas/`; golden outputs per fixture are recorded in Phase 0–4.

### 3.3 Mutation boundaries (enforced in code, tested)
- Only `commit`, `revert`, `bisect`, `run begin|wave begin|finish|abort` touch git (commits, revert commits, branch, tags, and the single artifacts commit made by `run finish`); `commit` is the only command that creates finding commits.
- The fixer edits source with the normal `Edit`/`Write` tools; the CLI never rewrites user source itself. The one exception is the bridge wave (wave `B`): the agent runs the project's own lint engine's autofix command (resolved by `detect`, scoped to files changed in this run), so the edit is made by the user's tool under the user's config, never by plugin code.
- Nothing outside `.ts-optimize/`, `$TS_OPT_HOME`, git objects, and files named in an approved finding's `touches` is ever written.

## 4. Data flow

```
detect ──▶ scan ──▶ candidates.jsonl ──▶ triage plan ──▶ chunks ──▶ ts-triager × N ──▶ verdicts/*.jsonl
                                                                                          │
suppressions.json ◀──────────────────────────────────────────── findings ingest ◀─────────┘
                                                                     │
                                  SUMMARY.md + plan.md + findings/*.md + index.json
                                                                     │  (human edits plan.md)
                                                                  plan lock
                                                                     │
         run begin ─▶ [per wave: per finding: edit → check → commit] ─▶ gate ─▶ (bisect/revert) ─▶ rescan ─▶ next wave
                                                                     │
                                                              run finish ─▶ ledger.md, SUMMARY outcome, baseline floor offer
```

## 5. Runtime requirements and language choice

- **Node ≥ 18.17** for `ts-opt` and hook scripts (needs `fs.cp`, `structuredClone`, stable `fetch` unused). Rationale for Node over bash/Python (the reference plugin used both): every machine that runs TypeScript tooling has Node; bash is not guaranteed on Windows; Python is not guaranteed anywhere. If `node` is missing every hook exits 0 silently (shell prefilter `command -v node >/dev/null || exit 0`) and `bin/ts-opt` prints a one-line error.
- **Zero npm dependencies** in `lib/`. Required in-house parsers (each small, each with fixture tests): JSONC (comments, trailing commas, BOM), YAML subset (front matter + `pnpm-workspace.yaml`), TOML-min (`wrangler.toml` `main`, `compatibility_date`, `compatibility_flags`), mini-glob.
- Git is required for `fix`, `commit`, `revert`, `bisect`, `run`; `audit` and `fit` work without it (no churn data, no `--diff`, `scope` falls back to a bounded filesystem walk).

## 6. `TS_OPT_HOME` and the optional toolbox

`TS_OPT_HOME` resolution (first hit): env `CLAUDE_PLUGIN_DATA` (present in hook processes) → derived from the plugin's own cache path `…/plugins/cache/<marketplace>/<plugin>/<version>/` ⇒ `~/.claude/plugins/data/<plugin>-<marketplace>/` (non-alphanumeric characters other than `_` and `-` replaced by `-`, same rule Claude Code applies) → `${XDG_CACHE_HOME:-~/.cache}/ts-optimize` → the OS temp dir if `HOME` is unset or unwritable. (`CLAUDE_PLUGIN_DATA` is not exported to Bash-tool commands, hence the derivation.)

Holds: `toolbox/` (installed engines), `consent.json` (`{"toolbox": "allow|never", "npx": {"<repo-hash>": "allow|never"}}`), `telemetry/` — **none; there is no telemetry**.

`toolbox/package.json` pins (exact versions chosen at build time and recorded in the lockfile): `knip@6.x`, `typescript@6.x` (private TS 6 for API-dependent engines), `typescript-native` (`npm:typescript@^7`, the native compiler used for `fit` and as the accelerator when the project has none), `type-coverage`, `@ast-grep/cli`. `madge`/`dpdm` are **not** in the toolbox (Knip `--cycles` replaces them); they are used only if the project already has them and the smoke probe passes. Install = copy the manifest and lockfile to `$TS_OPT_HOME/toolbox`, run `npm ci --ignore-scripts --no-audit --no-fund --prefix …` with a 180 s timeout. Engines run from the toolbox resolve *its own* `typescript`, never the project's, which is exactly why `type-coverage` can analyse a TS 7 project (doc 05 §7). `typescript-native` is installed under a separate prefix (`toolbox-native/`) so its `tsc` bin cannot collide with the TS 6 one.

## 7. Cross-cutting rules every module must follow

1. **Silent by default.** Anything that runs without the user asking (hooks) prints nothing unless it has actionable, run-scoped content.
2. **Fail open on infrastructure, fail closed on safety.** A hook that crashes, times out or cannot parse its input exits 0 with no output; `ts-opt commit` / `gate` refuse to proceed if they cannot prove their preconditions.
3. **Prove, don't assume.** Versions, flags and capabilities are probed (`--version`, a 5 s smoke invocation) and recorded in `run.json.env`; the code never branches on "TS is probably N".
4. **Deterministic output.** Sorted, stable-IDed; two audits of the same tree with the same verdict input are identical except the `run`, `verified_on` and `applied` fields (doc 04 §3.3).
5. **No network without consent**; no execution of anything read from an artifact; snippets are data.
6. **One definition of the gate** (`gate/legs.mjs` + `references/gate-spec.md`); no skill, doc or script restates a gate command.
