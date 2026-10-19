---
schema: ts-optimize/rule@1
id: tc-03
version: 1
name: TypeScript 7 default-change exposure
domain: toolchain
batch: null
wave: "T1"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:default-changes"
primary_over: []
sources: ['doc 05 §8.3', 'doc 08 §3 defect 7', 'UG type-error-triage.md', 'UG vite-and-vitest.md', 'TS 7.0 announcement']
---
## What
Options the project never set change meaning on TypeScript 7. Data: `catalog/defaults-changes.json`. `strict` defaults to `true`; `types` defaults to `[]` (ambient `@types/*` packages are no longer included automatically); `module` defaults to `esnext`; `rootDir` defaults to `./` (the tsconfig directory); `stableTypeOrdering` is listed there too. The source skill omitted all of these. Detection is not a text match: `fit:default-changes` runs the authoritative compiler and the native compiler on the same config, compares diagnostics as multisets of `(file, TS code, normalised message)`, and attributes the extra native diagnostics to the flipped default. A key absent from the resolved chain is `null`, not `false`: the probe, not detection, applies the flips.

## Triage
Deterministic: the diagnostic delta is the evidence. Typical attributions:
- New `TS2304` / `TS2552` ("Cannot find name", "Cannot find global type") and `TS7016`: `types` became `[]`.
- A flood of `TS7006` / `TS2322` / `TS2532`: `strict` flipped from unset to true.
- Output landing in a different folder, or `TS6059` (file not under `rootDir`): `rootDir` moved.
Not this rule: genuinely new compiler behavior shown by a diagnostic with no flipped default behind it (tc-11 parity drift).

## Proposed change
In `{{file}}` ({{package}}), preserve current behavior first; tighten later through type-09:
- `types`: list what the code uses, per package. `["node"]`, `["node", "vitest/globals"]`, Workers projects use the `@cloudflare/workers-types/…` entry their config implies. `vitest/globals` matters here because the implicit include disappeared.
```diff
 "compilerOptions": {
+  "types": ["node", "vitest/globals"],
```
- `strict`: when the project never enabled it, add `"strict": false` explicitly (behavior preserved) and open a type-09 finding for the ladder; do not fix hundreds of errors inside a toolchain wave.
- `rootDir`: set it where emit layout mattered (`"rootDir": "./src"` when `outDir` should mirror `src/`).
- `module`: state the value (`ESNext`, `NodeNext`) rather than relying on the default.
For ambient gaps without a package, add `src/types/ambient.d.ts` with `declare module 'untyped-package';`. Error recipes: `TS2532` narrow or `?.` (tests only: `!` is acceptable); `TS2322 null → string | undefined`: `?? undefined`.

## Verification
T1 legs: authoritative typecheck stays green on the old compiler; the fit probe re-run shows the native diagnostic multiset equals the authoritative one for the attributed codes. Tests and build confirm no global (`describe`, `expect`, `process`) went missing.

## Pitfalls
- Setting `types: []` explicitly on TS 6 is how you reproduce the TS 7 behavior early; do that in a scratch config to preview.
- A package that runs in Workers must not get `types: ["node"]`; use the Workers types its `wrangler` config implies.
- `strict: false` is a pin, not a fix; the finding must say so, and type-09 carries the follow-up.
- Declaration output depends on `rootDir`; a library must pass tc-10 after changing it.
