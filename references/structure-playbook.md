# Structure playbook

Procedures for struct-01 to struct-09 and reach-02. Tenets and the reasoning behind them: `pocock-tenets.md`. Every step is a lightweight refactor: relocation and inlining only, no change to business logic, public signatures, async timing or test expectations.

## 1. Rules of engagement

- Plan first: diagnose with the engine and graph, bound the unit to at most 5 tightly coupled files, map incoming/outgoing imports and consumer count, write the steps, then execute. A larger plan is split into sequential findings.
- Abort and revert (`ts-opt revert`) when: tests fail for reasons other than import-path edits; the plan exceeds 5 files; a symbol crosses a package boundary in a library workspace (check `package.json#exports` first).
- Zero assertion edits. A changed expectation means redesign.
- Diff shape: a structural diff should be moved and deleted lines. New `if|for|while|catch`, `??`, `&&` in added lines must be justified in the finding (`allows_new_control_flow`) or reverted; `ts-opt commit` lists them.
- Never mix a bug fix into a structural commit. Verification is the gate (`gate-spec.md`) plus cycle non-regression: compare against the pre-refactor cycle fingerprints, not against zero.
- Use `git mv` so history follows; confirm `git status` shows renames.

## 2. Barrels (struct-01, reach-02)

- Detect: `export * from`; modules importing a sibling through their own directory barrel (`../index`, `@/components` from inside `components/`).
- Rules:
  1. A module never reaches a sibling through its own directory barrel; use the direct relative path.
  2. Dismantle kitchen-sink barrels (`src/index.ts`, `utils/index.ts`) that aggregate unrelated modules.
  3. Convert `export *` to explicit named exports where a public entry is genuinely needed (`export { Button, type ButtonProps } from './Button'`).
  4. Heavy subsystems (charts, editors, tables) are imported by direct path in consumers.
- A barrel is decided by content (the majority of statements are re-exports), not by the filename `index.ts`.
- Do not touch a barrel that is a package public entry (`package.json#exports`) beyond removing re-exports with no consumer inside or outside.
- After pruning dead re-exports, re-run the engine (`ts-opt rescan --wave 2`): orphaned modules cascade into wave 1.
- Do not cite performance numbers for barrels; measure on the user's project if it matters.

## 3. Cycles (struct-02)

Source order: Knip `--cycles`, then project madge/dpdm (with `--ts-config` so aliases resolve), then the built-in graph (confidence `likely`).

False positives to dismiss: every edge is `import type` (or inline `type` on every specifier); the cycle exists only through `.d.ts` files; the cycle appears only when path aliases are unresolved. Convert borderline `import { Foo }` to `import type { Foo }` (zero risk, deletes a real runtime edge); `verbatimModuleSyntax: true` keeps it enforced.

True defect: a value import in each direction (initialisation-order hazard, `ReferenceError` or silent `undefined`).

Strategies, in order:

1. Extract a shared leaf module (default): move the shared types and pure helpers to a module that imports neither side; both sides import the leaf with `import type`; leave functions where they are so only one direction of value import survives.
2. Type-only imports: where the cycle was types imported with value syntax (transpilers keep the import unless it is marked).
3. Dependency inversion: pass the behaviour (a callback or parameter) instead of importing the higher-level module.

## 4. Inlining indirection (struct-03)

Criteria and exclusions are in `pocock-tenets.md` (Deletion Test). Procedure:

1. Confirm a single consumer with `rg -w <symbol>`.
2. Replace the call with the direct expression at the call site; add the direct imports the call needs.
3. Delete the wrapper definition.
4. Re-run the engine; if the wrapper file has no exports left, delete the file in the same finding if the file is in `touches`.

Single-expression builders (one template literal) follow the same rule.

## 5. Consolidating duplicate utilities (struct-07)

1. Catalogue every definition and call site of the duplicated helper (`cn`, `clsx`, `formatDate`, `formatCurrency`, `slugify`, `capitalize`, `sleep`, `delay`, `truncate`, `clamp`, `safeJsonParse`, `isEmpty`, `isNil`...). The detector matches names plus a normalised-body hash.
2. Choose one canonical, cohesive module (`lib/format/`, `lib/async.ts`). Never a junk-drawer `utils.ts` of unrelated exports; that creates cycles.
3. Make the canonical implementation a superset that satisfies every call site.
4. Redirect imports.
5. Delete every other definition.
6. Verify with the gate. Cross-file duplicates belong to struct-07; inline re-implementations such as `new Promise(r => setTimeout(r, ms))` are slop-05 and struct-07 wins when both fire.

## 6. Co-location and feature pods (struct-06, struct-08)

- Apply the 1-to-1 rule and the Rule of Three from `pocock-tenets.md`.
- Checklist when moving: strip `export` when a helper lands inside its consumer; update test import paths; `git mv`; re-run the engine to confirm the old location has no dangling references.
- Flatten folders whose modules are coupled only to their immediate parent (depth ceiling 4 below `src/`).
- Separate `.types.ts` files for three-line prop interfaces are not warranted; keep dedicated type modules for contracts shared across a feature boundary.
- Grouping micro-files into pods is `WORTH_EXPLORING` in architect terms: it needs team agreement and is not scheduled by default.

## 7. Complexity hotspots (struct-09)

Flag-only ranking of refactor targets; dead code concentrates in complex functions. Defaults (`config.thresholds`): cyclomatic above 10 warn, above 16 high, above 25 critical; cognitive above 15; function length above 60 lines; nesting above 3; 4 or more parameters; boolean flag arguments. Run engine rules read-only with CLI overrides (Biome `noExcessiveCognitiveComplexity`; ESLint `complexity`, `max-depth`, `max-params`, `max-lines-per-function`), never by editing config; otherwise rank by keyword density. Typical smells: deep nesting, long parameter lists, boolean flags, switch towers, god functions.

## 8. When NOT to refactor

- The symbol is a mock seam, an anti-corruption layer, or satisfies a framework-enforced interface.
- It crosses a package boundary or sits behind `package.json#exports`.
- The module is cold (no recent churn); hot-spot scoping applies, YAGNI.
- The change would need a test assertion edit.
- More than 5 files or more than one structural concern would change at once: split it.
- The code is generated (`@generated`, `*.gen.ts`, codegen output dirs): structure rules do not apply.
- The only motive is taste. `SPECULATIVE` proposals (for example hexagonal ports/adapters) are flagged, never scheduled.

## 9. Commit discipline

One finding per commit through `ts-opt commit`, with a scoped message such as `refactor(inline): ...`, `refactor(cycles): ...`, `refactor(barrels): ...`, `refactor(colocate): ...`. Cycles and barrels share wave 2; each remains individually revertible.
