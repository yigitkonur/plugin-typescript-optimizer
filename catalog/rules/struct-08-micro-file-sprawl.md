---
schema: ts-optimize/rule@1
id: struct-08
version: 1
name: Micro-file sprawl and over-deep directories
domain: structure
batch: null
wave: "R"
severity: advisory
fix_risk: medium
fix_mode: assisted
grain: package
triage: agent
semantic_invariance: true
modes: [deep]
engines: [G]
requires: {}
adapter: "fs:micro-sprawl"
primary_over: []
sources: ['STR §6 (depth ceiling, feature pods)', 'STR Tenet 4', 'CAT Pattern 9']
---
## What
Structure that costs more to navigate than the code it holds: directories nested more than 4 levels below `src/`, folders with a single child, and files under 30 lines with one importer scattered across horizontal layers (`components/`, `hooks/`, `types/`, `utils/`, `styles/`). The filesystem metrics come from `fs:micro-sprawl`; deletion of the feature strands the other files as zombie orphans. This rule is about shape, not behavior, so its fix is a move and its risk is import churn.

## Triage
Regrouping into feature pods is a `WORTH_EXPLORING` proposal by definition (it needs team alignment); `ts-architect` badges it and, per doc 06 §7, only `STRONG` proposals are schedulable by default, so a pod move is applied only after the user approves that plan item. Flattening a single-child folder with a concrete precedent can be `STRONG`. Keep (false positive) when:
- The deep path mirrors a framework convention (Next `app/` route segments, Nest modules, Storybook layout) or a published `exports` map.
- Single-child folders exist for a reason the build knows (generated output, a codegen target, a workspace package).
- The directories are cold: no churn in the last 6 months (YAGNI hot-spot scoping excludes them).
Reading rule: ask what changes together. Files that change together must live together; files changed by unrelated work should not be forced into one pod.

## Proposed change
Group the sprawl `{{members}}` into one co-located feature pod under `{{package}}`; flatten any folder whose modules couple only to its parent:
```text
-src/components/UserCard.tsx
-src/hooks/useUserCardData.ts
-src/types/userCard.ts
-src/utils/userCardFormatters.ts
+src/features/user-card/UserCard.tsx            (formatters and prop types inline)
+src/features/user-card/UserCard.test.tsx
+src/features/user-card/useUserCardData.ts      (only if complex enough to stay separate)
```
A component rendered only by its parent becomes a non-exported declaration in the parent file. Use `git mv` and confirm renames in `git status`; strip `export` from anything that became local. One pod per finding, at most 5 files ({{touches}}); larger regroupings split into sequential findings.

## Verification
Wave R legs: typecheck, test, build; `cycles` no-new if a barrel was touched. Semantic-invariance commit checks apply (doc 06 §6): zero assertion edits, only import-path changes in tests, no added control flow, at most 5 files. Compare the cycle fingerprint set before and after: moves create new edges. The diff must be renames plus import edits.

## Pitfalls
- Renames break `jest.mock('../hooks/useX')` strings, dynamic imports and Storybook globs that the importer index cannot see.
- Moving files across package boundaries is out of scope for this rule.
- Do not create a fresh `utils/` for what you just flattened.
- File size alone (under 30 lines) is not a defect: a 10-line well-named hook with three consumers is correct.
