---
schema: ts-optimize/rule@1
id: reach-06
version: 1
name: Unused local and dangling import residue
domain: reachability
batch: 7
wave: "B"
severity: warn
fix_risk: low
fix_mode: auto
grain: file
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [L, T]
requires: {}
adapter: lint+tsc:unused-locals
primary_over: []
sources: ['CLS Batch 7', 'WAV §8 (inter-wave bridge)', 'FPT §8.1 (underscore contract)', 'lint-engines (targeted unused-only autofix)']
---
## What
Bindings that exist and are never read, mostly **created** by wave 3 (a symbol exported "just in case" becomes an unused local the moment `export` is removed; `TS6133` under `noUnusedLocals`). The finding is created at wave `B` start, not at audit time: `run wave begin B` runs the lint engine in report mode plus `tsc` `TS6133`, writes one finding with `touches` = files changed since the run base that have residue, and it is covered by the plan lock as part of the approved wave-3 set. Sub-kinds: un-export residue, dangling specifier (`TS2305`: fix the consumer), pre-existing rot (reported separately from cleanup churn), intentional `_`.

## Triage
Deterministic: the engine output is the evidence. Keep (false positive, configure the engine, never disable the rule) when:
- The binding is `_`-prefixed: `(_req, res) =>`, `catch (_err)`, `function f(_a, b)`, `const [, second]`, `{ unused: _u, ...rest }`. The underscore is the contract (`argsIgnorePattern`, `varsIgnorePattern`, `caughtErrorsIgnorePattern`, `destructuredArrayIgnorePattern: '^_'`; `ignoreRestSiblings`).
- Constructor parameter properties used through DI decorator metadata (Nest, Inversify).
- Imports for side effects (`import './polyfill'`) or type augmentation.
Never resolve a lint false positive by disabling `noUnusedVariables` repository-wide: that hides exactly the residue this wave exists to clear.

## Proposed change
Run the project's lint engine in its targeted unused-only autofix mode (Biome `noUnusedVariables`/`noUnusedImports` safe fixes, ESLint `no-unused-vars`/`unused-imports` with `--fix`, Oxlint `--fix`), scoped to the files in `{{touches}}`, then the project's formatter, **in one commit**. For a dangling specifier at {{consumers}} (`TS2305: Module has no exported member`), edit the consumer: repoint it or delete the import. Rename intentionally unused parameters to `_name` instead of adding disable comments.

## Verification
Legs: typecheck (`TS6133` count for the touched files is zero), test, build. Extra proof: the diff contains no removed `export` (autofix must never delete an exported symbol; that decision belongs to wave 3), no `--unsafe` / `--fix-dangerously` fixes unless a per-finding approval exists, and no rule disabled. Lint denylist rules (doc 06 §13) are never autofixed.

## Pitfalls
- Run the bridge after wave 3 and before wave 4; earlier it finds nothing, later it pollutes the type-pruning diff and makes the wave unbisectable.
- A repo-wide format pass buries the semantic diff; scope to changed files.
- Removing a declaration whose initializer has side effects (`const r = register()`) changes behaviour; keep the call, drop the binding.
- `noUnusedParameters` may demand `_`-renames in signatures fixed by a framework contract; do that, do not delete the parameter.
