# `ts-optimize` — plan for a native Claude Code plugin for TypeScript optimization

Status: **historical design document.** The plugin in this repository was built from this plan (v0.1.0); where the build differs, [`DEVIATIONS.md`](DEVIATIONS.md) is authoritative. (Original status line: *plan only; nothing is built.*) Written 2026-10-20 from a full read (on 2026-10-19) of
`run-ts-cleanup` and `upgrade-typescript-go` (42 files, ~484 KB), the `plugin-swiftui` reference plugin, the live
Claude Code plugin docs, and web verification of the TypeScript 7 / tooling facts the source skills depend on.

The plugin audits TypeScript (especially AI-written code), writes durable reviewable findings, fixes approved
findings under a verified, traceable gate, and uses the Go-native compiler where it genuinely helps, with clean
fallback. It is silent in repositories without TypeScript and needs no setup. Source provenance: the 42 source files are pinned by git blob SHA in [`source-pin.txt`](source-pin.txt) (tree `38c7138e…`); upstream has since changed, so the plan cites the pinned copy.

## Read in this order

| Doc | What it settles |
|---|---|
| [01 design rationale](01-design-rationale.md) | The plugin as if the skills never existed; what `plugin-swiftui` does and what ports; primitive-by-primitive verdicts (docs-checked); the five decisions with rejected alternatives |
| [02 architecture](02-architecture.md) | Component tree, manifest/frontmatter snippets, the `ts-opt` CLI contract (commands, exit codes, JSON envelope), module list, data flow, runtime requirements |
| [03 hooks](03-hooks.md) | Exactly what fires, what it injects or blocks, latency/token cost, why a hook beats a skill, full `hooks.json`, protected paths, **rejected hooks** |
| [04 artifact spec](04-artifact-spec.md) | `.ts-optimize/` layout; finding/run/plan/baseline/suppressions/config schemas; state machines; worked example |
| [05 detection & degradation](05-detection-and-degradation.md) | How every environment fact is probed; engine resolution; TS 7 ecosystem table; tsgo strategy; gate policy; degradation matrix; behaviour with no TypeScript |
| [06 rules catalog](06-rules-catalog.md) | 52 rules, batches→waves, risk matrix, triage protocol, `ts-architect` contract, Knip policy, lint denylist |
| [07 user flows](07-user-flows.md) | Audit, review, controlled fix with a failure and revert, tsgo fit + adoption, resume, PR review, no-TS, polyglot, degraded |
| [08 content map](08-content-map.md) | Every one of the 42 source files → destination or drop-with-reason; 14 source defects and corrections |
| [09 edge cases](09-edge-cases.md) | 55 stress-test cases → failure mode → design response |
| [10 build plan](10-build-plan.md) | Phases 0–6, ledger-style acceptance rows, fixtures, evals, release, assumptions to verify |
| [11 skill & agent contracts](11-skill-and-agent-contracts.md) | For each skill and agent: arguments, ordered steps with the exact `ts-opt` calls, user questions, stop conditions, prohibitions; the `evals/` cases; user-facing docs to ship |

## Final breakdown of primitives

| Primitive | Used | What |
|---|---|---|
| Skills, user-invoked | 4 | `/ts-optimize:audit`, `:fix`, `:tsgo`, `:doctor` |
| Skills, model-invoked | 2 | `declaration-emit`, `ts7-compat` |
| Agents | 2 | `ts-triager` (read-only verdicts), `ts-architect` (deep-mode proposals) |
| Hooks | 3 events / 5 handlers | `SessionStart` resume pointer · `PreToolUse(Bash)` command guard + commit guard · `PreToolUse(Bash\|Read)` subagent read-only guard · `PostToolBatch` fast check |
| `bin/` | 1 | `ts-opt`, zero-dependency Node CLI (the engine) |
| Data | — | 52 rule files, packs (frameworks, workerd), schemas, ecosystem/removed-option tables |
| Optional toolbox | — | pinned Knip 6 · TypeScript 6 · type-coverage · ast-grep · TypeScript 7, installed lazily with consent into `TS_OPT_HOME` |
| Dev-time | — | `evals/` for `claude plugin eval` |
| **Not used** | — | MCP, `.lsp.json`, monitors, output styles, themes, `userConfig`, plugin `settings.json`, channels, plugin `workflows/` (deferred), legacy `commands/`, agent worktree isolation |

## The decisions that matter most

1. **One engine, many thin skills.** All mechanics live in `ts-opt`; rules are data; skills are small; the six domains are rule groups, not 28 skills.
2. **The project's compiler is the authority; tsgo / native `tsc` is the accelerator.** Probe, never assume. TypeScript 7.0.2 shipped on 2026-07-08 with no JS compiler API until 7.1, so `type-coverage`, `madge`, `typescript-eslint`, `ts-morph`, `ts-node` break on TS 7 projects; the plugin probes each engine, runs API-dependent ones from an isolated TS 6 toolbox, and degrades to labelled proxies.
3. **Audit → document → human approval → controlled fix.** Fingerprinted findings, `plan.md` checkboxes locked into `plan.lock.json`, one traceable commit per finding (batching is opt-in), a full gate per wave, bisect-and-revert on failure, cascade re-scan between waves.
4. **Hooks enforce and restore; they never nag.** Block all-in-one `knip --fix` and the `npx tsc` trap; make `ts-opt commit` the only commit path during a run; restore run position after compaction; surface only *new* type errors after an edit batch; keep the triage subagents read-only. Each handler is gated — on an open run (resume, commit guard, fast check), on a specific command (command guard) or on this plugin's own subagents (agent guard) — so none of them speaks in a repository without TypeScript or outside a run.
5. **No MCP, LSP or monitors in v1** — each has a written reason.
6. **The source skills contain errors that would have shipped as hard-fail rules** (typescript-eslint "fully compatible" with TS 7; "`process.env` never populated in Workers"; contradictory `tsc -b --noEmit` guidance; incomplete removed-options table). All are corrected and listed in doc 08 §3.

## Questions only you can answer

1. **Identity:** plugin/marketplace name, repository owner, license. Assumed `ts-optimize`, MIT, same owner as `plugin-swiftui`.
2. **Engine toolbox consent:** may the plugin install pinned Knip 6 / TypeScript 6 / type-coverage / ast-grep (and TypeScript 7 for probing) into a per-machine directory after a one-time prompt? Without it, reachability audits and coverage ratchets need the project to already have working Knip/type-coverage (the audit degrades visibly, never fails).
3. **Scope of fixes:** may approved fixes edit `package.json`, lockfiles and CI files (wave 5 dependency removal and TypeScript 7 adoption)? Assumed yes, per-finding approval only.
4. **Support floor:** Node ≥ 18.17 for the CLI and TypeScript ≥ 4.9 for audited projects (assumed); say if you need lower.

## What this plan deliberately does not decide

Pinned engine versions (recorded by the builder in `toolbox/package-lock.json`), the exact wording of skill prose (the builder writes it from the contracts here), and anything tagged "verify" in doc 10 §9 — each of those has a stated fallback so the builder never has to make a design call.

## Sources consulted for verification (2026-10-19/20)

[TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) · [typescript-go](https://github.com/microsoft/typescript-go) and [CHANGES.md](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md) · [Visual Studio Magazine, 7.0 RC](https://visualstudiomagazine.com/articles/2026/06/22/typescript-7-0-rc-moves-microsofts-go-rewrite-into-the-mainline-compiler.aspx) · [typescript-eslint #12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) · [Knip v6](https://knip.dev/blog/knip-v6), [CLI](https://knip.dev/reference/cli), [auto-fix](https://knip.dev/features/auto-fix), [wrangler plugin](https://knip.dev/reference/plugins/wrangler) · [tsgolint v7 (InfoQ)](https://www.infoq.com/news/2026/09/tsgolint-oxlint-typescript/) · [type-coverage](https://github.com/plantain-00/type-coverage) · [madge #462](https://github.com/pahen/madge/issues/462) · [claude-plugins-official #4492](https://github.com/anthropics/claude-plugins-official/issues/4492) · [Cloudflare Workers `process`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/) · Claude Code docs: plugins/components, plugins/manifest-reference, hooks, skills, sub-agents, mcp, plugins/code-intelligence, plugins/loading, plugin-evals.
