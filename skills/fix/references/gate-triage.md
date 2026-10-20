# Gate failure triage

A red gate is evidence that static analysis was wrong. Restore and re-triage; never bend the gate.

| Symptom | Wave | Cause | Action |
|---|---|---|---|
| `TS2307` cannot find module | 1 | A deleted file still had a consumer (dynamic import, glob, alias, generated code). | `ts-opt revert` the culprit. Record the consumer as `false-positive` evidence and re-run the audit. |
| `TS6133` / `TS6192` / `TS6196` unused, in `check` or the typecheck leg | 3 | The project sets `noUnusedLocals` and the un-export left an unused local or import behind. `check` and `commit` refuse it. | Delete the residue in the same edit, inside the finding's `touches`, and run `ts-opt check` again. Without the flag tsc says nothing, and wave `B` (the bridge) removes the residue later in one lint autofix. |
| `TS2305` / `TS2724` no exported member | 2 or 3 | An export that has a consumer was removed. | Restore the export, or fix the consumer in the same wave and same commit. |
| `TS4023` `TS4058` `TS4060` `TS4081` `TS4082` `TS2742` `TS2883` | 3 or 4 | Declaration emit needs a name that was un-exported or no longer inferable. | The `declaration-emit` skill. Annotate the exported signature or keep the `export`. Never suppress. |
| A test fails at import | 3 | The symbol was only used by tests (test-only leak), not dead. | Revert, then `ts-opt findings skip F-… --reason "test-only consumer <file:line>"`; keep the export or move the symbol next to its test. |
| A test fails on an assertion | any | The static view of behaviour was wrong. | Revert the wave culprit (`bisect` finds it). Never edit the assertion. |
| Build fails, typecheck and tests pass | 1, 2, 5 | A bundler-only edge: asset import, `import.meta.glob`, a dynamic `import()`, a config-referenced path. | Restore it (`ts-opt revert F-… --reason "<consumer file:line>"`) and tell the user to add the entry to their Knip config. |
| New diagnostics elsewhere | 4 | A type change narrowed a type used by another package. | Fix the consumer inside the finding's `touches` or `ts-opt proposal add --origin fixer`. If it needs more than 5 files, revert and split. |
| Gate leg skipped or timed out | any | Flaky or slow leg. | One plain rerun of the whole `ts-opt gate --wave <W>` (a `--legs` run is only a probe and never records the wave gate). Still red: treat as red. |

When `bisect` cannot name a single culprit (two findings interact), revert the later of the pair and re-run the gate; report both in the final message.
