# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## 0.1.0

First release.

### Added

- Commands: `/ts-optimize:audit` (modes `sweep`, `standard`, `deep`), `/ts-optimize:fix`, `/ts-optimize:tsgo` (`check`, `adopt`, `status`), `/ts-optimize:doctor`.
- Knowledge skills: `declaration-emit`, `ts7-compat`.
- Agents: `ts-triager` (read-only verdicts on candidate findings), `ts-architect` (structural proposals in deep mode).
- Hooks: SessionStart resume pointer, command guard (`knip --fix`, `npx` / `dlx` / `bunx tsc`), commit guard, fast typecheck after edit batches, plugin-subagent guard, and a pre-approval handler for the audit-surface `ts-opt` commands. All are silent outside their gate and fail open on internal errors.
- `ts-opt`: a zero-dependency Node CLI (`bin/ts-opt`, `bin/ts-opt.cmd`) with 27 commands, including `detect`, `doctor`, `scan`, `verdict`, `findings`, `plan`, `run`, `gate`, `commit`, `bisect`, `revert`, `fit`, `toolbox`.
- Engines: Knip (v5 and v6 output both parsed), ast-grep, type-coverage, the project's lint, and a built-in pattern-tell engine, each probed before use and degraded visibly when absent. The optional toolbox (pinned Knip 6, TypeScript 6, type-coverage, ast-grep, plus a native TypeScript 7 in a separate prefix) installs into `$TS_OPT_HOME` after consent.
- Rules: 53 rule files in `catalog/rules/` (plat 2, reach 12, slop 5, struct 11, tc 12, type 11), with packs for frameworks and Cloudflare Workers.
- Waves: `R0`, `R`, `1`, `2`, `3`, `B`, `4`, `5`, `P` for fixes; `T1` to `T4` for TypeScript 7 adoption.
- Artifacts: `.ts-optimize/` with schema-versioned findings, `plan.md` and `plan.lock.json`, `suppressions.json`, `baseline.json`; `ts-opt validate` checks them.

### Known limits

- The Biome path of `struct-09` (complexity hotspots) is untested against a real Biome.
- The Yarn Berry and bun install legs (wave 5 dependency removal and reinstall) are untested.
- Windows is verified in CI only; the development ledger row for it (6.2) is open.
- The `claude plugin eval` suite, the listing-cost check, the security review and the install-from-marketplace run (ledger rows 6.4 to 6.8) are open.
- Triage uses chunks of 8 candidates, not the 40 the design assumed: measured triager runs used 3 to 5.5 tool calls per candidate against a 60-turn limit.
- The coverage leg fails only when the count of untyped identifiers rises, not when the percentage falls, because deleting well-typed code lowers the percentage without adding an `any`.
- The pattern-tell engine is Node-only (no ripgrep), so JavaScript regex semantics apply.
- Several fixture kinds are verified for audit only. See the support matrix in the README.
