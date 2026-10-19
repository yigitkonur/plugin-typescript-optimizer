---
schema: ts-optimize/rule@1
id: type-02
version: 1
name: Chained non-null assertions
domain: types
batch: 8
wave: "4"
severity: advisory
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R]
requires: {}
tells:
  - {id: t1, regex: '[\w$\])]!\.[\w$]+(?:\([^()\n]*\))?!(?!=)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT Pattern 1 (chained non-null assertions)', 'STM §3 phase 2 (no `!` without a guard)', 'SK Sin 1']
---
## What
Two or more non-null assertions in one access chain (`a!.b!.c!`, `getUser()!.profile!.name`). Each `!` tells the compiler to trust the author; chained, they replace a null check with a runtime `TypeError` waiting for the first absent value. The tell requires an assertion followed by a member access and a second assertion, so a single `x!.y` and a not-equal comparison such as `a!.b!==1` never match.

## Triage
Keep when:
- An explicit invariant guard sits immediately before the line (`if (!cfg.a?.b) throw ...` followed by assertions) and the assertions are the only way to carry the narrowing across a closure.
- Test code asserting fixtures that are known present (downgraded to advisory).
- Definite-assignment fields (`field!: string`) and non-null on array reads under `noUncheckedIndexedAccess` are different constructs and are not this rule.
Reading rule: ask where the value could be absent. If the answer is "never, by construction", the type is wrong upstream (fix the type); if "sometimes", the assertion is a bug.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`:
```diff
-const name = getUser()!.profile!.name;
+const user = getUser();
+if (!user?.profile) throw new Error('user profile missing');   // or return a typed error value
+const { name } = user.profile;
```
Prefer, in order: narrow once with a guard or early return; widen the return type honestly (`T | undefined`) and handle it; parse at the boundary so the shape is guaranteed (`Schema.parse`). Optional chaining plus `??` is acceptable only where the fallback is a real domain default. Members: {{members}}.

## Verification
Legs: typecheck (the guard must satisfy `strictNullChecks`), test, build. Extra proof: add or run a test that exercises the absent case when the code path is reachable; otherwise state in the commit body why it is unreachable. The count of `!.` links in the file must not increase.

## Pitfalls
- Replacing every `!` with `?.` silently turns a crash into `undefined` flowing onward; choose the failure behaviour deliberately.
- Under `strict: false` (no `strictNullChecks`) the assertions are no-ops; the finding is still debt but the fix has no compiler feedback, so keep the diff small.
- Do not pair this rule with type-05 on the same lines: when the file already uses `?.` heavily, fix the type, not each site.
