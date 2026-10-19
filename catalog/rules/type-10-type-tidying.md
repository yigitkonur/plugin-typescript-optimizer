---
schema: ts-optimize/rule@1
id: type-10
version: 1
name: Type tidying
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
engines: [R, A, G]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*(?:string|number|boolean|bigint|symbol)\s*;?[ \t]*$(?!\s*[|&])', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t2, regex: '^[ \t]*(?:export\s+)?type\s+[A-Z][\w$]*\s*=\s*[A-Z][\w$]*\s*;?[ \t]*$', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t3, regex: '\binterface\s+[A-Za-z_$][\w$]*(?:<[^>{]*>)?\s+extends\s+[^{;]+\{\s*\}', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t4, regex: '\binterface\s+[A-Za-z_$][\w$]*(?:<[^>{]*>)?\s+extends\s+[^{;]*?\bRecord\s*<\s*(?:string|number|symbol|PropertyKey)\s*,\s*any\s*>', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t5, regex: '\btype\s+[A-Za-z_$][\w$]*\s*=\s*\{\s*(?:status|kind|type|state)\s*:\s*(?:''[^''\n]*''|"[^"\n]*")(?:\s*\|\s*(?:''[^''\n]*''|"[^"\n]*")){2,}\s*;\s*(?:[A-Za-z_$][\w$]*\?\s*:[^;]+;\s*){2,}\}', scan: raw, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
astgrep: ['astgrep/type-10-record-any-extends.yml']
primary_over: []
sources: ['STM §4 rules 1-3', 'SK Sin 6 (speculative abstractions)']
---
## What
Residual type structure that adds indirection without safety: identity aliases (`type StringId = string`), aliases that only rename another type (`type ApiRequestConfig = AxiosRequestOptions`), empty `interface X extends Y {}`, dead `extends` parents, `extends Record<string, any>` (every typo compiles), optional-property bags that should be discriminated unions, and parallel representations of one entity (`UserDTO`/`IUser`/`UserData`, found from the symbol index when field sets overlap by 90% or more). `t5` scans raw text because it needs the string literals; a match inside a comment is a false positive the agent drops.

## Triage
Keep when:
- A true nominal brand (`string & { readonly __brand: unique symbol }`) or an alias whose name documents a unit or domain meaning that call sites rely on in reviews.
- An empty extension used for declaration merging, a public API slot, or to add a JSDoc-bearing name.
- An alias that is the single seam where a third-party type is isolated (anti-corruption); changing it touches every consumer.
- Parallel types that differ in real fields (wire vs domain); only identical or near-identical ones are duplicates.
Seam: when a schema constant exists beside the type, `type-03` owns the finding and this one is superseded.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`, choose the matching case and update importers {{consumers}}:
- Identity alias: delete it and use the primitive; or add a real brand.
- Rename alias: import the upstream type at call sites and delete the alias.
- Empty extension: `type PrimaryButtonProps = ButtonBaseProps;` or repoint callers to the parent.
- `extends Record<string, any>`: drop it; keep dynamic keys in `metadata?: Record<string, unknown>`.
- Optional bag:
```ts
type AsyncRequest =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'success'; data: Record<string, unknown> }
  | { status: 'error'; error: Error };
```
- Parallel types: pick one canonical type, derive variants with `Pick`/`Omit`, then delete the rest.

## Verification
Legs: typecheck, test, build, declaration-emit when any touched type is exported (an alias in a public signature changes emitted names). Extra proof: `rg -w <OldName>` shows zero remaining references before deleting an alias.

## Pitfalls
- Removing `Record<string, any>` surfaces real property typos as errors; fix them, never re-add the index signature.
- Converting a bag to a union forces every producer to build valid states; list producers first.
- An alias removed from a barrel may be re-exported publicly (reach-02 and the package `exports` map).
