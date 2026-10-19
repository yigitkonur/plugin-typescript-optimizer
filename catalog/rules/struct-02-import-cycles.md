---
schema: ts-optimize/rule@1
id: struct-02
version: 1
name: Import cycles
domain: structure
batch: 9
wave: "2"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: cycle
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [K]
requires: {}
adapter: "graph:cycles"
downgrade_in: {type-only-cycle: advisory}
primary_over: [reach-02]
sources: ['CAT Origin C', 'STR §4', 'analysis-engines.md §2', 'FPT §8', 'doc 06 §10']
---
## What
A strongly connected set of modules that import each other (`A -> B -> C -> A`). Cycles cause `ReferenceError: Cannot access 'X' before initialization`, symbols that evaluate to `undefined` during bundle evaluation, and defeat tree-shaking. Three kinds, recorded on the finding: barrel-manufactured (the cycle runs through a directory barrel), value (a value import in each direction: the real hazard), and type-only (every edge is `import type`, an inline `type` specifier, or goes only through a `.d.ts`). Detection order: Knip `--cycles`, then a project `madge`/`dpdm` run with `--ts-config` if the capability probe says it works on this TypeScript, then the built-in Tarjan SCC over the importer index (`confidence: likely`).

## Triage
- Type-only cycles are false positives: report `false-positive` with the edge list as evidence. Borderline `import { Foo }` where `Foo` is only a type becomes `import type`; `verbatimModuleSyntax` keeps it enforced.
- A cycle whose edges exist only through a mis-resolved path alias (`madge` without `--ts-config`) is a tool artefact, not a defect.
- A value cycle is a true defect even when the app runs today: initialisation order is accidental.
- When the same barrel edge is also a dead re-export (reach-02), this finding is primary and the sibling is superseded; fixing the cycle fixes both.

## Proposed change
Cycle `{{members}}` in `{{package}}` (files {{touches}}). Choose the first strategy that fits:
1. Leaf extraction (default): move the shared types, constants and pure helpers into a leaf module that imports nothing from the cycle; point both sides at it.
```diff
-import { Order, calculateOrderTotal } from './order';   // in user.ts, while order.ts imports User
+import type { User, Order } from './types';             // leaf: zero imports
+import { calculateOrderTotal } from './order';          // one-way value import remains
```
2. Type-only imports: `import type { UserProfile } from './userProfile'`.
3. Dependency inversion: pass the behavior in (`executeTask(task, onComplete?)`) instead of importing the higher-level module.
Bound the unit to 5 files; barrel-manufactured cycles are fixed by struct-01's direct imports first. Never combine barrel decoupling, inlining and cycle repair in one commit.

## Verification
Wave 2 legs: typecheck, test, build, and `cycles` with no new fingerprints (compare against the pre-refactor cycle set, not against zero). Tests pass with zero assertion edits. The added lines in the diff should be imports and moved declarations, not new control flow.

## Pitfalls
- `madge` and `dpdm` use the TypeScript JS API and crash on TS 7 projects; trust the capability probe, never assume.
- A new leaf module that grows into a junk drawer recreates the web; keep it types/constants only.
- Moving a side-effectful module changes evaluation order; read the module for top-level effects first.
- Re-run the engine after the fix: cycle repair often orphans a re-export that cascades to wave 1.
