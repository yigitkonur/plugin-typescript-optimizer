---
schema: ts-optimize/rule@1
id: type-04
version: 1
name: Anemic type guard
domain: types
batch: 8
wave: "4"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R, A]
requires: {}
tells:
  - {id: t1, regex: ':\s*(?:asserts\s+)?[\w$]+\s+is\s+(?!Record\s*<|object\b|unknown\b|any\b|\{)[^{=;]*?\{\s*return\s+(?:true|typeof\s+[\w$]+\s*===?\s*[''"]object[''"]\s*&&\s*[\w$]+\s*!==?\s*null|[\w$]+\s*!==?\s*null\s*&&\s*typeof\s+[\w$]+\s*===?\s*[''"]object[''"])\s*;?\s*\}', scan: raw, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t2, regex: ':\s*(?:asserts\s+)?[\w$]+\s+is\s+(?!Record\s*<|object\b|unknown\b|any\b|\{)[^{;=]*?=>\s*\(?\s*(?:typeof\s+[\w$]+\s*===?\s*[''"]object[''"]\s*&&\s*[\w$]+\s*!==?\s*null|[\w$]+\s*!==?\s*null\s*&&\s*typeof\s+[\w$]+\s*===?\s*[''"]object[''"])(?![\w$.(\[])(?!\s*(?:&&|\|\||\?|\.|\())', scan: raw, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
astgrep: ['astgrep/type-04-anemic-guard.yml']
primary_over: []
sources: ['CAT Pattern 7', 'SK Sin 7', 'STM §2 pattern 1 (isRecord is the legitimate shape)']
---
## What
A user-defined type predicate `x is T` whose body proves only that the value is an object (`typeof x === 'object' && x !== null`, either order) or returns `true`, while `T` has mandatory fields. Callers treat the narrowing as proven and fail later with `Cannot read properties of undefined`. The regex tells scan raw text (they need the `'object'` literal) so a guard inside a comment also matches at tier 1; the ast-grep rule ignores comments and strings.

## Triage
Keep when:
- The predicate target really is "some object": `Record<string, unknown>`, `object`, `unknown`, `{}` (the tells already skip these). `isRecord` is the model of a correct shallow guard.
- The function is a first step that another guard composes (`isRecord(v) && hasId(v)`); read the callers before judging.
- `T` has no mandatory fields (all optional), so object-ness is a complete proof.
Reading rule: list `T`'s required members; every one must be checked, or the check must be delegated to a schema.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`, choose by what exists in the repo:
```diff
-function isUser(val: unknown): val is User {
-  return typeof val === 'object' && val !== null;
-}
+function isUser(val: unknown): val is User {
+  return UserSchema.safeParse(val).success;
+}
```
When a schema exists (zod/valibot/yup/arktype) delegate to it; when it does not, check each mandatory field with its own `typeof`/`Array.isArray`/`in` test; if `T` is large, define the schema once and derive `T` from it (type-03 owns the dual declaration). Consumers to re-run: {{consumers}}.

## Verification
Legs: typecheck, test, build. Extra proof: add a negative test (an object missing a required field must be rejected) or confirm one exists; a guard with no test is the likely origin of the bug. `rg -n 'is User'` shows the predicate still has the same name and signature so callers do not change.

## Pitfalls
- Do not widen the predicate to `val is Partial<User>` just to make the body honest; that changes every caller.
- Assertion functions (`asserts x is T`) have the same defect and the same fix; throw with a useful message.
- A guard that "passes" because the body returns `true` is usually a stub left by a generator; check git blame before deleting.
- Performance-sensitive hot paths may prefer hand-written checks over a schema parse; measure before assuming.
