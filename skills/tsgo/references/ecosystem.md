# Ecosystem Compatibility and Monorepo Patterns

Loaded by the `tsgo` skill when judging which tools survive a move to TypeScript 7 and when wiring project references (findings tc-04, tc-05, tc-08).

Source: `catalog/ecosystem-compat.json` (basis `v` = verified in cited sources, `i` = inferred, re-verify with a fixture). TS 7.0 ships no JavaScript compiler API; one is expected in 7.1.

## Tools and remedies

| Tool | On TS 7 | Remedy | Basis |
|---|---|---|---|
| typescript-eslint, `eslint-config-next` | throws at startup | alias scheme (`ts7-compat` skill) or move lint to Oxlint/Biome | v |
| ts-morph | breaks | alias scheme; own scripts may import `@typescript/typescript6` | v |
| ts-node | crashes | `tsx`, or `node --experimental-strip-types` (Node >= 22.6, erasable syntax only) | v |
| ts-jest | breaks | `@swc/jest`, vitest, or alias scheme | v |
| ts-loader | likely breaks | `swc-loader`/`esbuild-loader` plus `tsc --noEmit`, or alias scheme | i |
| ttypescript, ts-patch | likely break | drop compiler plugins (use the bundler) or keep TS 6 for that build | i |
| type-coverage | crashes on TS 7 | run with a TS 6, or use the proxy metric | v |
| madge | crashes | Knip `--cycles` | v |
| dpdm | likely breaks | Knip `--cycles` | i |
| Knip | v5 breaks (inferred), v6 fine (oxc based, Node >= 20.19) | upgrade to Knip 6 | i / v |
| tsup/tsdown dts, rollup-plugin-dts, api-extractor, typedoc, ts-json-schema-generator | likely break (JS API) | alias scheme | i |
| vue-tsc, svelte-check, Astro/Angular/MDX template checking | need TS 6 | keep TS 6 for them (alias scheme) | v |
| `vite-plugin-checker`, `next build` type-check | use the resolved `typescript` | with the alias scheme that is TS 6; note divergence from `tsc` (7) until their 7.1 support | v |
| Biome, Oxlint (+ tsgolint v7), Prettier | fine (tsgolint v7 needs TS >= 7 and no `baseUrl`) | none | v |
| Vite, esbuild, SWC, Rolldown, tsx, Bun, Deno | fine (transpile only) | none | v |

The source skill listed `@typescript-eslint` v8 and Knip v5 as "fully compatible"; the catalog contradicts both for TS 7. Follow the catalog.

Own scripts that `import "typescript"`: see `ts7-compat` (`alias-scheme.md`). Vitest: put `vitest/globals` in `types` (see `config-migration.md`). Next.js: keep `plugins: [{ "name": "next" }]`; build type-check runs through the resolved `typescript`.

## What to leave on TS 6

Keep TS 6 (via the alias scheme, not a second repo) for: template checkers, typescript-eslint until it supports 7.x, ts-morph, declaration bundlers, and any script using `ts.createProgram`/`ts.factory`. Run only `tsc` as the native compiler.

## Project references

Pick one pattern per repo.

- Paths (`paths` aliases to `./packages/x/src/index.ts`, `moduleResolution: bundler`): best when packages are built together as one app. Map both `@org/x` and `@org/x/*`. No `tsc -b` needed.
- References (`tsc -b`): best for published libraries or strict package boundaries. Root `tsconfig.json` has `"files": []` and a `references` list; each package sets `composite: true`, `declaration: true`, `declarationMap: true`, `outDir`, and an explicit `rootDir` (its default changed, see `config-migration.md`).
- Native `tsc --build` parallelism flags (`--builders`, `--checkers`, `--singleThreaded`) are experimental; measure before adopting.

Turborepo wiring (from the source skill; adapt names to the repo):

```json
"tasks": {
  "type-check": { "dependsOn": ["^type-check"], "outputs": [".cache/tsbuildinfo/**"] },
  "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] }
}
```

`tsBuildInfoFile`: set per package, e.g. `.cache/tsc/<package>.tsbuildinfo`, so `outputs` can cache it and `.cache/` is gitignored. Delete stale `*.tsbuildinfo` when results differ between local and CI.
