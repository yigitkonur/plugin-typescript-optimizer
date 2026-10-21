# ts-optimize

a claude code plugin that goes through your typescript codebase looking for dead code, unused deps, ai-written slop, weak types, tangled imports, and how ready you are for the native compiler (typescript 7 / tsgo). it writes everything it finds into `.ts-optimize/` as plain markdown you can actually review, waits for you to sign off, and only then fixes the approved stuff in waves: one commit per finding, with a verification gate after every wave. in a repo with no typescript it stays completely quiet.

[![ci](https://github.com/yigitkonur/plugin-typescript-optimizer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yigitkonur/plugin-typescript-optimizer/actions/workflows/ci.yml) tested on linux, macos and windows with node 18.17, 22 and 26.

## install

one command, from any shell:

```
claude plugin install ts-optimize --marketplace yigitkonur/plugin-typescript-optimizer
```

that adds the marketplace (`claude-ts-optimize-plugin`) to your user settings and installs the plugin in one go. if you'd rather do it in two steps:

```
claude plugin marketplace add yigitkonur/plugin-typescript-optimizer
claude plugin install ts-optimize@claude-ts-optimize-plugin
```

or from inside a claude code session:

```
/plugin marketplace add yigitkonur/plugin-typescript-optimizer
/plugin install ts-optimize@claude-ts-optimize-plugin
```

want it for one project only? add `--scope project` (shared through `.claude/settings.json`) or `--scope local` (just you, just this repo) to the install command. restart claude code afterwards so the skills and hooks load.

updating later:

```
claude plugin marketplace update claude-ts-optimize-plugin
claude plugin update ts-optimize@claude-ts-optimize-plugin
```

## commands

```
/ts-optimize:audit [path] [--mode sweep|standard|deep] [--domains <csv>] [--diff[=base]] [--triage auto|inline|agents] [--chunk-size <n>]
```
reads your code and touches no source. writes `.ts-optimize/runs/<id>/` (findings, `plan.md`, `SUMMARY.md`). default mode is `standard`; `sweep` is the cheap quick pass; `deep` adds structural proposals.

```
/ts-optimize:fix [run-id|latest] [--waves <csv>] [--approve-low]
```
applies the findings you approved in `plan.md`, wave by wave. it refuses a dirty working tree or a red baseline. got interrupted? just run it again and it picks up where it stopped.

```
/ts-optimize:tsgo [check|adopt|status]
```
`check` (the default) times your project's compiler against a native one and lists the blockers with `file:line`; it only writes the gitignored `.ts-optimize/fit/`. `status` prints the compilers and the last result from there. neither one edits source. `adopt` migrates step by step on a branch, one commit per finding.

```
/ts-optimize:doctor
```
read-only health check: detected packages, package manager, compilers, engines (knip, ast-grep, type-coverage, lint), gate commands, and the one action that fixes each thing that's degraded.

two knowledge skills kick in on their own when they're relevant. they're guidance only and grant no edit permission, so any edit they lead to still goes through your normal permission prompt, or through `/ts-optimize:fix` and `/ts-optimize:tsgo`:

- `declaration-emit`: TS4023, TS4058, TS4060, TS4081, TS4082, TS2742, TS2883 and "cannot be named" errors; also checked before an export is removed from a package that publishes `.d.ts` files.
- `ts7-compat`: what breaks under typescript 7 (no javascript compiler api before 7.1, removed options, typescript-eslint, ts-morph, ts-node, type-coverage) and the `tsc` / `tsc6` alias scheme.

the audit also uses two read-only subagents: `ts-triager` checks candidate findings by actually reading the code, and `ts-architect` writes the structural proposals in deep mode.

## how a run flows

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

waves, in order: `R0` mechanical lint autofix, `R` root cause (deep mode only), `1` dead files, `2` barrels and import cycles, `3` encapsulation, `B` unused locals and dangling imports, `4` types, `5` dependencies and lockfile, `P` post-flight. `/ts-optimize:tsgo adopt` uses `T1` to `T4` (config, tooling bridge, engine switch, ci and ide).

## what lands in your repo

```
.ts-optimize/
  README.md, .gitignore         generated
  config.json                   optional, yours
  suppressions.json             findings you dismissed (committed)
  baseline.json                 accepted metric floors (committed)
  state/  .cache/  fit/         gitignored (open-run pointer, lock, hook log; tsgo fit results)
  runs/<id>/
    SUMMARY.md  plan.md  plan.lock.json
    findings/F-0001.md ...      one file per finding
    apply/ledger.md             written by fix
    raw/  apply/gate/           gitignored (engine output; gate logs)
.quarantine/                    files moved (not deleted) when a route or entry point looked unsafe to delete; listed in .quarantine/README.md
```

if a run starts on your default branch (or a detached head), it creates a work branch `chore/ts-cleanup` (prefix is configurable, with `-2`, `-3` on a name clash). start it on any other branch and the commits go to that branch. every commit carries trailers:

```
Rule: reach-04
Finding: F-0007
Run: 2026-10-19T1432Z-a1b2
Wave: 3
Fast-check: <result of the fast typecheck>
```

the plugin never pushes. nothing outside `.ts-optimize/` changes without an approved finding, and `package.json`, lockfiles and ci files only change through a finding you ticked.

## safety model

- approval first: no source file gets edited until you tick findings in `plan.md` and the set is locked.
- gate after every wave: your project's own typecheck, tests, build and declaration emit, compared against a baseline taken before any edit. a run only starts from a clean tree and a green baseline.
- bisect and revert: when a gate goes red, `ts-opt bisect --wave <W>` names the first red commit, `ts-opt revert` undoes it, and the gate runs again.
- command guard (hook): stops `knip --fix` without `--fix-type` (denied during a run, otherwise you get asked), and `npx` / `pnpx` / `bunx` / `dlx tsc` when the project has no local typescript.
- commit guard (hook): while a run is ready, locked, applying or verifying, a raw `git commit` is denied. `ts-opt commit` is the only way in, and it checks scope, protected paths and trailers.
- fast typecheck (hook): after an edit batch inside a run, it reports only the new type errors, using a fast compiler when there is one.
- subagent guard (hook): `ts-triager` and `ts-architect` can't write, delete, install or read secret files, and each one can only run its own `ts-opt` commands.
- a sessionstart hook drops a pointer to the open run after `/clear`, compaction or a crash, so `/ts-optimize:fix` can resume it.

every hook stays quiet outside its gate and fails open on internal errors.

## privacy and trust

no telemetry, and `ts-opt` itself never opens a network connection (there's no http client in `lib/`, and zero npm dependencies). the tools it starts can hit the network, though:

- `ts-opt toolbox install` (only after you say yes) runs `npm ci` to install pinned knip, typescript 6, type-coverage, ast-grep and a native typescript into `$TS_OPT_HOME`. it never installs into your project.
- wave 5 and `/ts-optimize:tsgo adopt` run your package manager's `install` (`ts-opt pm install`), and the gate's install leg does a frozen or dry-run install.
- the gate runs your own `typecheck`, `test` and `build` scripts, plus the package manager's `exec` (for example `npm exec -- tsc`), which can download a package that isn't installed yet.

auditing runs the project's own tools too: knip loads the project's config files, and the gate runs its scripts. so only audit or fix a repo whose `npm test` you'd be fine running.

## requirements

- node >= 18.17 and git.
- audited projects need typescript >= 4.9.
- windows: ci runs the unit tests, an entry-point smoke test (`bin\ts-opt.cmd --version` and the hook handlers started directly) and a full audit-and-fix lifecycle on windows. the hooks themselves need `bash` and haven't been run inside claude code on windows yet.

## support matrix

filled only from `tests/LEDGER.md`. each cell says what a passing ledger row actually exercised on that kind of project. in the audit column, "scan only" means `ts-opt scan` runs on it but no ledger row checks its findings. in the fix and tsgo columns, "audit only" means no fix row passed, and "no evidence" means no row covers it.

| project kind (fixture) | audit | fix | tsgo |
|---|---|---|---|
| npm, plain ts (`F01`) | yes (1.1-1.8) | yes (3.1, 3.2, 3.9) | no evidence |
| pnpm monorepo (`F02`) | yes (0.4, 2.3) | audit only (hook rows on a live run: 4.4) | fast check (4.4) |
| yarn pnp (`F03`) | detection only (0.5) | wave 5 dependency removal through the cli (Q16) | no evidence |
| bun (`F04`) | scan only; a public bun monorepo was audited live (6.8) | wave 5 dependency removal through the cli (Q16) | no evidence |
| next.js (`F05`) | yes (2.1) | audit only | no evidence |
| cloudflare workers (`F06`) | yes (2.2) | commit guards (3.13, 5.4) | no evidence |
| ts7-native (`F07`) | yes (1.6) | audit only | yes (4.3) |
| legacy ts5 config (`F08`) | scan only | audit only | yes (4.1, 4.2, Q15) |
| polyglot (`F09`) | yes (0.6) | audit only | no evidence |
| no ts (`F10`) | nothing to do, exit 3 (0.2) | n/a | n/a |
| library with declaration emit (`F11`) | scan only | export pre-check (3.10) | no evidence |
| mixed js/ts (`F12`) | scan only | audit only | yes (4.5, 4.9) |
| no tests (`F13`) | scan only | restricted waves (3.6) | no evidence |
| nestjs (`F15`) | yes (2.8) | audit only | no evidence |
| vue (`F17`) | yes (1.13) | audit only | no evidence |
| deno (`F18`) | degraded, `deno check` only (1.14) | audit only | no evidence |

known gaps live in [CHANGELOG.md](CHANGELOG.md). problems and exit codes: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## uninstall and cleanup

```
claude plugin uninstall ts-optimize@claude-ts-optimize-plugin    # also deletes the plugin's data dir (toolbox, detection cache) unless you pass --keep-data
claude plugin marketplace remove claude-ts-optimize-plugin
rm -rf .ts-optimize .quarantine                                  # in each project you audited
```

if you pointed `TS_OPT_HOME` somewhere yourself, delete that folder too. commits and branches a run created stay in your git history; delete the `chore/ts-cleanup` branch yourself if you don't want it.

## development

```
claude plugin validate . --strict
node tests/harness/ci.mjs prepare && node tests/harness/ci.mjs core     # what ci runs on every os and node version
node --test tests/*.test.mjs tests/unit/*.test.mjs                      # everything: node 20.19+, with pnpm, yarn and bun on PATH
claude plugin eval . --runs 3 --threshold 1.0 --scaffold --allow-tools Bash
```

`tests/LEDGER.md` lists every acceptance row with the command that was run and what it printed. `docs/design/` is the original plan, and `docs/design/DEVIATIONS.md` lists where the build differs from it. `AGENTS.md` holds the maintenance rules.

## license

mit. see [LICENSE](LICENSE).
