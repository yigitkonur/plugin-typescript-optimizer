# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## 0.1.5 - 2026-10-21

### Fixed

- `TS_OPT_HOME` trusted any `CLAUDE_PLUGIN_DATA`. A Bash environment can carry another plugin's value (seen live: the Codex plugin's data dir), so the toolbox and detection cache could land in that plugin's directory, and uninstalling ts-optimize would leave them behind. The variable now counts only when it names this plugin's own data dir (`ts-optimize-<marketplace>`, or `ts-optimize-inline` under `--plugin-dir`). Otherwise the dir derived from the install path is used. Claude Code uses exactly that name and deletes it on `claude plugin uninstall`, as verified.

0.1.4 was on `main` for an hour and was never tagged; use 0.1.5.

## 0.1.4 - 2026-10-21

Found by running the paths 0.1.3 still listed as untested.

### Fixed

- Yarn Berry: `ts-opt pm install` could not update `yarn.lock`. `ts-opt` runs every child with `CI=1`, and Yarn Berry then turns on immutable installs (`YN0028 … lockfile would have been modified`). It now passes `--no-immutable`.
- Yarn Berry: the gate's install leg ran `yarn install --immutable --mode=update-lockfile`, which Yarn 4 rejects (`--immutable … cannot be used with --mode=update-lockfile`). It now runs `yarn install --immutable --mode=skip-build`. Wave 5 on a Yarn PnP project now passes end to end.
- Subagent guard on Windows: the handler checked it was the main module by splitting `argv[1]` on `/`, which never matches a Windows path, so the guard would never have acted. Both guard handlers now compare real paths.
- `struct-09` through Biome 2: the finding had no function name, because Biome 2 reports start and end columns instead of a byte span. The name is now read from those columns.

### Changed

- README rewritten (same facts, lowercase), with a one-command install: `claude plugin install ts-optimize --marketplace yigitkonur/plugin-typescript-optimizer`.
- CI runs an entry-point smoke test on every OS and Node version: the hook handlers started as `node <file>`, and `bin\ts-opt.cmd --version` on Windows.

## 0.1.3 - 2026-10-21

Found by reading the documentation and the code against each other, then confirmed with real runs.

### Fixed

- `ts-opt <command> --help` ran the command: the flag was parsed and ignored, so `ts-opt plan lock --help` locked the plan. It now prints the command's flags and exits 0.
- Subagent guard: a positive ripgrep glob (`-g '*'`, `--glob=.env`, `--iglob`) is applied after the config that excludes secret paths and re-included `.env`, key files and credentials. Only `!` globs are accepted now (use `-t json` or `-t ts` to restrict file kinds), and `--unrestricted`, `-.`, `--no-ignore-files` and `--no-ignore-exclude` are refused. The triager may run only `ts-opt verdict` and `ts-opt rule`; the architect only `ts-opt proposal add`, `rule` and `findings show|list`.
- The `ts-opt` pre-approval hook (H6) covered `ts-opt scan` in every session, although Knip loads the project's config files. It now pre-approves read-only commands always, `verdict`, `findings ingest`, `triage` and `knip-overlay` only while an audit-phase run was written to in the last 6 hours, and never `scan` (the audit skill's own grant covers the first one).
- Command guard: `npx -y tsc`, `npx --yes tsc` and similar never reached the handler because the hook filters matched only `npx tsc `.
- Triage chunk files now carry each candidate's record. Triagers searched the gitignored, hidden `raw/` directory in vain and spent calls on `cd` and retries. The `scan` next action now uses the audit skill's threshold (15 candidates that need reading, not 40) and names the command that fits.
- With `noUnusedLocals` set, `ts-opt check` and `ts-opt commit` refused a wave-3 un-export that left an unused local, and wave B only runs after that commit. The fix skill now removes such residue in the same edit.
- A STRONG architect proposal without a Mermaid diagram is refused (exit 2); `codebase-health.md` promises one for each.

### Changed

- Documentation corrected to match the code: the privacy section (`ts-opt pm install`, the install leg of the gate, the project's scripts and `npm exec` can use the network; auditing runs the project's own tools), the work-branch and `run abort` behaviour (default branch, branch only created from the default branch), commit-guard states, the coverage leg (fails only when the untyped count rises), the `R` wave, the `.ts-optimize/` tree, `TS_OPT_HOME` resolution order, hook opt-outs (they switch off the fast-typecheck hook only), and the support matrix legend.
- `declaration-emit` no longer grants `Edit`; an edit it leads to goes through the normal permission prompt.
- 0.1.1 below is corrected: its entry wrongly listed the struct-10/11 fix, which shipped in 0.1.0.

## 0.1.2 - 2026-10-20

Found by auditing three public repositories (`t3-oss/t3-env`, `shadcn-ui/taxonomy`, `shuaiplus/nodewarden`) with the marketplace install.

### Fixed

- `ts-opt validate` rejected a run in a repository that has a folder with a `tsconfig.json` but no `package.json` (its package has no name).
- Triage subagents wasted calls on `cd` and `for` loops. The guard now says that commands already run in the repository root and points at `rg`/`find`, and `cut` and `tr` are allowed as stdin filters.

## 0.1.1 - 2026-10-20

### Fixed

- Windows: `ts-opt` could not start any package manager or project binary (`npm`, `pnpm`, `yarn`, `node_modules/.bin/*.cmd`): Node refuses to spawn `.cmd` shims without a shell. Shims are now resolved and run through `cmd.exe` with every argument quoted; an argument that `cmd.exe` would expand (a quote, `%`, a line break) is refused.
- Windows: CRLF in the output of child processes broke the diagnostics parsers (the wave B "no residue" check among them). It is normalised to LF before parsing.
- Wave B skips with a measured result (files changed, legs run, diagnostics found) instead of a bare reason.

### Changed

- The CI full suite prepares fixtures serially and installs its own Yarn and Bun, so parallel test files no longer race on a cold cache.

0.1.0 was tagged before the Windows fix; use 0.1.1.

## 0.1.0 - 2026-10-20

First release.

### Added

- Commands: `/ts-optimize:audit` (modes `sweep`, `standard`, `deep`), `/ts-optimize:fix`, `/ts-optimize:tsgo` (`check`, `adopt`, `status`), `/ts-optimize:doctor`.
- Knowledge skills: `declaration-emit`, `ts7-compat`.
- Agents: `ts-triager` (read-only verdicts on candidate findings), `ts-architect` (structural proposals in deep mode).
- Hooks: SessionStart resume pointer, command guard (`knip --fix`, `npx` / `dlx` / `bunx tsc`), commit guard, fast typecheck after edit batches, plugin-subagent guard, and a pre-approval handler for the audit-surface `ts-opt` commands. All are silent outside their gate and fail open on internal errors.
- `ts-opt`: a zero-dependency Node CLI (`bin/ts-opt`, `bin/ts-opt.cmd`) with 27 commands, including `detect`, `doctor`, `scan`, `verdict`, `findings`, `plan`, `run`, `gate`, `commit`, `bisect`, `revert`, `fit`, `toolbox`.
- Engines: Knip (v5 and v6 output both parsed), ast-grep, type-coverage, the project's lint, and a built-in pattern-tell engine, each probed before use and degraded visibly when absent. The optional toolbox (pinned Knip 6, TypeScript 6, type-coverage, ast-grep, plus a native TypeScript 7 in a separate prefix) installs into `$TS_OPT_HOME` after consent.
- Rules: 53 rule files in `catalog/rules/` (plat 2, reach 12, slop 5, struct 11, tc 12, type 11), with packs for frameworks and Cloudflare Workers.
- Waves: `R0`, `R`, `1`, `2`, `3`, `B`, `4`, `5`, `P` for fixes; `T1` to `T4` for TypeScript 7 adoption. Deep mode judges `struct-10` and `struct-11` through `ts-architect` after ingest.
- Artifacts: `.ts-optimize/` with schema-versioned findings, `plan.md` and `plan.lock.json`, `suppressions.json`, `baseline.json`; `ts-opt validate` checks them.

### Known limits

- The Biome path of `struct-09` (complexity hotspots) is untested against a real Biome.
- The Yarn Berry and bun install legs (wave 5 dependency removal and reinstall) are untested.
- Windows is verified in CI only (no Windows machine was used during development), and CI runs the CLI through the Node entry point: `bin/ts-opt.cmd` and the bash hooks have not been run on Windows.
- Triage uses chunks of 8 candidates, not the 40 the design assumed: measured triager runs used 3 to 5.5 tool calls per candidate against a 60-turn limit.
- The coverage leg fails only when the count of untyped identifiers rises, not when the percentage falls, because deleting well-typed code lowers the percentage without adding an `any`.
- The pattern-tell engine is Node-only (no ripgrep), so JavaScript regex semantics apply.
- Several fixture kinds are verified for audit only. See the support matrix in the README.
