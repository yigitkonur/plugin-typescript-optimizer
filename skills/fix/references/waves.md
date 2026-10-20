# Waves

Causal order: `R0` mechanical lint autofix → `R` root cause (deep only) → `1` unreferenced files → `2` barrels and cycles → `3` encapsulation (test-only leaks, internal exports) → `B` lint bridge → `4` types → `5` dependencies → `P` post-flight.

| Wave | What changes | Gate legs | Notes |
|---|---|---|---|
| R0 | slop-01 / slop-03 mechanical fixes | typecheck, test, build | `ts-opt lint-fix F-…` runs the project's lint engine's safe fixes on the finding's files; engines leave unsafe fixes alone, so finish by hand inside `touches` |
| R | deep mode only: root-cause refactors (`struct-03` to `08`, `struct-10`, `struct-11`, `reach-11`, `type-03`, `type-05`, `slop-02`, `04`, `05`, `plat-01`, `plat-02`) | typecheck, test, build | at most 5 files per finding; `ts-opt commit` refuses a changed test assertion or new control flow (semantic invariance), so a refactor never edits a test to pass |
| 1 | delete unreferenced files | typecheck, test, build | `ts-opt remove F-…` deletes; `ts-opt quarantine F-…` parks a routed-looking file in `.quarantine/` (a green gate proves static death, never runtime death) |
| 2 | dead barrel re-exports, import cycles | typecheck, test, build, cycles | cycles: no new cycle fingerprints |
| 3 | un-export internal-only symbols | typecheck, declaration-emit (with a declaration signal), test, build | export pruning is pre-checked against declaration emit at `commit`; a stripped export a signature needs is refused and recorded as "keep export" |
| B | unused locals left by wave 3 | typecheck, test, build | created by `run wave begin B` (tsc `--noUnusedLocals` over files this run changed); skipped with a reason when nothing is left; covered by the wave-3 approval |
| 4 | unused types, type safety | typecheck, declaration-emit, test, build, coverage | coverage fails only if untyped identifiers increase |
| 5 | unused dependencies | typecheck, test, build, install-frozen | after a revert, `ts-opt pm install` |
| P | post-flight | everything above that applies, plus knip (nothing left unaccounted) and diff-accounting | every commit between base and HEAD must carry the run's trailers |

After waves `R0` to `3`, `ts-opt rescan --wave <W>` re-runs Knip: pending findings whose evidence vanished go `stale`; new reports caused by the wave become cascade findings (`origin: cascade:F-…`) that need approval (`ts-opt plan amend --cascade`) and run in a repeat pass after the regular waves.

A wave `end` needs a green gate and no approved finding left that is neither applied, reverted nor skipped.
