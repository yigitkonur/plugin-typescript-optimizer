---
schema: ts-optimize/rule@1
id: tc-01
version: 1
name: Removed or changed compiler options
domain: toolchain
batch: null
wave: "T1"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: file
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:removed-options"
primary_over: []
sources: ['UG removed-compiler-options.md', 'UG es5-deprecation-and-targets.md', 'UG module-resolution-modernization.md', 'doc 05 §8.3 and §8.4', 'doc 08 §3 defect 7', 'TS 7.0 announcement']
---
## What
A resolved tsconfig (the whole `extends` chain, every `tsconfig*.json` in the package) sets an option that the TypeScript 7 native compiler rejects. Data: `catalog/removed-options.json`. **Hard errors in 7:** `target: "es5"` (ES3 likewise), `downlevelIteration`, `moduleResolution: "node"` / `"node10"` / `"classic"`, `baseUrl` (rewritten by tc-02), `module: "amd" | "umd" | "system" | "systemjs" | "none"`, `alwaysStrict: false`. **Long-removed, still flagged:** `noImplicitUseStrict`, `keyofStringsOnly`, `suppressExcessPropertyErrors`, `suppressImplicitAnyIndexErrors`, `out`, `charset`. Attribution matters: the second group was removed in TypeScript 5.5, not by TS 7; a project that passes today either does not load them (config outside the typecheck set) or hides them with `ignoreDeprecations`. Each is reported with `file:line`. The changed defaults (`strict`, `types`, `module`, `rootDir`) are tc-03, not this rule.

## Triage
Deterministic: the evidence is the resolved option itself, so candidates are `confirmed` without an agent. Keep only when the option sits in a config that no tool of this repository loads (an archived example) or the project deliberately stays on TypeScript 6 (then the whole `tsgo` adoption is out of scope).
Choice points the agent must still decide at fix time: the `target`, `module` and `moduleResolution` replacements depend on the project archetype.

## Proposed change
In `{{file}}` ({{package}}):
- Pure removals (`noImplicitUseStrict`, `keyofStringsOnly`, `suppressExcessPropertyErrors`, `suppressImplicitAnyIndexErrors`, `out`, `charset`, `downlevelIteration`, `alwaysStrict: false`): delete the key. Replacements for `out` (`outFile` or a bundler) and `suppressImplicitAnyIndexErrors` (explicit index signatures or `Record<string, unknown>`) need a look.
- `target`: `ES2022` by default (Next.js, Vite, Node 20+, Workers; `lib: ["DOM", "DOM.Iterable", "ESNext"]` for browser code, `["ESNext"]` for Node/Workers); library or CLI published for wide use: `ES2020`. Add `useDefineForClassFields: true` when a transpiler (esbuild/SWC) handles class fields. Legacy browser support is a downstream job (Babel, SWC, browserslist).
- `moduleResolution`: bundled apps and libraries (Vite, Next.js, Turbopack, webpack, Rollup, esbuild, Rolldown): `"module": "ESNext"` with `"bundler"`. Node ESM packages: `"module": "NodeNext"` with `"NodeNext"` (relative imports then need explicit `.js` extensions). Node CommonJS packages: `"module": "commonjs"` with `"node16"`. Set `resolveJsonModule` when importing `.json`.
```diff
 { "compilerOptions": {
-  "target": "es5", "downlevelIteration": true, "module": "amd", "moduleResolution": "node",
+  "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
 } }
```

## Verification
T1 legs: the authoritative typecheck still passes (the change must be valid on TS 6 as well), then the fit probe re-run reports zero removed-option candidates and native diagnostics did not grow. `nodenext` migrations also need test and build to pass because extension changes touch source imports.

## Pitfalls
- Never silence a removal with `ignoreDeprecations`; that hides the option from TS 6 and still fails on 7.
- `nodenext` is a source change (`./x.js` specifiers) across the package; split it from pure removals.
- A shared base config edited in one package changes every package extending it; scope the unit to the config file and list the extenders in `touches`.
- Unsourced speed claims about dropping ES5 are not repeated here; the plugin measures your project (`ts-opt fit`).
