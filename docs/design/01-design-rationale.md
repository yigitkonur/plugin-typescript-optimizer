# 01 — Design rationale

## 1. Starting point: the plugin as if the two skills had never existed

A good TypeScript optimization plugin has four properties, and the rest follows from them:

1. **Evidence before opinion.** Tools *locate* candidates (Knip, the compiler, lint engines, regex/AST tells); the model *judges* each one by reading code; only judged findings reach disk. Static analysis is blind to framework routes, dynamic imports, RPC bindings, and public contracts, so "the engine said so" is never grounds to delete.
2. **Safety is mechanical, not advisory.** Anything catastrophic, repeated, or easy to forget (all-in-one `knip --fix`, committing without a green check, deleting an ambient `.d.ts`, stripping `ctx.waitUntil`) is enforced by code at the tool boundary, not by a paragraph in a prompt.
3. **The compiler is the authority; faster compilers are accelerators.** TypeScript 7 made the native compiler the default `tsc`. A plugin that merely *calls* it is table stakes; the value is in using speed where it changes behaviour (a project-wide check after every edit batch) while never letting a fast engine overrule the project's pinned compiler.
4. **Quiet by default, durable by design.** Nothing speaks unless there is run-scoped, actionable content. Everything worth keeping (findings, decisions, suppressions, baselines, the plan, the ledger) is a reviewable file in the repo.

The two source skills supply the **knowledge** (what to look for, how to triage, in which order to remove things, how to prove each step, how to migrate to the native compiler). This plugin supplies the **machinery** the skills could only describe. Where a skill gave an instruction that a program can enforce, the program enforces it (doc 08 lists each rail and what enforces it now).

## 2. What the reference plugin does, why, and what ports

`plugin-swiftui` solves a different problem: Swift/SwiftUI API knowledge is sparse, fast-moving and hallucination-prone, so it ships a **1,857-app evidence corpus** behind a CLI, and 28 narrow audit skills, each with its own lint rules. Reading its files shows these deliberate splits:

| Pattern in `plugin-swiftui` | Why it is built that way | Verdict for TypeScript | Reason |
|---|---|---|---|
| Corpus CLI `swiftui-ctx` (lookup/consensus/permalinks) | Models cannot recall current SwiftUI API shapes; ground truth must come from shipping apps | **Not ported** | TypeScript's ground truth is the user's own repo plus the compiler; there is no analogous external corpus worth shipping. The *shape* of the CLI is ported: JSON envelope, `next_actions`, semantic exit codes |
| `bin/` shim so the model can run a bare command | `${CLAUDE_PLUGIN_ROOT}` is not reliable on the model-invoked skill path | **Ported** (`bin/ts-opt`) | Docs confirm `bin/` joins the Bash PATH and that plugin-root variables are absent from Bash-tool commands |
| 28 domain skills + 1 orchestrator, each with `lint/`, `references/`, `scripts/` | Each Swift domain has its own API surface and OS-floor tables | **Not ported as skills; ported as data** | TS domains are few and process-heavy, not API-surface-heavy. Every skill adds listing cost to every session (budget ≈ 1 % of context). 52 rules become data files read by one engine; domains are rule groups |
| Shared finding schema (byte-identical frontmatter) and `_SUMMARY.md` | Many auditors must produce comparable output | **Ported and strengthened** | Versioned JSON Schemas, fingerprints, state machine, determinism guarantee (doc 04) |
| Fix-safety protocol (clean tree, findings-first, `fix_mode` is law, one commit per finding, guards-first order, idempotent, never weaken a check, verify after fix) | Auto-fixing finished apps is risky | **Ported; enforced by code** | `ts-opt commit` + `commit-guard` make "findings-first / one commit per finding / verify" impossible to skip |
| Hybrid lint runner: grep tells → ast-grep structural → parse-probe safety rail, graceful degradation | Grep is robust, ast-grep is precise, ast-grep can silently miss unparsable files | **Ported** | Same three ideas; ast-grep has TS/TSX grammars; the probe marks files the structural tier could not parse |
| Orchestrator dispatching parallel subagents per domain, filesystem as the only shared channel, barrier per wave | 28 independent reads | **Ported, narrowed** | Parallel fan-out only for *triage* chunks; *fixes* are serial and ordered (the protocol itself forbids parallel fixing) |
| `PostToolUse` deprecation guard: static grep, non-blocking, opt-out via settings/env, `additionalContext` | Swift deprecations are a closed list of names, cheap to grep, high value | **Pattern ported to different hooks; the hook itself not** | TS "sloppy AI code" signals are context-dependent (`as any` is legitimate in tests/boundaries); an edit-time nudge would add noise and does not improve audits/fixes/tsgo adoption. The *discipline* (static, silent, opt-out, bounded) is applied to H1–H4 |
| `.swiftui-plugin/settings.md` (gitignored) + `/swiftui-settings` command + `SWIFTUI_GUARD` env | Hook needed a per-project toggle | **Ported, simplified** | `.ts-optimize/config.json` (committed, team-shared) + `TS_OPTIMIZE_HOOKS` env; no settings command (edit JSON; `doctor` validates) |
| Reviewer agent (read-only, evidence-bound output) | Isolate review output | **Ported as `ts-triager`** | Output is a verdict per candidate, written through the CLI, not prose |
| Commands written as model-first instructions (no `$ARGUMENTS`, no `!`, no `allowed-tools`) | Commands were invoked by the model through the Skill tool, where substitution did not run | **Not needed for the workflow skills** | They are `disable-model-invocation: true`, i.e. always user-invoked, where arguments and `!` injection work; the knowledge skills avoid relying on either |
| MCP server (`packages/codex-plugin/mcp`) | Codex hosts needed a tool surface; the Claude package used `bin/` | **Not ported** | See §3 |
| Dual packaging (Claude + Codex), marketplace builders, npm mirrors | Cross-host distribution | **Out of scope** | You asked for a Claude Code plugin |
| Data pipeline (`scripts/00…08`), eval seeds (`baseline` vs `grounded`) | Build the corpus; measure grounding | **Eval idea ported natively** | `claude plugin eval` cases (trigger and no-mutation checks) replace bespoke eval scripts |
| `AGENTS.md`: bump `version` on every user-facing change; manifest is strictly validated | Installers gate updates on the manifest version | **Ported** | Build rules in doc 10 §0 |

## 3. Primitive-by-primitive decisions (docs checked 2026-10-19; paths under `code.claude.com/docs/en/`)

| Primitive | Decision | Why it earns (or does not earn) its place |
|---|---|---|
| Manifest `.claude-plugin/plugin.json` (`plugins/manifest-reference`) | **Use**, minimal: name, version, description, author, homepage, repository, license, keywords | Auto-discovery covers everything else; unknown/mis-typed path fields are stripped or rejected |
| Skills, user-invoked (`skills`, `disable-model-invocation: true`) | **Use ×4**: `audit`, `fix`, `tsgo`, `doctor` | Three workflows with different consent/risk, plus the capability/degradation report. Both source skills were already explicit-only because they delete code. Arguments (`$ARGUMENTS`) and `!` injection work for user invocation |
| Skills, model-invoked | **Use ×2**: `declaration-emit`, `ts7-compat` | Pure knowledge that should surface on an error code or a question ("TS4060", "typescript-eslint does not support TS 7"). `paths:` TS globs keep them quiet elsewhere. A third (`slop catalog`) was rejected: it would load during ordinary TS coding for little gain and its content is consumed by the engine and agents |
| Legacy `commands/` | **Not used** | Docs: commands are the legacy layout; skills are loaded identically |
| Agents (`sub-agents`, `plugins/components`) | **Use ×2**: `ts-triager`, `ts-architect` | Context isolation for read-heavy judgement. Plugin agents ignore `hooks`/`mcpServers`/`permissionMode`/`initialPrompt` (docs), so safety lives in `tools`, the prompt, and CLI/hook checks. `omitClaudeMd: true` trims tokens |
| Agent `isolation: worktree` | **Not used** | A JS worktree has no `node_modules`; reinstalling per attempt is slow and drifts the lockfile. Risky refactors are made safe by per-finding commits, wave tags, and `revert`/`bisect` instead |
| Hooks (`hooks`) | **Use**: 3 events, 5 handlers | Doc 03: only invariants and state recovery. H1/H3/H4 are run-gated, H2 is command-gated, H5 is gated on this plugin's own subagents; a shell-only prefilter and `if` filters avoid spawning Node for unrelated calls |
| `.mcp.json` / `mcp_tool` hooks (`mcp`) | **Not used** | A standing server per session costs process, tool-schema tokens and trust prompts, for typed IO that a JSON-envelope CLI over Bash already gives. The reference plugin shipped MCP only for hosts without `bin/`+Bash. No standing state needs a server (state is files) |
| `.lsp.json` (`plugins/code-intelligence`) | **Not used in v1** | Gives per-edit diagnostics of the *edited file*; un-exporting/deleting breaks *other* files, which only a project-wide check (H4) catches. On TS 7 the official `typescript-lsp` plugin cannot start (no tsserver; upstream issue #4492) and community plugins already ship version-aware launchers; shipping a competing server would create two `.ts` servers. `doctor` prints that `tsc --lsp --stdio` exists. Revisit in v2 |
| Monitors (`plugins/components#monitors`) | **Not used** | Experimental, interactive-only, unsandboxed long-running process; cannot be tied to run end; a `tsc --watch` stream would also need debouncing and baseline diffing that H4 already does deterministically per edit batch |
| Plugin `workflows/` | **Deferred** | Natural home for very large triage fan-outs (schema-validated results, resumable), but it starts agents at scale (explicit opt-in) and its docs page was not verified in this research. v1 uses `Agent` dispatch in batches of 4 |
| `bin/` (`plugins/components#executables`) | **Use** | The engine surface: one allow rule (`Bash(ts-opt *)`), typed output, zero standing cost |
| `userConfig` | **Not used** | "Works with no setup." Install-time prompts are friction; per-project config is a committed JSON file; per-machine consent is a file in `TS_OPT_HOME` |
| Plugin `settings.json` | **Not used** | Only `agent` and `subagentStatusLine` take effect; neither fits |
| Output styles, themes | **Not used** | No presentation concern |
| Channels, `dependencies` | **Not used** | No external service; no plugin dependency |
| Skill/agent frontmatter `hooks:` | **Not used** | Inactive after `resume`/`clear` until re-invoked and not covered by `claude plugin validate` (doc 03 §6) |
| `evals/` (`plugin-evals`) | **Use (dev-time)** | Native acceptance tooling for trigger and no-mutation properties; not loaded at runtime |
| Dynamic `!` injection in skills | **Use** in the 3 workflow skills + `doctor` | Deterministic ground truth (`ts-opt detect --brief`) in the prompt with zero model turns; documented fallback if injection is disabled |
| Skill `paths:` | **Use** on knowledge skills (verify) | Limit ambient activation to TS repos |
| Skill `allowed-tools` | **Use** | Pre-approves `Bash(ts-opt *)` and read-only git for the turn; never relied on for continuity (grant clears on the next message) |

## 4. Why one CLI, in Node, with zero dependencies

- The mechanical parts of both source skills (package-manager resolution, gate construction, batch classification, tsconfig checks, cycle detection, Knip ingestion) were scripts. Scripts are where determinism lives; prose is where judgement lives.
- Node because the audience runs TypeScript tooling (Node is present), Windows lacks guaranteed bash/Python, and the CLI must parse JSONC/JSON/TOML/YAML-subset with no install step. Zero npm dependencies because plugin installs copy files and only auto-install under strict conditions; a vendored dependency tree would bloat and age.
- One CLI (not one script per command) so the artifact schema, state machine, gate definition and commit policy exist exactly once and are shared by skills, hooks and humans.

## 5. The five decisions that matter, with alternatives rejected

1. **Engine + data, thin skills.** *Rejected:* a skill per domain (listing cost, duplicated protocol); one monolithic 30 KB skill (the source `SKILL.md`; it loads everything for any request and cannot be enforced).
2. **Authoritative vs fast compiler; probe, don't assume; engines run against a TS they can use.** *Rejected:* "just use tsgo everywhere" (declaration-emit and JSDoc differences, projects that cannot adopt it yet, tools that need the JS API); "never use tsgo unless the user upgrades" (forfeits the tight loop that is the point).
3. **Audit → document → approve → controlled fix with durable artifacts.** *Rejected:* one-shot "clean up" command (no review point); auto-approve policies (a reviewer must be able to say no to each change).
4. **Hooks only where they enforce or restore.** *Rejected:* edit-time slop nudges, Stop gates, per-prompt context (doc 03 §6).
5. **No MCP/LSP/monitors in v1.** *Rejected:* an MCP server exposing the CLI (standing cost, no new capability); an LSP config (per-file scope, TS 7 split, duplicates community plugins); a watch monitor (lifecycle and noise).

## 6. Register of NEW PROPOSALS (not in the two source skills)

Everything in this plan is either (a) carried from the source skills (doc 08 maps it), (b) taken from the reference plugin's patterns (§2), (c) taken from verified external facts (TypeScript 7 docs, Knip, Cloudflare — cited in doc 08 §3/§5), or (d) listed here. Items in (d) are the author's decisions to confirm:

| NEW | Proposal | Why it was added | Where |
|---|---|---|---|
| N1 | `ts-opt` CLI as the single engine (the source had three Python scripts and prose) | Determinism, shared gate/schema/policy, silent hooks | 02 |
| N2 | Durable artifact system: schema-versioned findings, fingerprints, `plan.md` checkboxes → `plan.lock.json`, suppressions ledger, baseline floors, ledger | "Document … reviewable before anything changes"; traceability | 04 |
| N3 | Five hook handlers on three events (`resume-context`, `cmd-guard`, `commit-guard`, `fast-check`, `agent-guard`) | Enforce source rails mechanically; restore state; tsgo-enabled inner loop; keep triage subagents read-only | 03 |
| N4 | Per-finding commits with `Finding:` trailers (opt-in `commit.granularity: batched` for ≤ `batch_max` same-rule low-risk findings; `R0`/`B` bulk by nature); wave tags; `bisect`/`revert` (source: one commit per *wave*) | Traceability to the finding | 03, 04 §6, 05 §9 |
| N5 | Probe-based capability model; engine resolution order; isolated toolbox with consent; proxy metric `escape-hatch@1` | Works on TS 7 projects where `type-coverage`/`madge` crash; zero-setup | 05 §7, 02 §6 |
| N6 | Authority vs fast compiler; accelerator mode; `fit` probe and verdicts; divergence self-disable | "Use tsgo where it really helps" with clean fallback | 05 §8 |
| N7 | Wave `R0` (mechanical lint autofix as its own wave) and post-flight `P`; cascade rescan with grouped approval | Source describes the autofix step and the cascade effect in prose without a wave id or mechanism | 06 §3 |
| N8 | Knip noise gate + non-mutating overlay config (replaces writing `knip.jsonc`); `--production` second pass to derive test-only leaks; scoped-bulk-fix equivalence check | Zero-config first runs explode with false positives; source forbids rewriting engine config | 06 §12 |
| N9 | Red-baseline policy with fingerprint comparison and `untrusted` legs (source: "red baseline is disqualifying") | Real TS 7 repos have a broken lint leg on day one | 05 §9 |
| N10 | Rules plat-02 (floating binding calls), tc-09 (JS/JSDoc differences), tc-10, tc-11, type-09 without a score | Source states the invariants or the CHANGES but gives no detector; some from TS 7 `CHANGES.md` | 06 |
| N11 | `--diff` audit mode for AI-written PRs; polyglot/monorepo package model; `gate.scope: affected` | Brief: generic and robust; "especially sloppy code written by AI" | 07, 05 §2–3 |
| N12 | `ts-triager` and `ts-architect` agents (the source has the content, not the delegation) | Context isolation | 11 |
| N13 | Skills `declaration-emit` and `ts7-compat` as ambient knowledge | Fire on error codes/questions | 11 |
| N14 | Protected edit patterns (`ctx.waitUntil` count, handler removal, added `process.env`) enforced at commit | Source says "never strip" as prose | 03 §4 |
| N15 | Alias scheme (`typescript` → `@typescript/typescript6`, `@typescript/native` → `typescript@7`) replacing the source's import-rewrite as the default bridge | Microsoft's documented side-by-side setup keeps unmodified tools working | 05 §8.4 |
| N16 | `evals/` via `claude plugin eval`; fixture matrix | Native acceptance tooling | 10, 11 |
| N17 | Corrections to the source (typescript-eslint, Knip v5, `process.env`, removed options, `tsc -b --noEmit`, gate commands) | Verified against current sources | 08 §3 |
| N18 | `doctor` skill + `ts-opt doctor` (capability matrix, hook log, toolbox state, config warnings) | "Degradation explained" must be visible on demand, not only in `audit` output; the reference plugin has no equivalent | 02, 11 §4 |
| N19 | Single-run lock (`state/open-run`), resumable scans (`scan --resume`, `--abandon-open`), 14-day expiry of an unlocked `planned` run | Two runs on one tree corrupt each other; sessions die mid-scan | 04 §4.2, 02 |
| N20 | `max_findings_per_domain` overflow file; `config.json` thresholds and `commit.*`/`gate.*` knobs (each with a documented default) | A 4 000-finding repo must still produce a reviewable plan; knobs exist only where a real edge case needed one | 04 §6, §3.6 |
| N21 | Seams file (`seams.json`) so deletion/quarantine decisions for route-like, RPC and ambient files are data, not model memory | Source says "never delete framework-routed files" without a mechanism | 06 §10 |
| N22 | tsgo adoption split into `T1`–`T4` waves (probe/config → bridge → switch → CI/IDE) with the six-tier gate | Source's migration is one prose sequence; waves make each step revertible | 05 §8.4, 06 §3 |
| N23 | Semantic-invariance check at commit (assertion lines unchanged, no new control flow unless the rule sets `allows_new_control_flow`) for `semantic_invariance` rules | Source says "behaviour-preserving" without a test; this is the cheapest mechanical approximation | 06 §6, 03 H3 |
| N24 | Flaky-leg policy: one re-run of a failed `test`/`build`, logged as `flaky: true` | A red gate caused by noise would otherwise trigger a bisect and a wrongful revert | 05 §9 |
| N25 | `plan amend` and `proposal add --origin fixer`: findings discovered mid-run are proposed, then approved by the user; a finding's `touches` is never widened silently | Source lets the fixer improvise; the audit trail would be lost | 02, 04 §5 |
| N26 | Verdict validation (`verdict add` rejects missing evidence strings, `certain` without a searched-consumer proof, `speculative` deletes); `--defer-missing` for incomplete triage | Keeps agent output machine-checkable | 04 §3.6, §12 |
| N27 | Untrusted-snippet and secret hardening: snippets capped and fenced as `untrusted`, `agent-guard` hook (H5) keeps `ts-triager`/`ts-architect` read-only and out of secret paths | Prompt injection through repository text is the main new risk of delegating reads | 04 §1, 03 H5 |
| N28 | `bin/ts-opt.cmd` shim and `TS_OPT_HOME` fallback chain (including OS temp) | Windows launcher and read-only home directories | 02 §6, 09 #53 |
| N29 | Agent-made suppressions (false-positive verdicts above a confidence bar become 90-day suppressions, listed for human review) | Stops the same false positive being re-triaged every audit | 04 §3.6, §7 |
| N30 | Cascade repeat pass (`pass: 2`, at most `pass: 3`) after wave 5 | Source says cascades "recur on a subsequent cycle" with no mechanism or bound | 06 §3 |
| N31 | Importer index (`engines/importers`) and symbol index (`engines/symbols`) as built-in tier-1 engines; `consumers` copied into `touches` | Gives every export/type/barrel rule a consumer set without Knip or the JS compiler API | 05 §7, 06 §14 |

## 7. Earn-its-place audit of the plugin's own components

The brief asks that every primitive justify itself. Applied to what this plan itself adds (doc 02's CLI, the rule catalog, the skills):

| Component | Verdict | Reason / what would remove it |
|---|---|---|
| CLI commands (doc 02 §3.2) | **All kept, each tied to a flow** | `detect`/`doctor` → A, G, H, I; `scan`/`triage plan`/`verdict`/`findings ingest` → A, F; `plan`/`suppress` → B; `run`/`baseline`/`gate`/`check`/`commit`/`revert`/`bisect`/`rescan` → C, E; `fit`/`toolbox` → D; `validate`/`rule`/`knip-overlay`/`proposal` → A, C (used by skills, agents, CI). A command with no flow in doc 07 would be cut; `prune` is the only housekeeping command and exists because `.ts-optimize/runs/` otherwise grows without bound |
| `doctor` skill | **Kept, thin** | A skill that only runs one command and relays it. It earns its place because the user otherwise has no way to ask "why is reachability unavailable?" without starting an audit. If `audit` printed the same table it would be cut; it does, but only at audit start |
| Flag-only rules (reach-10, reach-12, struct-10, struct-11, tc-07, tc-09, tc-10, tc-11, plus advisory-only type/struct signals) | **Kept as findings, never scheduled** | They document a risk or a decision the tool must not take (zombie feature flags, deepening, IDE settings, parity drift). Cost: one finding file each, no wave. They are the source's "report, do not fix" cases; dropping them would hide real findings |
| Mermaid before/after (Deep mode only) | **Kept, scoped to `STRONG` proposals** | A structure proposal is a graph claim; a diagram is the cheapest review artifact for it. Not generated in sweep/standard; builder's CI only syntax-checks it (doc 10 5.1) |
| Optional toolbox | **Kept, consent-gated** | The only way TS 7 projects get Knip/coverage/AST engines without touching `package.json`. Removing it makes reachability unavailable on exactly the projects the plan targets; consent keeps it from being a hidden install |
| `ts-architect` agent | **Kept, Deep mode only** | Design judgement across modules is the one task that is neither deterministic nor a per-candidate verification. Zero cost outside Deep mode |
| 52 rules | **Kept; 17 need no triage model call** | 14 rules are `triage: deterministic` and 3 more (tc-03, tc-04, tc-09) detect deterministically (doc 06 §8); the rest exist because the source documents them with evidence and need a read of the code. A rule whose detector cannot be written in doc 06 §14 is flag-only, not dropped |
| Hooks H1–H5 | See doc 03 §1–§6 | Five handlers kept; every other candidate event/type is in the rejected table with its reason |

## 8. Non-goals (explicit)

Codex or other host packaging · fully autonomous end-to-end fixing with no review · editing the user's Knip/ESLint/Biome configuration except through an approved finding · vendoring or installing `anti-slop` or other lint plugins · HTML dashboards · telemetry of any kind · publishing `ts-opt` to npm for CI (a v2 candidate: the artifacts are plain files, so CI can already validate them with a JSON Schema validator) · supporting TypeScript older than 4.9 beyond best-effort.
