# ts-optimize

A Claude Code plugin that audits a TypeScript codebase for dead code, unused dependencies, AI-written slop, weak types, tangled imports and native-compiler (TypeScript 7 / tsgo) readiness. It writes the findings to `.ts-optimize/` as reviewable Markdown, waits for you to approve them, then applies the approved ones in waves. Each finding becomes one commit and a verification gate runs after every wave. It stays silent in repositories without TypeScript.

<!-- CI-STATUS -->

## Install

Inside Claude Code:

```
/plugin marketplace add yigitkonur/plugin-typescript-optimizer
/plugin install ts-optimize@claude-ts-optimize-plugin
```

From a shell:

```
claude plugin marketplace add yigitkonur/plugin-typescript-optimizer
claude plugin install ts-optimize@claude-ts-optimize-plugin
```

## Commands

```
/ts-optimize:audit [path] [--mode sweep|standard|deep] [--domains <csv>] [--diff[=base]] [--triage auto|inline|agents]
```
Reads the code and changes no source. Writes `.ts-optimize/runs/<id>/` (findings, `plan.md`, `SUMMARY.md`). Default mode is `standard`; `sweep` is the cheapest pass; `deep` adds structural proposals.

```
/ts-optimize:fix [run-id|latest] [--waves <csv>] [--approve-low]
```
Applies the findings you approved in `plan.md`, wave by wave. Refuses a dirty working tree or a red baseline. Run it again to resume.

```
/ts-optimize:tsgo [check|adopt|status]
```
`check` (default) and `status` change nothing: they time the project's compiler against a native one and list blockers with `file:line`. `adopt` migrates step by step on a branch, with one commit per finding.

```
/ts-optimize:doctor
```
Read-only report: detected packages, package manager, compilers, engines (Knip, ast-grep, type-coverage, lint), gate commands, and the one action that fixes each degradation.

Two knowledge skills load on their own when relevant, and change nothing:

- `declaration-emit`: TS4023, TS4058, TS4060, TS2742, TS2883 and "cannot be named" errors; also consulted before removing an export from a package that publishes `.d.ts` files.
- `ts7-compat`: what breaks under TypeScript 7 (no JavaScript compiler API before 7.1, removed options, typescript-eslint, ts-morph, ts-node, type-coverage) and the `tsc` / `tsc6` alias scheme.

Two read-only subagents are used by the audit: `ts-triager` (verifies candidate findings by reading the code) and `ts-architect` (structural proposals in deep mode).

## Flow

```
/ts-optimize:audit
      |  scan (engines + pattern tells) -> triage (subagents) -> findings
      v
.ts-optimize/runs/<id>/plan.md      <- you read it and tick the boxes you approve
      |
      v
/ts-optimize:fix
      |  run begin: clean tree, work branch, baseline gate captured
      |  plan lock: the ticked set is hashed
      v
  for each wave:   edit one finding -> ts-opt commit (one commit per finding)
                   -> gate (typecheck, tests, build, declaration emit, ...)
                   -> red? bisect to the culprit, revert it, gate again
                   -> rescan for cascades (files orphaned by this wave)
      v
run finish: ledger (finding -> commit -> gate), artifacts committed
```

Waves, in order: `R0` mechanical lint autofix, `R` root cause (deep mode only), `1` dead files, `2` barrels and import cycles, `3` encapsulation, `B` unused locals and dangling imports, `4` types, `5` dependencies and lockfile, `P` post-flight. `/ts-optimize:tsgo adopt` uses `T1` to `T4` (config, tooling bridge, engine switch, CI and IDE).

## What it writes into your repo

```
.ts-optimize/
  README.md, .gitignore         generated
  config.json                   optional, yours
  suppressions.json             findings you dismissed (committed)
  baseline.json                 accepted metric floors (committed)
  state/  .cache/               gitignored (open-run pointer, lock, hook log)
  runs/<id>/
    SUMMARY.md  plan.md  plan.lock.json
    findings/F-0001.md ...      one file per finding
    apply/ledger.md             written by fix
    raw/                        gitignored engine output
.quarantine/                    files moved (not deleted) when a route or entry point looked unsafe to delete; listed in .quarantine/README.md
```

Commits go to a work branch named `chore/ts-cleanup...` (prefix configurable) and carry trailers:

```
Rule: reach-04
Finding: F-0007
Run: 2026-10-19T1432Z-a1b2
Wave: 3
Fast-check: <result of the fast typecheck>
```

The plugin never pushes. Nothing outside `.ts-optimize/` changes without an approved finding, and `package.json`, lockfiles and CI files change only through a finding you ticked.

## Safety model

- Approval first: no source file is edited until you tick findings in `plan.md` and the set is locked.
- Gate after every wave: the project's own typecheck, tests, build and declaration emit, compared with a baseline taken before any edit. A run starts only from a clean tree and a green baseline.
- Bisect and revert: when a gate goes red, `ts-opt bisect` names the first red commit and `ts-opt revert` undoes it; the gate is run again.
- Command guard (hook): stops `knip --fix` without `--fix-type` (denied during a run, otherwise you are asked) and `npx` / `dlx` / `bunx tsc` when the project has no local TypeScript.
- Commit guard (hook): while a run is applying, a raw `git commit` is denied; `ts-opt commit` is the only path, and it checks scope, protected paths and trailers.
- Fast typecheck (hook): after an edit batch inside a run, reports only new type errors, using a fast compiler when one exists.
- Subagent guard (hook): `ts-triager` and `ts-architect` cannot write, delete, install or read secret files.
- A SessionStart hook restores the run position after `/clear`, compaction or a crash.

All hooks are silent outside their gate and fail open on internal errors.

## Privacy

No telemetry. The plugin makes no network calls, with one exception: if you consent, `ts-opt toolbox install` runs `npm` to install pinned Knip, TypeScript 6, type-coverage, ast-grep and a native TypeScript into `$TS_OPT_HOME`. It never installs into your project. The `ts-opt` CLI itself has zero npm dependencies.

## Requirements

- Node >= 18.17 and git.
- Audited projects use TypeScript >= 4.9.
- Windows is supported through `bin/ts-opt.cmd`. Hooks need `bash`.

## Support matrix

Filled only from `tests/LEDGER.md`. A cell says what a passing ledger row exercised on that fixture kind; "audit only" means no fix row passed, and "no evidence" means no row covers it. Every fixture kind is audited by `ts-opt scan`; the rows below say how far each one was verified.

| Project kind (fixture) | audit | fix | tsgo |
|---|---|---|---|
| npm, plain TS (F01) | yes (1.1-1.8) | yes (3.1, 3.2, 3.9) | no evidence |
| pnpm monorepo (F02) | yes (0.4, 2.3) | audit only (hook rows on a live run: 4.4) | fast check (4.4) |
| yarn PnP (F03) | detection only (0.5) | audit only | no evidence |
| bun (F04) | audit only | audit only | no evidence |
| Next.js (F05) | yes (2.1) | audit only | no evidence |
| Cloudflare Workers (F06) | yes (2.2) | commit guards (3.13, 5.4) | no evidence |
| TS7-native (F07) | yes (1.6) | audit only | yes (4.3) |
| legacy TS5 config (F08) | audit only | audit only | yes (4.1, 4.2) |
| polyglot (F09) | yes (0.6) | audit only | no evidence |
| no TS (F10) | nothing to do, exit 3 (0.2) | n/a | n/a |
| library with declaration emit (F11) | audit only | export pre-check (3.10) | no evidence |
| mixed JS/TS (F12) | audit only | audit only | yes (4.5, 4.9) |
| no tests (F13) | audit only | restricted waves (3.6) | no evidence |
| NestJS (F15) | yes (2.8) | audit only | no evidence |
| Vue (F17) | yes (1.13) | audit only | no evidence |
| Deno (F18) | degraded, `deno check` only (1.14) | audit only | no evidence |

Known gaps are listed in [CHANGELOG.md](CHANGELOG.md). Problems and exit codes: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Uninstall and cleanup

```
rm -rf .ts-optimize .quarantine        # in each project you audited
/plugin uninstall ts-optimize          # or: claude plugin uninstall ts-optimize
rm -rf "$TS_OPT_HOME"                  # the toolbox and detection cache
```

Commits and branches created by a run stay in git history; delete the `chore/ts-cleanup...` branch yourself if you do not want it.

## License

MIT. See [LICENSE](LICENSE).
