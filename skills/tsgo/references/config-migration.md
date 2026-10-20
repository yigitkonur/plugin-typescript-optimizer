# Config Migration for TypeScript 7

Loaded by the `tsgo` skill when a tsconfig uses options that TypeScript 7 rejects or whose defaults changed (findings tc-01, tc-02, tc-03).

Source: `catalog/removed-options.json` and `catalog/defaults-changes.json` (observed on tsc 7.0.2, 6.0.3, 5.9.3 on 2026-10-20). Prefer the catalog over memory when they disagree.

## Removed or changed options (tc-01)

| Option / value | TS 7 diagnostic | Fix | Mode |
|---|---|---|---|
| `target: es5` | TS5108 | `ES2022` (apps) or `ES2020` (libraries); legacy-browser output belongs to SWC/esbuild/Babel | assisted |
| `target: es3` | TS6046 (invalid value) | same as es5 | assisted |
| `downlevelIteration` (true or false) | TS5102 | delete the key | auto |
| `moduleResolution: node` / `node10` | TS5108 | `bundler` or `nodenext` (matrix below) | assisted |
| `moduleResolution: classic` | TS5108 | `bundler` or `nodenext` | assisted |
| `baseUrl` | TS5102 | remove; rewrite `paths` (next section) | assisted |
| `module: amd / umd / system` | TS5108 | `esnext` or `preserve` (bundled), `nodenext` (Node) | assisted |
| `module: systemjs / none` | TS6046 (invalid value) | same as above | assisted |
| `alwaysStrict: false` | TS5108 | delete the key (`true` is still accepted) | assisted |
| `esModuleInterop: false`, `allowSyntheticDefaultImports: false` | TS5108 | remove or set `true`; fix `import x = require()` call sites | assisted |
| `outFile` | TS5102 | bundle with a bundler; tsc only type-checks or emits declarations | assisted |

Group `removed-in-5.5` (already fail on TS 5.5 and later with TS5023, not a TS 7 change): `noImplicitUseStrict`, `keyofStringsOnly`, `suppressExcessPropertyErrors`, `suppressImplicitAnyIndexErrors`, `out`, `charset`, `importsNotUsedAsValues`, `preserveValueImports`, `noStrictGenericChecks`. Delete them; replace the two import options with `"verbatimModuleSyntax": true`. Never attribute these to TS 7.

`ignoreDeprecations`: on TS 6.0 `"6.0"` silences TS5101/TS5107. On TS 7 it is accepted but silences nothing (TS5102/TS5108 remain). Do not add it as a fix.

Native tsc 7.0.2 stops after configuration errors without type-checking. To see type errors early, test with a scratch tsconfig outside the repo that overrides the offending options; never edit the project to probe.

## baseUrl to paths (tc-02)

Resolve every `paths` value relative to the tsconfig, with a leading `./`. Then delete `baseUrl`.

```jsonc
// before: "baseUrl": ".", "paths": { "@/*": ["src/*"] }
"paths": { "@/*": ["./src/*"] }
```

- Monorepo package mappings: map both the bare name and the subpath: `"@org/core": ["./packages/core/src/index.ts"]`, `"@org/core/*": ["./packages/core/src/*"]`.
- Bare imports that resolved only through `baseUrl` (`import x from "utils/format"` with `baseUrl: ./src`): find them with `git grep -nE "from ['\"](utils|components)/"` (adapt names to the top-level folders of the old base). Fix by either rewriting to an `@/` alias or adding an explicit wildcard, `"utils/*": ["./src/utils/*"]`. Prefer the alias; bare wildcards re-create the old clash with npm package names.
- Bundlers and test runners keep their own alias config (Vite, Webpack, Jest `moduleNameMapper`); update them to match, since they no longer inherit `baseUrl`.

## module / moduleResolution matrix

| Project | module | moduleResolution | Notes |
|---|---|---|---|
| Bundled app or library (Vite, Next.js, Webpack, Rollup, esbuild) | `esnext` or `preserve` | `bundler` | extensionless relative imports allowed; honours package `exports` |
| Node ESM package (`"type": "module"`) | `nodenext` | `nodenext` | relative imports need explicit `.js` (`./helper.js`, even for `.ts` files) |
| Node CommonJS package | `nodenext` (or `commonjs`) | `nodenext` | the source skill suggests `node16`/`commonjs`; reported by the source skill, prefer `nodenext` and verify with the compiler |

Set `resolveJsonModule: true` when importing `.json`. After switching to `nodenext`, check declaration output matches the package format.

## Target by archetype

Apps (Next.js, Vite, Node 20+, Workers): `ES2022` (or `ESNext`). Cross-platform libraries and CLIs: `ES2020`. Set `lib` to match (`["DOM", "DOM.Iterable", "ESNext"]` for browser code).

## Default changes (tc-03)

Most flipped in TS 6.0, so a project already on 6.x sees no delta. Set each explicitly instead of relying on either default.

| Option | Old default | New default | Symptom | Fix |
|---|---|---|---|---|
| `strict` | false | true | new TS7006/TS2531/TS2564 errors | set `true` and fix, or `false` plus individual flags |
| `types` | every `@types/*` | `[]` | TS2591/TS2580/TS2304 "Cannot find name 'process'" | list them: `["node", "vitest/globals"]`; `["*"]` restores old behaviour |
| `module` | commonjs/es2015 | `esnext` | TS1202 on `import x = require()`, TS1203 on `export =` | set explicitly |
| `rootDir` | common source dir | tsconfig dir | `dist/src/a.js` layout, TS5011, TS6059 | set `rootDir` (usually `./src`) |
| `target` | ES5 | latest stable ES before esnext | fewer errors, un-downlevelled syntax | set explicitly |
| `noUncheckedSideEffectImports` | false | true | `import "./x.css"` TS2882 | add `declare module "*.css"` or set `false` |
| `libReplacement` | true | false | `@typescript/lib-*` ignored | set `true` if used |
| `stableTypeOrdering` | false | true | union member order differs in messages and `.d.ts` | nothing; compare diagnostics by code and file, never `.d.ts` text |
