---
schema: ts-optimize/rule@1
id: struct-06
version: 1
name: Single-consumer helper in a shared directory
domain: structure
batch: null
wave: "R"
severity: advisory
fix_risk: low
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [deep]
engines: [G]
requires: {}
adapter: "symbols+importers:single-consumer"
primary_over: []
sources: ['CAT Pattern 9', 'STR §6 (1-to-1 rule, Rule of Three)', 'STR Tenet 4']
---
## What
A helper, constant or type that lives under a shared directory (`utils`, `helpers`, `shared`, `lib`) but has exactly one consumer file and fewer than 25 lines of code. Agents dump every small formatter into a global layer, which fragments context (one card component costs six file hops) and strands orphans when the feature is deleted. Detection combines the symbols index (declaration size under 25 LOC, not re-exported), the importers index (`{{consumers}}` has exactly one file) and the path class. Test files count as consumers only when the helper is also used in production code; a helper imported only by a test is reach-03.

## Triage
Apply the 1-to-1 rule and the Rule of Three. Promote or keep in the shared layer only when all hold: at least three distinct feature domains consume it, it is domain-agnostic (math, ISO date parsing, hashing, array chunking), and it has its own isolated tests. Keep (false positive) when:
- It has its own test file that exercises it as a unit (move the pair together or keep).
- The shared directory is a published entry (`package.json#exports` maps into it).
- The single consumer is a barrel that re-exports it to many external users (the importer index sees one file; the real consumers are beyond it).
- Dynamic import or string-keyed registry references exist (Three-Question Test, question 2).

## Proposed change
Move `{{symbol}}` from `{{file}}` into its consumer (`{{consumers}}`):
1. Under about 25 lines and purely computational: paste it into the consumer as a non-exported declaration; **strip `export`**.
2. Larger or needing its own tests: `git mv` it to a sibling file next to the consumer (`orderSummary.ts` beside `orderSummary.calculator.ts`); keep `export`.
```diff
-import { formatMemberSince } from '@/utils/formatMemberSince';
+const formatMemberSince = (d: Date) => d.toLocaleDateString('en', { month: 'short', year: 'numeric' });
```
3. Update test import paths if a test follows the helper; use `git mv` so history follows (confirm `git status` shows renames), and delete the emptied source file. Do not create a separate `.types.ts` for a three-line prop interface. Files: {{touches}} (at most 5).

## Verification
Wave R legs: typecheck, test, build. Semantic-invariance commit checks apply (doc 06 §6): no changed assertion line, no added control flow, at most 5 files, `exports`-map check across package boundaries. Re-run the engine: the old location must have no dangling references and, if now empty, is reported as an unreferenced file (wave 1 cascade).

## Pitfalls
- Moving a helper that closes over module state (a cache, a counter) into another file changes sharing semantics when it had a second import path; check for module-level state.
- A one-consumer helper that is a mock seam stays where tests expect it.
- Size alone is not the criterion: a 20-line retry/backoff policy is real behavior, not a trivial formatter; hand it to struct-11 as a deepening candidate instead.
- Never move across a package boundary without an explicit approval and the `exports` check.
