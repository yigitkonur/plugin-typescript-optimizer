---
schema: ts-optimize/rule@1
id: struct-04
version: 1
name: Phantom interface (single-implementation seam)
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
engines: [R, G]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*export\s+(?:default\s+)?interface\s+(I[A-Z][a-z][\w$]*)\b(?![\s\S]*\bimplements\b[^{;]*\b\1\b[\s\S]*\bimplements\b[^{;]*\b\1\b)', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
adapter: "symbols:implementers"
primary_over: []
sources: ['CAT Pattern 6', 'STR Tenet 3 (Seam Test)', 'CX Smell 3']
---
## What
`export interface IUserService` with at most one implementer in the repository. The tell finds exported interfaces named `I` + Capital + lowercase (so `IDE`, `IOError`, `Icon`, `InternalOptions` do not match) and drops any whose own file already shows two `implements` clauses; the `symbols:implementers` adapter then counts `implements X` and structural implementers across the whole workspace and keeps candidates with zero or one. One adapter is a hypothetical seam; two adapters (production plus an in-memory fake, or two vendors) are a real seam. TypeScript is structural: a mock never needs `implements`.

## Triage
Keep (false positive) when:
- Two or more implementers exist anywhere, including test fakes: a real seam. An `IProps` in a component library with several implementers stays.
- It is the port of a deliberate hexagonal boundary with a second adapter planned and tracked (ask the owner; otherwise speculative).
- It is public API of a published package (`exports`, `types`): flag-only.
- Zero implementers and used as a plain data shape (props, DTO): not a seam, at most a naming issue (type-10); demote to `speculative`.
Reading rule: run `rg -n 'implements\s+{{symbol}}\b'` and `rg -w {{symbol}}`; the count that matters is concrete adapters, not references.

## Proposed change
For `{{symbol}}` in `{{file}}`, with its single implementer and consumers {{consumers}}:
1. Delete the interface.
2. Remove `implements {{symbol}}` from the class and export the concrete class or functions directly.
3. Update consumers' `import type { {{symbol}} }` to the concrete type, or infer from the implementation.
```diff
-export interface IUserService { getUser(id: string): Promise<User> }
-export class UserService implements IUserService { ... }
+export class UserService { ... }   // callers and tests use UserService
```
Tests that substituted the interface use a structural stand-in (`{ getUser: vi.fn() } satisfies Pick<UserService, 'getUser'>`) instead of a second class.

## Verification
Wave R legs: typecheck, test, build; declaration-emit when the symbol is exported from a declaration-emitting package. Semantic-invariance commit checks apply (doc 06 §6): zero test assertion edits, at most 5 files, no new control flow. `rg -w {{symbol}}` must return nothing afterwards.

## Pitfalls
- Dependency-injection containers keyed by an interface token (Nest providers, tsyringe) may need the interface as a runtime token; check decorators before deleting.
- An interface merged with a class (`declaration merging`) or augmenting a library is not a phantom seam.
- The tell scans one file; the two-implementer exemption across files comes from the adapter. If symbols are unavailable the finding is capped at `likely`.
- Do not rename every `I`-prefixed interface in the repository: that was the source script's defect.
