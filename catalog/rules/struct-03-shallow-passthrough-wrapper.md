---
schema: ts-optimize/rule@1
id: struct-03
version: 1
name: Shallow passthrough wrapper
domain: structure
batch: null
wave: "R"
severity: advisory
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [deep]
engines: [A]
requires: {}
adapter: astgrep
astgrep: ['astgrep/struct-03-passthrough-wrapper.yml']
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT Pattern 8', 'STR §3', 'STR Tenet 1 (Deletion Test)', 'CAT §2.1 D']
---
## What
An exported function or const arrow with 1-4 plain parameters whose entire body is one call receiving exactly those parameters, unchanged and in the same order: `export const getUser = (id: string) => api.get(id)`. It adds a file hop and a name to learn and no leverage. The ast-grep rule matches only that exact shape (no defaults, destructuring, rest, extra arguments, extra statements, `await`); the verdict about whether it is really shallow belongs to the Deletion Test below.

## Triage
Apply the Deletion Test: imagine deleting `{{symbol}}`. If its complexity vanishes (callers can call the target directly and read it more clearly) it is shallow: inline it. If complexity reappears in N callers it is a deep module that only looks thin today: keep it. Inline only when **all** hold:
1. Single consumer (`{{consumers}}` has exactly one file; confirm with `rg -w`).
2. Zero transformation: no validation, logging, telemetry, memoization, retry, error mapping.
3. No hidden complexity: nothing a reader would need to test in isolation.
4. No architectural seam: not a mock seam used via module mocking or DI, not an anti-corruption layer over a vendor SDK, not an interface/framework contract implementation, not part of the package's public `exports`.
Anything failing a criterion: `false-positive` with the failed criterion as the reason.

## Proposed change
Replace the call at the single call site with the direct expression, add the direct imports the wrapper used, delete the wrapper, and delete `{{file}}` when no exports remain.
```diff
 // consumer
-import { fetchUserProfileById } from '@/services/user/clientWrapper';
-const profile = await fetchUserProfileById(userId);
+import { apiClient } from '@/lib/apiClient';
+import type { UserProfile } from '@/types/user';
+const profile = await apiClient.get<UserProfile>(`/users/${userId}`);
```
Files in the unit: {{touches}} (at most 5). Strip nothing else; do not rename, reorder or "improve" the call.

## Verification
Wave R legs: typecheck, test, build. Semantic-invariance commit checks apply (doc 06 §6): no test assertion line changed, no added `if|for|while|catch|??|&&` unless the finding says `allows_new_control_flow: true`, at most 5 files, and a symbol crossing a package boundary needs the `exports` map check. Re-run the dead-code engine after inlining: the emptied file cascades to wave 1.

## Pitfalls
- A wrapper whose tests use `vi.mock('./clientWrapper')` is a mock seam; deleting it silently makes those tests hit the real module.
- Type narrowing at the wrapper boundary (return type annotation tighter than the callee) is a transformation; the ast-grep rule tolerates annotations, so check them.
- Wrappers that forward a changed argument list (`(id) => f(id, DEFAULTS)`) are not matched and are not this rule.
- Exported wrappers in a library's public API are protected paths: flag-only.
