---
schema: ts-optimize/rule@1
id: reach-02
version: 1
name: Dead barrel re-export
domain: reachability
batch: 3
wave: "2"
severity: warn
fix_risk: low
fix_mode: assisted
grain: file
triage: agent
semantic_invariance: true
modes: [standard, deep]
engines: [K, G]
requires: {}
adapter: knip:barrel-exports
primary_over: []
sources: ['CLS Batch 3', 'CAT Origin C', 'WAV §6 (wave 2)', 'STR barrel rules']
---
## What
A re-export inside a **barrel** that no module outside the barrel consumes (Knip `exports`, `nsExports`, `duplicates`). A file is a barrel when the majority of its statements are re-exports; the decision is structural, not by file name. The source's `index.ts` filename test classified real modules as barrels and missed `api.ts`-style aggregators. `export *` also hides dead exports because the graph sees them as consumed.

## Triage
Keep when:
- The barrel is a public entry (package `exports`/`main`/`types` target, or an entry file with `includeEntryExports`): its exports are the contract.
- Importers cross a package boundary (the importer index shows consumers in another workspace) or use a path alias the graph could not resolve.
- The "barrel" is a real module: most statements are declarations (functions, classes, constants) with a few re-exports. Not this rule.
- The re-exported module has import side effects (polyfills, registration); removing the re-export stops them from running.
Q1/Q2: framework conventions that load `index` implicitly (SvelteKit hooks, Nuxt auto-imports) and string-keyed dynamic imports of the directory.
Seam: struct-02 wins when the same barrel edge is also a cycle edge (one finding).

## Proposed change
In `{{file}}` ({{package}}) name only what is consumed:
```diff
 export * from './Button';
-export * from './DeadModal';                       // no consumer outside this barrel
-export { ActiveCard, ObsoleteCard } from './Cards';
+export { ActiveCard } from './Cards';
```
Replace `export *` with explicit named re-exports of the consumed symbols (do not widen anything). When a side-effect module must still run, keep `import './x';` instead of the re-export. Members: {{members}}; importers re-checked: {{consumers}}.

## Verification
Legs: typecheck (TS2305 at an importer means a live consumer: restore), test, build, and for wave 2 the cycle count must not grow. Re-run the Knip engine afterwards: the module behind the deleted re-export may now be orphaned and cascade into wave 1. Commit check: no assertion lines changed, no new control flow.

## Pitfalls
- Removing a re-export from a published entry silently breaks external consumers; the `exports` map check applies when a symbol crosses a package boundary.
- A barrel imported by its own siblings (`../components`) is struct-01 territory; deleting entries does not fix that.
- Type-only re-exports (`export type { X }`) still shape the `.d.ts`; run declaration-emit when the package ships types.
