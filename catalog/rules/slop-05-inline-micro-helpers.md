---
schema: ts-optimize/rule@1
id: slop-05
version: 1
name: Inline re-implemented micro-helpers
domain: slop
batch: null
wave: "R"
severity: advisory
fix_risk: low
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [deep]
engines: [R]
requires: {}
tells:
  - {id: t1, regex: '\bawait\s+new\s+Promise(?:<[^>]*>)?\s*\(\s*\(?\s*([\w$]+)\s*\)?\s*=>\s*\{?\s*setTimeout\s*\(\s*\1\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '^[ \t]*(?:(?:async[ \t]+)?function[ \t]+(?:capitalize|slugify|formatDate|formatTime|formatCurrency|cn|sleep|delay|truncate|clamp|safeJsonParse|isEmpty|isNil|debounce)[ \t]*[<(]|const[ \t]+(?:capitalize|slugify|formatDate|formatTime|formatCurrency|cn|sleep|delay|truncate|clamp|safeJsonParse|isEmpty|isNil|debounce)[ \t]*=[ \t]*(?:async[ \t]*)?(?:\([^)\n]*\)|[\w$]+)[ \t]*(?::[^=\n>]+)?=>)', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT §2.1 D', 'CAT Origin B']
---
## What
Ad-hoc copies of tiny well-known helpers inlined where they are used. t1: `await new Promise(r => setTimeout(r, ms))` in application code instead of a shared `sleep`; the backreference ties the `setTimeout` argument to the promise's resolve parameter, so a promise that rejects on a timeout (`(_, reject) => setTimeout(() => reject(...), ms)`) never matches. t2: a *local, unexported* function or arrow with a catalogue name (`capitalize`, `slugify`, `formatDate`, `formatTime`, `formatCurrency`, `cn`, `sleep`, `delay`, `truncate`, `clamp`, `safeJsonParse`, `isEmpty`, `isNil`, `debounce`). Exported definitions and cross-file duplicates belong to struct-07; a local copy of something the repository, or a dependency such as `lodash`/`date-fns`, already provides is the signal here.

## Triage
Keep (false positive) when:
- The local helper intentionally differs from the shared one (locale, rounding, null handling) and the name is a coincidence; compare the bodies.
- It is the shared implementation itself in a module that is the canonical location.
- The inline promise is a one-off deliberate pause inside a test harness or script with no other users.
Seam: when struct-07 reports a duplicate set at the same location, **struct-07 is primary** and this finding is superseded (the consolidation redirects the call and removes the copy in one unit).

## Proposed change
For `{{symbol}}` in `{{file}}`, find the canonical helper first: `rg -n 'export (const|function) (sleep|capitalize|…)'`. If one exists, redirect:
```diff
-await new Promise((resolve) => setTimeout(resolve, 500));
+import { sleep } from '@/lib/async';
+await sleep(500);
```
```diff
-const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);   // local copy
+import { capitalize } from '@/lib/string';
```
If no canonical helper exists and there are two or more copies, create it once in a cohesive module (struct-07's protocol) rather than introducing a `utils.ts` junk drawer. A single local use of a three-line helper needs no change. Files: {{touches}} (at most 5).

## Verification
Wave R legs: typecheck, test, build. Semantic-invariance commit checks apply (doc 06 §6): zero assertion edits, no added control flow, at most 5 files. Tests that use fake timers (`vi.useFakeTimers()`) must still advance past the replaced delay; run them and confirm.

## Pitfalls
- A shared `sleep` built on `setTimeout` behaves identically under fake timers; one built on a different clock source (`performance.now` loops) does not.
- Replacing `safeJsonParse` copies with a different error policy changes failure behavior; compare the catch branches.
- t2 only sees top-level or indented *declarations* by name; renamed copies (`pause`, `waitMs`) are invisible to the tell.
- The `await` anchor keeps the canonical `sleep` definition (`=> new Promise(...)` without `await`) from matching t1.
