---
schema: ts-optimize/rule@1
id: struct-07
version: 1
name: Duplicate utility implementations
domain: structure
batch: null
wave: "R"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [deep]
engines: [G]
requires: {}
adapter: "symbols:duplicate-utilities"
primary_over: [slop-05]
sources: ['CAT §2.1 D', 'CAT Origin B', 'STR §6']
---
## What
The same helper defined in two or more files, usually by a model that could not see the rest of the repository: `cn`, `clsx`/`twMerge` wrappers, `formatDate`, `formatTime`, `formatTimestamp`, `formatCurrency`, `toIsoString`, `slugify`, `capitalize`, `truncate`, `sanitizeString`, `sleep`, `delay`, `clamp`, `safeJsonParse`, `isEmpty`, `isNil`. The symbols adapter lists declared names from that catalogue in at least two files (exported or local) and compares a normalised-token body hash (comments and whitespace stripped, locals renamed positionally), so identical bodies group even when formatting differs. Diverging bodies under one name are still reported, as `likely`, because the behavioral differences are the hazard.

## Triage
Keep (false positive) when:
- The bodies differ intentionally (a `formatDate` per locale or per API contract) and the name is a coincidence.
- The copies live in different packages that must not depend on each other (a worker bundle and a Node tool) or in vendored/generated code.
- One copy is a thin domain wrapper adding policy over the canonical helper.
For real duplicates, record every definition (`{{members}}`) and every call site (`{{consumers}}`) before choosing the survivor.

## Proposed change
Consolidation protocol for `{{symbol}}`:
1. **Catalogue** every call site of every copy.
2. **Pick one canonical module**: a cohesive domain module (`src/lib/format/`, `src/lib/async.ts`, `src/lib/http/`), never a junk drawer `utils.ts` that collects hundreds of unrelated exports (that creates cycles).
3. **Superset** the canonical implementation so it satisfies all call sites; differences in edge cases (null input, locale, rounding) must be decided explicitly and stated in the commit body.
4. **Redirect** imports to the canonical module, then **delete** each duplicate definition.
5. **Verify** with the gate.
```diff
-const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));   // local copy
+import { sleep } from '@/lib/async';
```
Unit: at most 5 files ({{touches}}); larger duplications split into sequential findings in the same `{{package}}`.

## Verification
Wave R legs: typecheck, test, build. Semantic-invariance commit checks apply (doc 06 §6): zero assertion edits (a test that pinned a divergent edge case means the helpers were not duplicates: stop and re-triage), no new control flow unless `allows_new_control_flow: true`, at most 5 files. Re-run the dead-code engine afterwards for stranded exports.

## Pitfalls
- Superset-ing a helper to cover `undefined` input adds branches (`??`, `if`) that the commit check lists; record the reason.
- Equal names, equal bodies, different packages: consolidating forces a new dependency edge; prefer leaving the copy and recording `speculative`.
- When a slop-05 hit (inline copy) sits at the same location, this finding is primary and slop-05 becomes superseded.
- Do not merge `formatDate` variants that serve different contracts just because the hash is close.
