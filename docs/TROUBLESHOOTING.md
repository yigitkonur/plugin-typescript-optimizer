# Troubleshooting

Every `ts-opt` command ends with an exit code. The skills read it and tell you what to do. You can also run `ts-opt` yourself: it is on `PATH` while the plugin is enabled, or use `node <plugin>/bin/ts-opt`.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | ok | Nothing. |
| 2 | usage error | Check the flags: `ts-opt <command> --help` lists a command's flags without running it, and a rejected call prints its usage line and writes nothing. |
| 3 | nothing to do | No TypeScript under the root, or no matching run. Check `ts-opt detect --brief`; run `/ts-optimize:audit` first if there is no run. |
| 4 | capability missing | A required tool is unavailable (for example no native compiler for `tsgo check`). The output names the one action that fixes it, such as `ts-opt toolbox install --yes`. Some read-only commands still print their result. |
| 5 | precondition failed | Dirty working tree, red baseline, stale findings, lock held by another process, not a git repo, or another run is open. Fix the cause listed; do not work around it. |
| 6 | gate or check failed | A verification leg is red, or a repo commit hook refused the commit. Read the output tail; see "A gate went red". |
| 7 | guard refused | `ts-opt commit` refused the change. See "Commit refusals". Do not retry the same call. |
| 8 | artifact invalid | A file in `.ts-optimize/` fails its schema, or has a newer schema version than this plugin understands. Run `ts-opt validate`; the message names the file and field. Restore the file from git or delete the run directory. |
| 70 | internal error | A bug. Re-run with `TS_OPT_DEBUG=1` to get a stack trace and report it. Hooks never block on internal errors. |

## Reading `ts-opt doctor`

`/ts-optimize:doctor` (or `ts-opt doctor`) prints, in order: detection summary (root, git state, package manager, packages), compilers (the project's own compiler is the authority; a native one may be listed as the fast compiler), engines (version, source, and `works` or the reason it does not), gate legs (typecheck, test, build, declaration emit, and which are unavailable), toolbox state, config validation and registered hooks.

Each degradation line ends with `fix:` and one action. Examples: a missing engine (`ts-opt toolbox install --yes`); no test script (only waves `B` and `4` can be scheduled); no lint engine (lint-based autofixes become assisted edits); Deno projects (Node-based engines skipped, `deno check` used). Doctor exits 0 when degraded, including outside a git repo.

## Resume or abort a run

- Resume: run `/ts-optimize:fix` again. It reads `ts-opt run status` and continues at the first unfinished wave; committed findings are not redone. After `/clear`, compaction or a crash, the SessionStart hook (H1) prints a pointer to the open run. An interrupted audit is resumed by running `/ts-optimize:audit` again.
- Abort: `ts-opt run abort`. When the run created its work branch and nothing was committed on it, it switches back to the default branch and deletes the branch; otherwise it stays where it is. It clears the open-run pointer and keeps `.ts-optimize/` valid for inspection.
- An open run blocks a new `ts-opt scan` (exit 5). Finish or abort it, or pass `--abandon-open` if you are sure it is dead.

## Red baseline

`ts-opt run begin` runs the gate before any edit. If typecheck, tests or build already fail, it exits 5: after a cleanup you could not tell what the cleanup broke. Fix the failing leg first. `--allow-red-baseline <leg>` records the existing failures as accepted and fails the gate only on new ones. It lowers the safety net, so it needs your explicit OK; the skills never add it on their own.

## Commit refusals (`ts-opt commit`, exit 7)

Nothing is staged or committed when it refuses. The message names the rule and the paths.

| Rule | Meaning | Response |
|---|---|---|
| `scope` | A changed file is outside the finding's `touches` | Revert that edit, or add a finding for it (`ts-opt proposal add`). Do not widen scope by hand. |
| `protected-path` | A protected file was deleted or renamed (for example `worker-configuration.d.ts`) | Restore it. |
| `edit-pattern` | The edit removes `ctx.waitUntil(`, adds `process.env` in a Worker that does not populate it, drops a worker handler, or an exported declaration in a lint-bridge wave | The change alters behaviour; restore it and skip the finding. |
| `declaration-emit` | Declaration emit breaks after the edit (a stripped `export` still needed by `.d.ts` output) | Keep the export. The `declaration-emit` skill explains the cases; the finding becomes "keep export". |
| `semantic-invariance` | A refactor changed a test assertion, added control flow, or touched more than 5 files | Restore the test; split the refactor into sequential findings. |
| `suppression` | The edit adds `@ts-ignore`, `eslint-disable` and similar | Remove them and fix the cause. |
| `risk-evidence` | A high-risk finding lacks all three triage answers or evidence | Re-triage the finding. |
| `precondition` | No applying run, no wave in progress, wrong granularity, earlier wave not green, or the fast check is missing or reports new errors | Follow the message (`ts-opt run wave begin <W>`, `ts-opt check`, and so on). |

A failing repo `pre-commit` hook is a different case: exit 6 with the hook output. Fix what the hook reports. `--no-verify` is used only if `commit.no_verify` is set in your config.

## A gate went red

1. `ts-opt gate --wave <W>` exits 6 and shows which leg failed.
2. `ts-opt bisect --wave <W>` finds the first red commit and names the finding.
3. `ts-opt revert F-xxxx` makes a `git revert` commit and marks the finding `reverted`.
4. `ts-opt gate --wave <W>` runs again. Green: the wave continues.

Each wave is tagged `ts-optimize/<run>/wave-<W>-start`. For a whole bad wave that is not pushed, you can `git reset --hard` to that tag yourself; the plugin will not. After reverting a wave 5 finding, reinstall with your package manager. A red gate is never fixed by editing tsconfig, tests or suppressions.

## TypeScript 7 and typescript-eslint errors

Errors such as "typescript-eslint does not support TypeScript 7.0", or ts-morph, ts-node or type-coverage failing, mean a tool needs the JavaScript compiler API, which `typescript@7` does not provide before 7.1. Run `/ts-optimize:tsgo check`: it lists each affected tool with `file:line` and the fix, and changes nothing. The `ts7-compat` skill describes the `tsc` / `tsc6` alias scheme.

## Removing `.ts-optimize/`

With no run open: `rm -rf .ts-optimize .quarantine`. If a run is open, `ts-opt run abort` first. `suppressions.json` and `baseline.json` live in `.ts-optimize/`, so deleting it forgets dismissed findings. `.quarantine/` holds moved source files; read `.quarantine/README.md` before deleting.

## Environment variables

- `TS_OPT_HOME`: where the toolbox, consent record and detection cache live. Resolution order: `TS_OPT_HOME`; then `CLAUDE_PLUGIN_DATA`, but only when it names this plugin's own data dir (`ts-optimize-…`; another plugin's value in the environment is ignored); then `~/.claude/plugins/data/ts-optimize-<marketplace>/`, derived from the install path; then an XDG or temp cache. `claude plugin uninstall` deletes the data dir unless you pass `--keep-data`; a `TS_OPT_HOME` you set yourself you delete yourself.
- `TS_OPTIMIZE_HOOKS=off`, or `hooks.enabled: false` / `hooks.fast_check: false` in `.ts-optimize/config.json`: turn off the fast-typecheck hook only. The command, commit and subagent guards stay on.
- `TS_OPT_DEBUG=1`: print a stack trace for internal errors.
