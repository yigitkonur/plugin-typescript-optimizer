---
schema: ts-optimize/rule@1
id: reach-05
version: 1
name: Unused type, interface, enum member or namespace member
domain: reachability
batch: 6
wave: "4"
severity: warn
fix_risk: low
fix_mode: auto
grain: file
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [K, T]
requires: {}
adapter: knip:types
downgrade_in: {enumMembers: assisted, namespaceMembers: assisted, declaration_precheck_failed: assisted}
primary_over: []
sources: ['CLS Batch 6', 'WAV §9 (wave 4)', 'DEC §1-§6', 'knip-configuration §7 (rules)']
---
## What
Type declarations, enum members and namespace members with no consumers (Knip `types`, `nsTypes`, `enumMembers`, `namespaceMembers`). Types are erased, so the runtime blast radius is zero; the real risk is the **declaration graph**: a type unused by name can still be reachable from an exported signature. `fix_mode` is `auto` only for a top-level `interface`/`type`/`enum` with zero references when the declaration-emit leg is not applicable or its pre-check passed; enum members, namespace members and anything that fails the pre-check are `assisted` (see `downgrade_in`). Knip v6 has no `classMembers`; the plugin never enables it on v5 either.

## Triage
Keep when:
- Public contract: entry exports, package `types`/`exports` targets, or any type named or inferred by an exported signature (the pre-check proves it by grepping emitted declarations).
- Enum members whose values are persisted or on the wire (database columns, API payloads, analytics events), or are enumerated with `Object.values(E)`; removing a member changes data compatibility, not just code.
- Decorated or reflected members (Nest, TypeORM, class-validator) and generated types.
- A type used only in the same file under `ignoreExportsUsedInFile` policy: that is reach-04 territory, not deletion.
Evidence: `rg -w <Type>` over `src` and `*.d.ts` excluding the declaration; zero references means delete, references only in the same file means strip `export` (reach-04).

## Proposed change
In `{{file}}` ({{package}}):
- Top-level `{{symbol}}` with zero references: delete the declaration and any now-dangling `import type { {{symbol}} }` specifiers at {{consumers}}.
- Enum member: remove the member after confirming no persisted value or string key uses it; keep numeric values of the remaining members stable.
- Namespace member: remove the member and re-run the namespace's consumers.
Before the edit, when a declaration signal exists, emit once to a temp dir (`<tsc> -p <cfg> --declaration --emitDeclarationOnly --outDir <os-tmp>`) and `rg -n '\b{{symbol}}\b' <os-tmp>`; a hit means keep and register as public.

## Verification
Legs: typecheck, test, build, declaration-emit (part of the wave gate), coverage no-regress. `TS4081`/`TS4060`/`TS4082` after the edit means the type was reachable: restore it; never suppress with `@ts-expect-error`.

## Pitfalls
- `tsc --noEmit` never builds the declaration graph; a green typecheck is not proof.
- Deleting a type that a `.d.ts` file or JSDoc `@type {import(...)}` references is invisible to Knip; grep non-TS files too.
- Removing the last member of an enum can leave an empty enum; delete the enum only after its own check.
- Type-07 wins on a symbol whose removal breaks declaration emit: the finding turns into "keep, register as public".
