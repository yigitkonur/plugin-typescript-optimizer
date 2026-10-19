---
schema: ts-optimize/rule@1
id: struct-05
version: 1
name: Speculative generics and unused type parameters
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
engines: [A]
requires: {}
adapter: astgrep
astgrep: ['astgrep/struct-05-unused-generic-default.yml']
primary_over: []
sources: ['CAT Pattern 6', 'CX Smell 3', 'STR §3']
---
## What
A type parameter that nothing refers to: `function fetchItem<T = unknown, E = Error>(id): Promise<T>` where `E` appears only in its own declaration. The ast-grep rule reports the unused `type_parameter` itself on functions, arrows, methods, signatures, interfaces, type aliases and classes. A reference anywhere in the parameters, return type, body, heritage clause, or the constraint/default of a sibling parameter counts as used. These are ghost generics added for requirements that never arrived; they add cognitive overhead and instantiation work for the compiler. Speculative enum variants and unused union members are not matched here: Knip reports them as reach-05.

## Triage
Keep (false positive) when:
- The parameter is a deliberate phantom/brand (`interface Id<T> { value: string }`, nominal typing) and the type is used with different arguments at call sites that the compiler distinguishes. Check `rg '{{symbol}}<'` for differing type arguments.
- The generic is part of a published public signature or an interface that other packages implement: removing it is a breaking change (flag-only).
- A class/interface type parameter that is required by a `implements`/`extends` contract.
Reading rule: delete only when removing the parameter leaves every call site compiling without edits; if call sites pass explicit type arguments, they are consumers to fix in the same unit.

## Proposed change
In `{{file}}`, for `{{symbol}}` (members {{members}}):
```diff
-export function fetchItem<T = unknown, E = Error>(id: string): Promise<T> {
+export function fetchItem<T = unknown>(id: string): Promise<T> {
```
Remove the unused parameter and, if call sites pass it positionally (`fetchItem<User, ApiError>(id)`), drop that argument in the same commit. If every parameter is unused remove the whole `<...>` list. For an unconstrained parameter that exists only to type a value, prefer `unknown`. Unit size: the declaration plus its explicit-type-argument call sites, at most 5 files ({{touches}}).

## Verification
Wave R legs: typecheck, test, build; declaration-emit when the symbol is exported from a package with a declaration signal. Semantic-invariance commit checks apply (doc 06 §6): no assertion edits, no added control flow, at most 5 files. A removed parameter that was relied on for inference shows up as new `TS2558` or `TS2322` at call sites: fix by editing the call sites, never by adding casts.

## Pitfalls
- Overload signatures: a parameter unused in one overload but used in the implementation signature is still used; the rule examines each declaration separately, so read the whole overload set.
- Declaration files and `declare module` blocks describe external code; their generics belong to the library and are not ours to edit.
- A default (`E = Error`) makes an unused parameter look intentional in review; the compiler does not require type parameters to be used, so only a structural check finds them.
- Tsx files use the second rule document in the same yml (the angle-bracket generic needs `<T,>`).
