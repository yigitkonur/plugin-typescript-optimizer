---
schema: ts-optimize/rule@1
id: tc-04
version: 1
name: JavaScript compiler-API consumers and incompatible tooling
domain: toolchain
batch: null
wave: "T2"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:api-consumers"
downgrade_in: {tool-outside-gate-legs: warn}
primary_over: []
sources: ['UG compiler-api-strada.md', 'UG linters-and-ast-tools.md', 'UG typescript6-compat-bridge.md', 'doc 05 §7 ecosystem table', 'doc 05 §8.4 T2', 'doc 08 §3 defects 1, 2, 13']
---
## What
TypeScript 7 has no JavaScript compiler API until 7.1. Anything that does `import ts from 'typescript'` or `require('typescript')` breaks, and so do tools that do it internally. Detection: `git grep -E "from ['\"]typescript['\"]|require\(['\"]typescript['\"]\)"` outside `node_modules`, plus dependency names matched against `catalog/ecosystem-compat.json` (each entry has `checked_on`; researched 2026-10-19, re-verify with fixtures). Severity is `hard` when the tool is part of a gate leg (lint, test, build) and `warn` when it only runs ad hoc.

| Tool | On a TS 7 project | Remedy |
|---|---|---|
| typescript-eslint, `eslint-config-next` | **throws at startup** (the source skill's "fully compatible" is wrong) | alias scheme, or move lint to Oxlint/Biome |
| ts-morph | breaks | alias scheme; own scripts import `@typescript/typescript6` |
| ts-node | crashes | `tsx` (tc-05) |
| ts-jest | breaks | `@swc/jest`, vitest, or alias scheme |
| type-coverage | crashes unless given TS 6 | toolbox TS 6 or the proxy metric |
| madge / dpdm | crash / likely break | Knip `--cycles` |
| Knip v5 | breaks (TS API); **Knip v6** (oxc, Node ≥ 20.19) is fine | upgrade |
| Biome, Oxlint (+ tsgolint v7), Prettier, Vite, esbuild, SWC, Rolldown, tsx, Bun, Deno | fine (no JS API) | none |
| vue-tsc, Svelte/Astro/Angular template checking, MDX | need TS 6 for template support | keep TS 6 for those tools |
| tsup/tsdown `dts`, rollup-plugin-dts, api-extractor, typedoc, ts-json-schema-generator | use the JS API (inferred) | alias scheme |

## Triage
Deterministic for detection; the agent specialises the proposal at fix time. Keep (no finding) when the import is type-only and erased, or the file is a fixture under a path that no script loads. A script that merely shells out to `tsc` is not an API consumer. Verify "inferred" rows with a fixture before telling the user a tool is broken.

## Proposed change
Choose the **alias scheme** when any third-party tool needs the JS API (Microsoft's documented side-by-side setup). In `package.json` ({{package}}):
```diff
 "devDependencies": {
-  "typescript": "^5.6.0",
+  "typescript": "npm:@typescript/typescript6@^6",
+  "@typescript/native": "npm:typescript@^7"
 }
```
Then `tsc` is the native compiler, `tsc6` and every `require('typescript')` are TS 6. Own scripts that import `typescript` need no edit; without the alias scheme, rewrite the import to `@typescript/typescript6` ({{consumers}}). Prefer **moving lint to Oxlint or Biome** when the repo already uses them. Caveat recorded in the finding: frameworks that type-check through the resolved `typescript` (`next build`) use TS 6 until their 7.1 support lands; `vite-plugin-checker` likewise. The bridge is transitional; plan replacement of custom AST scripts with maintained analysis tools. T2 precedes T3: attach the bridge **before** TS 6 is replaced.

## Verification
T2 legs: install with the detected package manager, then lint, test and build all start (a tool that crashes on startup shows up here, so the lint leg's red baseline policy applies); typecheck still uses the authoritative compiler. The fit probe re-run lists no remaining API consumer without a remedy.

## Pitfalls
- Do not remove TS 6 before the bridge is in place: it strands scripts and ESLint.
- Package managers may resolve the aliased name differently (pnpm hoisting, Yarn PnP); install and run each tool once.
- Version pins are data (`ecosystem-compat.json`); do not hardcode them in a recipe.
- The source's Strategy 1 (`typescript ^7` plus `@typescript/typescript6 ^6.0.4`, rewriting imports) is superseded by the alias scheme.
