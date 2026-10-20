# What Breaks on TypeScript 7

Loaded by the `ts7-compat` skill when reporting tools or scripts that fail on a TypeScript 7 project.

Root cause: TS 7 is a native compiler and ships no JavaScript compiler API ("it does not ship with an API"); a new API is expected in 7.1. Anything that does `require("typescript")` and calls `ts.*` (createProgram, createSourceFile, factory) breaks. The CLI (`tsc`) is unaffected.

Source: `catalog/ecosystem-compat.json`. Basis `v` = verified, `i` = inferred (say so in the report). Rule tc-04 = incompatible tooling (hard when the broken leg lint/test/build exists in the repo, warn if the tool runs ad hoc); tc-05 = transpile-runner hygiene (warn).

## Symptoms

- `TypeError: ts.createSourceFile is not a function` (or `ts.createProgram`, `ts.factory...`): own script or tool using the JS API.
- `typescript-eslint does not support TS 7.0` at ESLint startup (observed with typescript-eslint 8.72.0 on TS 7.0.2).
- Crash at startup of ts-node, type-coverage, madge when parsing.
- A tool resolves `typescript` and gets the native package with no `lib/typescript.js` API.

## Breaking tools

| Tool | Status | Remedy | Rule | Basis |
|---|---|---|---|---|
| typescript-eslint, `@typescript-eslint/*`, `eslint-config-next` | throws at startup (lint leg) | alias scheme, or move lint to Oxlint/Biome | tc-04 | v |
| ts-morph, `@ts-morph/*` | breaks | alias scheme; own scripts may import `@typescript/typescript6` | tc-04 | v |
| Any `import "typescript"` in repo scripts | breaks | alias scheme (no edit) or import `@typescript/typescript6` | tc-04 | v |
| ts-jest | breaks (test leg) | `@swc/jest`, vitest, or alias scheme | tc-04 | v |
| type-coverage | crashes unless given TS 6 | run with TS 6 (toolbox) or use the proxy metric | tc-04 | v |
| madge | crashes | Knip `--cycles` | tc-04 | v |
| dpdm | likely breaks | Knip `--cycles` | tc-04 | i |
| Knip v5 | breaks (inferred); v6 is fine | upgrade to Knip 6 (Node >= 20.19) | tc-04 | i |
| tsup/tsdown dts, rollup-plugin-dts, api-extractor, typedoc, ts-json-schema-generator, vite-plugin-dts (build leg) | likely break | alias scheme | tc-04 | i |
| vue-tsc, svelte-check, Astro/Angular template checking, MDX | need TS 6 (lint leg) | keep TS 6 via alias scheme | tc-04 | v |
| ts-node, ts-node-dev | crashes | `tsx`, or `node --experimental-strip-types` (Node >= 22.6, erasable syntax) | tc-05 | v |
| ts-loader | likely breaks | `swc-loader`/`esbuild-loader` plus `tsc --noEmit`, or alias scheme | tc-05 | i |
| ttypescript (`ttsc`), ts-patch (`tspc`) | likely break | drop compiler plugins or keep TS 6 for that build | tc-05 | i |

## Fine on TS 7

Biome, Oxlint (tsgolint v7 needs TS >= 7 and no `baseUrl`), Prettier, Knip 6, Vite, esbuild, SWC, Rolldown, tsx, Bun, Deno. They transpile or parse without the JS API.

## Caveat

`vite-plugin-checker` and `next build` type-check through the resolved `typescript`. Under the alias scheme that is TS 6, so their result can differ from `tsc` (7) until their 7.1 support lands. Report it as a note, not a failure.

## Procedure

1. List hits from dependencies (names in the table), imports (`git grep -E "from ['\"]typescript['\"]|require\(['\"]typescript['\"]\)"` outside `node_modules`) and package scripts.
2. For each hit report: tool, symptom, rule, basis, remedy. Mark `i` entries as inferred.
3. Choose between the alias scheme and replacement per `alias-scheme.md`.
4. The source skill's "Strategy 1" (`typescript@^7` plus `@typescript/typescript6` with imports rewritten) is superseded by the alias scheme.
