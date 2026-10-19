---
schema: ts-optimize/rule@1
id: type-08
version: 1
name: Non-erasable syntax
domain: types
batch: 8
wave: "4"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R, A, T]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*(?:export\s+)?(?:default\s+)?(?:const\s+)?enum\s+[A-Za-z_$][\w$]*\s*\{', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t2, regex: '^[ \t]*(?:export\s+)?(?:namespace|module)\s+[A-Za-z_$][\w$.]*\s*\{', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t3, regex: '\bconstructor\s*\(\s*(?:(?:[^(){}]|\((?:[^()]|\([^()]*\))*\)|\{[^{}]*\})*?,\s*)?(?:@[\w$.]+(?:\((?:[^()]|\([^()]*\))*\))?\s*)*(?:public|private|protected|readonly|override)\s+[A-Za-z_$]', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
astgrep: ['astgrep/type-08-enum-namespace-param-props.yml']
downgrade_in: {pipeline_strips_types: warn, no_erasable_signal: advisory}
primary_over: []
sources: ['CAT Pattern 10', 'SK Sin 10', 'STM §4 (string-literal unions)']
---
## What
`enum`/`const enum`, runtime `namespace`/`module N {}` and constructor parameter properties (`constructor(private x: X)`) are TypeScript syntax that emits code. They fail `erasableSyntaxOnly` (TS 5.8+) and cannot run under type-stripping pipelines (Node strip-types, Deno, Bun, esbuild/SWC/Vite in isolated mode). Severity is a project signal: `hard` when `erasableSyntaxOnly` is on and the check fails; `warn` when the pipeline strips types; `advisory` otherwise. Ambient forms (`declare enum`, `declare namespace`, `declare module "x"`) are erased and never match; an object type such as `{ readonly a: string }` inside a constructor parameter is not a parameter property.

## Triage
Keep when:
- The enum is a public contract consumed by other packages (changing it alters the declaration emit and runtime object): propose, do not apply.
- Runtime iteration or reverse lookup depends on enum semantics (`Object.values(E)`, numeric `E[0]`).
- A decorator-metadata framework (Nest, TypeORM, Angular) relies on constructor injection through parameter properties and the build does not strip types.
- A namespace that merges with a function or class for typing (declaration merging) and is type-only.
Question 3 (public contract) decides most cases; Q2 asks whether the enum name reaches a string-keyed registry (ORM column enums, GraphQL schema).

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`:
```ts
// enum -> const object + union, same name for value and type
export const Status = { Active: 'active', Inactive: 'inactive' } as const;
export type Status = (typeof Status)[keyof typeof Status];
```
- Namespace: turn into a module; one export per member; update `import { N }` to `import * as N` or named imports at {{consumers}}.
- Parameter properties: declare fields explicitly and assign after `super(...)`:
```diff
-constructor(private readonly repo: Repo) {}
+private readonly repo: Repo;
+constructor(repo: Repo) { this.repo = repo; }
```
Numeric enums: keep the numeric values in the object; add an explicit reverse table only if something reads it.

## Verification
Legs: typecheck, test, build, declaration-emit when exported. Extra proof when TS >= 5.8: the touched files pass `tsc --noEmit --erasableSyntaxOnly` (no TS1294). Exhaustive `switch` statements over the old enum must still compile (`never` check).

## Pitfalls
- `Object.keys(NumericEnum)` includes reverse keys; the const object does not. Search for iteration before converting.
- `const enum` is inlined at compile time; a const object is not, so output size and tree-shaking change slightly.
- Parameter-property initialisation order differs from explicit assignment when field initialisers reference the parameter; keep the order.
- Do not touch `.d.ts` or ambient declarations; they are erased and valid.
