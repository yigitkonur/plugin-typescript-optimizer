---
schema: ts-optimize/rule@1
id: reach-04
version: 1
name: Internal-only export
domain: reachability
batch: 5
wave: "3"
severity: warn
fix_risk: low
fix_mode: auto
grain: file
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [K, T]
requires: {}
adapter: knip:exports-internal
primary_over: []
sources: ['CLS Batch 5', 'WAV §7 (wave 3)', 'DEC §6 (pre-un-export checklist)', 'doc 05 §9 (declaration-emit leg)']
---
## What
A symbol declared with `export` that no other file imports; it is used only where it is declared (Knip `exports` with in-file usage **not** ignored). Removing `export` changes visibility from module-public to module-private; runtime behaviour and import resolution are unchanged. A symbol with test importers is reach-03, never this rule.

## Triage
Keep when:
- Entry or public-contract exports (package `exports`, entry files with `includeEntryExports`); framework special exports in route files (`GET`, `generateMetadata`, `getServerSideProps`, `config`); worker handlers and RPC classes bound in wrangler; decorator/reflection targets.
- Any exported signature in the same module names or **infers** the type (TS4023/4058/4060/4081/4082/2742/2883 on strip). The declaration-emit pre-check decides when the package has a declaration signal; if the symbol appears in emitted `.d.ts`, keep the export and register it as public (type-07 wins).
- The user's policy sets `ignoreExportsUsedInFile` for `interface`/`type`.
Prove no external consumer: `rg -w <symbol> --glob '!<defining file>'` returns nothing (also check `['symbol']` and template references).

## Proposed change
In `{{file}}` ({{package}}), remove the `export` keyword from the declaration of `{{symbol}}` (members: {{members}}). Forms: `export const|function|class|interface|type|enum X` loses the keyword; `export { a, b }` loses the specifier; `export default function f` becomes `function f` only if nothing imports the default; every overload signature must lose it together. Do not rename, reorder or reformat anything else; the lint bridge (reach-06) cleans residue later.

## Verification
Legs: typecheck (TS2305 at an importer means a consumer was missed: restore the export and fix the evidence), test, build, and declaration-emit when a declaration signal exists. Pre-check before the edit (single project): `<tsc> -p <cfg> --declaration --emitDeclarationOnly --outDir <os-tmp>` and `rg -n '\b<symbol>\b' <os-tmp>`; any hit means the symbol is public. The edit touches only `{{file}}`.

## Pitfalls
- A symbol never used even inside the file becomes an unused local (`TS6133`); that residue is reach-06's job in the bridge, not a reason to delete here.
- Never batch with Knip `--fix` outside the approved set; scoped fix rules are in doc 06 §12.
- Un-exporting inside a file that is itself unreferenced is reach-01's finding; this one is superseded.
- `export =`/`export as namespace` forms are module contracts, not candidates.
