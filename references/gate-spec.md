# Gate specification (canonical)

This is the only written definition of the gate. Implementation: `lib/gate/`. No skill, agent, doc or script restates a gate command line. To run the gate use `ts-opt gate [--wave <id>] [--legs ...]`; for the inner loop use `ts-opt check`. If a gate result looks wrong, read this file; do not improvise a command.

## 1. What the gate is

The gate is the verification barrier run after every wave and before the wave is considered done. A result is valid only for the worktree fingerprint it was computed at (section 9). The authoritative compiler (the `tsc` the project's own scripts would run) decides every gate. A faster compiler may only block early or advise (see `authority` rule in section 10).

## 2. Legs

| Leg | Meaning |
|---|---|
| `typecheck` | One per entry of the package's typecheck set (solution config, or configs named by the package's typecheck script, or `tsconfig.json`). Script-defined checkers (`vue-tsc`, `svelte-check`, `astro check`, `ngc`, `next build`, `nuxi typecheck`, `deno check`) are the authority for the leg: `variant: script`, command taken verbatim from the script and run through the package manager. |
| `build-refs` | `tsc -b` for solution/composite configs. |
| `declaration-emit` | Only when the package has a `declaration_signal`. See section 4. |
| `lint` | Only in tsgo adoption tiers and when the project has a `lint` script. |
| `test` | The project's `test` script. Root script when the root `package.json` defines it; otherwise one leg per package defining it, in workspace-topological order. |
| `build` | Same rule as `test` with the `build` script. |
| post-flight extras | `cycles` (no new fingerprints), `coverage` (the count of untyped identifiers for the same metric id does not rise above the baseline; the percentage is reported, not gated), `knip` (zero remaining in the run's scope). |

`declaration_signal` is true when any of `declaration`, `composite`, `isolatedDeclarations`, `emitDeclarationOnly` is true in the resolved tsconfig, or the package's `package.json` has `types`/`typings`/`exports[*].types`, or `main`/`module`/`exports` point into `dist/**`.

## 3. Wave to required legs

| Wave | Required legs |
|---|---|
| R0, R, 1, 2 | typecheck, test, build (wave 2 also: cycles no-new) |
| 3 | typecheck, test, build, declaration-emit (if signal) |
| B | typecheck, test, build |
| 4 | typecheck, test, build, declaration-emit (if signal), coverage (untyped count does not rise) |
| 5 | typecheck, test, build, install-frozen sanity (lockfile-frozen install in a no-op check, via the detected package manager) |
| P (post-flight) | all of the above plus knip zero plus diff accounting |
| T1-T4 | the six tsgo tiers: `typecheck`, `build-refs`, `declaration-emit`, `lint`, `test`, `build` (a leg that does not apply is recorded as such with the reason) |

## 4. The declaration-emit leg

`tsc --noEmit` checks the implementation graph, never the declaration graph. The leg emits declarations somewhere disposable and asserts the source tree is untouched.

- Single project: `<tsc> -p <cfg> --declaration --emitDeclarationOnly --outDir <os-tmp> --tsBuildInfoFile <os-tmp>/x`, adding `--noEmit false` only if the config sets `noEmit: true`. Never write into the source tree (the source skill's `--noEmit false` with no `outDir` did exactly that).
- Composite/solution: `<tsc> -b --emitDeclarationOnly`, then `<tsc> -b --clean`, then assert `git status --porcelain` is unchanged. `-b` rejects `--outDir` (TS5065), which is why the clean step is mandatory (stale `.tsbuildinfo` also masks fresh failures).
- Probe codes: `TS5053` (`--emitDeclarationOnly` with `--noEmit`), `TS5065` (`--outDir` with `-b`), `TS5094` (`--noEmit` with `-b`). Each selects the alternative command rather than failing the leg.
- Do not compare `.d.ts` output byte-for-byte between compilers; compare diagnostics only.

## 5. The `-b --noEmit` probe (probed, not versioned)

The first composite typecheck at baseline runs `<tsc> -b --noEmit`. A `TS5094` result marks the leg `variant: emit-and-clean` (`tsc -b --emitDeclarationOnly` then `tsc -b --clean`) and is recorded in `run.json.gate.legs[].variant`. Never branch on "TS version is N". The source skill contradicted itself on this ("never" in one file, "TS 5.8+ supported" in another); the probe settles it per project. Projects on TS 4.9-5.7 normally land on `emit-and-clean`.

## 6. Environment

- `CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0`; `NODE_OPTIONS` sanitised (worker-incompatible flags removed, `--max-old-space-size` kept); `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- Non-watch behaviour comes from the project's own script; the script is never edited.
- Timeout per leg from `config.json` (defaults 600 / 1800 / 1800 s), process-group kill on timeout, output tail saved under `apply/gate/`.
- Binaries run directly from `node_modules/.bin`, else the package-manager exec prefix. Never bare `npx <tool>` for a tool that might be absent: `npx tsc` fetches the obsolete `tsc@2.0.4`. Scripts run through `pnpm run | yarn run | bun run | npm run` (`bun test` is not `bun run test`; `npm build` is not `npm run build`).

## 7. Missing legs

- No `typecheck` possible: `fix` refuses.
- No `test` script, or tests collected = 0 (parsed from runner output where possible, else a glob for `*.{test,spec}.*` / `__tests__` finds nothing): only waves `B` and `4` are allowed (zero-runtime type edits). The plan says so up front. A green run that collected nothing proves nothing.
- No `build` script: leg recorded `not-applicable` (a library compiled only by `tsc` is covered by `typecheck`).
- Do not substitute a narrower script for the typecheck leg: scripts often scope with `-p` and hide regressions outside that scope.

## 8. Red baseline and flakiness

- Any required leg red before the first edit: `ts-opt run begin` exits 5 naming the leg. Override with `--allow-red-baseline typecheck,lint` only after the user has said so; it records `gate.red_baseline` with the diagnostic multiset and `accepted_risk`.
- With an accepted red baseline a typecheck leg passes iff it produces no fingerprint that was not in the baseline; a test leg passes iff no new failing test names (when parsable).
- A red `test` or `build` whose failures cannot be fingerprinted is `untrusted`: waves that depend on it are blocked.
- A failed `test`/`build` leg is re-run once. Pass-on-retry: leg passes with `flaky: true` in the log. Two failures: failed.

## 9. Fingerprints

- Diagnostic fingerprint = `sha1(relative_file | "TS" + code | normalised_message)`. Normalised message: paths repo-relative, line/column numbers removed, whitespace runs collapsed, quoted identifiers and types kept. Compared as a multiset: a "new error" is any fingerprint whose count exceeds its baseline count.
- Worktree fingerprint = `sha1(HEAD sha + "\0" + sorted "<path>\0<sha1(content)>" for every path in git status --porcelain=v1 -z, excluding .ts-optimize/)`. `ts-opt commit` recomputes it and refuses a stale check or gate result.
- Finding fingerprint: see the artifact spec (doc 04 section 3.4).

## 10. Authority rule (fast vs authoritative compiler)

The fast compiler (native `tsc`/`tsgo`) may block early (a fast failure the authority reproduces is real) or advise. Divergences are logged to `apply/log.jsonl` as `{"ev":"divergence","fast":"pass","auth":"fail"}`. Three fast-fail/authority-pass divergences in one run disable `fast-check` for the run and `SUMMARY.md` records `tsgo-divergence`.

## 11. Failure handling

Gate red: `ts-opt bisect --wave <id>` over that wave's finding commits (uses `gate --quiet`); the culprit is reverted with `ts-opt revert`, recorded with the failing output reference, the finding becomes `reverted`, the wave gate re-runs. A red gate is never "fixed forward" by loosening `tsconfig`, skipping a test, or adding `@ts-expect-error`. Triage of the failing leg: `skills/fix/references/gate-triage.md`.
