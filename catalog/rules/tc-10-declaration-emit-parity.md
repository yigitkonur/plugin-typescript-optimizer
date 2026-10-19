---
schema: ts-optimize/rule@1
id: tc-10
version: 1
name: Declaration-emit parity risk
domain: toolchain
batch: null
wave: "T3"
severity: advisory
fix_risk: medium
fix_mode: flag-only
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X, T]
requires: {declaration_signal: true}
adapter: "fit:declaration-parity"
primary_over: []
sources: ['UG declaration-emit-failures.md', 'UG post-migration-verification-gate.md (Tier 3)', 'DEC §3 and §6', 'doc 05 §8.2 and §9', 'doc 08 §3 defect 8']
---
## What
A library (a package with a `declaration_signal`: `declaration`, `composite`, `isolatedDeclarations` or `emitDeclarationOnly` true, `types`/`typings`/`exports[*].types` in `package.json`, or `main`/`module`/`exports` pointing into `dist/**`) whose declaration emit behaves differently on the native compiler. The probe emits declarations with both compilers into a temporary directory and compares **diagnostics only**, never the `.d.ts` bytes: upstream states exact `.d.ts` parity is a non-goal, so a textual diff of declaration files is noise. Watched codes: `TS4023`, `TS4058`, `TS4060`, `TS4081`, `TS4082`, `TS2742`, `TS2883` (the compiler cannot name a type, or an inferred type leaks a non-exported or external-module name). `isolatedDeclarations` enables fast parallel emit by requiring explicit annotations on every exported boundary.

## Triage
Deterministic: a new declaration-emit diagnostic on the native compiler for a symbol is real. Treat any such diagnostic as a true defect (the compiler cannot name a type); never suppress with `@ts-expect-error`. Keep (no finding) when the divergence is a known classified one in the divergence table, or the package is private and emits no declarations in practice (the signal came from a stray `composite`). The skill `declaration-emit` carries the diagnostic matrix and fix patterns.

## Proposed change
Flag-only for `{{file}}` / `{{symbol}}` in `{{package}}`. Suggested diff shape (annotate or export the leaked type):
```diff
-interface InternalOptions { apiKey: string }
-export function createClient(opt: InternalOptions) { return { opt }; }
+export interface InternalOptions { apiKey: string }
+export interface ClientInstance { opt: InternalOptions }
+export function createClient(opt: InternalOptions): ClientInstance { return { opt }; }
```
Probe commands the plugin runs (never `--noEmit false` into the source tree):
- single project: `<tsc> -p <cfg> --declaration --emitDeclarationOnly --outDir <os-tmp> [--noEmit false] --tsBuildInfoFile <os-tmp>/x`
- composite: `<tsc> -b --emitDeclarationOnly`, then `<tsc> -b --clean`, then assert `git status --porcelain` is unchanged.
Variant handling is probed once at baseline: `TS5053` (`--emitDeclarationOnly` with `--noEmit`), `TS5065` (`--outDir` with `-b`), `TS5094` (`-b --noEmit`) each select the matching fallback and are recorded in the run.

## Verification
T3 legs include `declaration-emit` (when the package has the signal): zero watched codes on the native compiler, equal to or fewer than the authoritative run. Then typecheck, test and build. `git status --porcelain` must show no emitted files afterwards.

## Pitfalls
- The source skill's Tier 3 command (`tsc --declaration --emitDeclarationOnly --noEmit false`) writes declarations into the source tree when no `outDir` is set; use a temporary `--outDir`.
- Do not "un-export to fix" a leaked type: un-exporting is what causes `TS4023`; register the type as public or annotate (type-07 is primary for reach-04/05 on such symbols).
- `rootDir` and `module` default changes (tc-03) move declaration paths; re-run after any T1 edit.
- A byte-diff of `.d.ts` between compilers will always look alarming and means nothing here.
