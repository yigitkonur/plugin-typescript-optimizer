---
schema: ts-optimize/rule@1
id: reach-09
version: 1
name: Duplicate exports
domain: reachability
batch: 3
wave: "2"
severity: warn
fix_risk: low
fix_mode: assisted
grain: symbol
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [K]
requires: {}
adapter: knip:duplicates
primary_over: []
sources: ['CLS Batch 3 (duplicateExports)', 'knip-configuration §7 (duplicates)', 'WAV §6 (wave 2)']
---
## What
The same binding exported under two names from one module (`export { format, format as formatDate }`, or a function exported both as `default` and by name). Knip reports it as `duplicates`. Two public names for one thing double the surface consumers can depend on and keep dead aliases alive in barrels; wave 2 handles it together with dead barrel re-exports because both edit aggregator modules.

## Triage
Deterministic: the engine output is the evidence, then confirm which alias is live. Keep when:
- A library intentionally publishes both a default and a named export (CommonJS interop, documented API), or a deprecated alias carries `@deprecated` and a removal plan.
- A rename is mid-migration and the importer index shows consumers of **both** names; finish the migration first (assisted), do not delete.
- The duplicate sits in an entry file that is the package contract (`includeEntryExports`): changing it is a breaking change for external users.
Three questions: Q1 default exports consumed by frameworks (Next pages, route modules, config files) are never duplicates to remove; Q2 string-keyed imports of the alias name; Q3 external consumers.

## Proposed change
In `{{file}}` ({{package}}) keep the canonical name chosen by import count (`rg -c`) and the repository naming convention, then:
```diff
-export { format, format as formatDate };
+export { format };
```
Repoint the importers of the alias listed in `{{consumers}}` to the canonical name in the same commit (`touches` includes them). If the alias is the one with the most consumers, rename the declaration and keep the old name only when the package is published. Members: {{members}}.

## Verification
Legs: typecheck (TS2305 at an importer means an alias consumer was missed), test, build; wave 2 also requires that the cycle count does not grow. Rescan Knip: the duplicate is gone and no new unused export appeared.

## Pitfalls
- Removing the default export of a module that a framework loads by convention breaks at runtime without any type error.
- Changing which name is canonical alters stack traces and `.name` of functions only when the declaration is renamed; arrow assignments keep their variable name.
- Do not combine with reach-02 on the same barrel in separate commits if both touch the same line; the plan orders them by `depends_on`.
