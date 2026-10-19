---
schema: ts-optimize/rule@1
id: tc-05
version: 1
name: Transpile-runner hygiene
domain: toolchain
batch: null
wave: "T2"
severity: warn
fix_risk: low
fix_mode: assisted
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:transpile-runners"
primary_over: []
sources: ['UG bundlers-and-transpilers.md', 'UG compiler-api-strada.md (Strategy 2)', 'doc 05 §7 ecosystem table', 'doc 05 §8.4 T2']
---
## What
Runners and loaders that execute or transform TypeScript through the legacy JavaScript compiler API: `ts-node` (including `-r ts-node/register`, `--loader ts-node/esm`, `.mocharc` requires), `ts-loader` with custom transformers (`getCustomTransformers`), `ttypescript`, `ts-patch`, and `ts-jest`. Detection reads dependencies and scripts (`package.json` scripts, Jest/Mocha/webpack configs). Modern setups split the jobs: bundlers and transpilers (`esbuild`, SWC, Vite, Rolldown, tsx, Bun, Deno) strip types without type checking, and `tsc --noEmit` stays the dedicated authoritative type-check step. Type checking was never the runner's job.

## Triage
Deterministic from the dependency and script evidence. Keep when:
- The tool is used only inside a vendored or archived directory no script reaches.
- `ts-loader` runs with `transpileOnly` and no custom transformer (it still needs API access, but the replacement is lower priority).
Note which of these require the alias scheme (tc-04) instead of a replacement: a custom transformer that must keep running (for example a compiler plugin) cannot move to esbuild.

## Proposed change
In `{{file}}` ({{package}}), per consumer {{consumers}}:
- `ts-node` → `tsx` (esbuild-based, unaffected by TS 7): `npm install -D tsx`, then run scripts with `tsx scripts/my-script.mts`. Alternatives that need no dependency: `node --experimental-strip-types` (erasable syntax only, see type-08), Bun, or Deno.
- `ts-loader` with custom transformers → `swc-loader` or `esbuild-loader`; keep `tsc --noEmit` as the separate type-check script.
- `ttypescript` / `ts-patch` → remove; they patch the JS compiler that no longer exists in `typescript@7`.
- `ts-jest` → `@swc/jest` or vitest; or keep it behind the alias scheme.
```diff
 "scripts": {
-  "seed": "ts-node scripts/seed.ts",
+  "seed": "tsx scripts/seed.ts",
```
Add `"useDefineForClassFields": true` to the tsconfig when targeting modern class fields through esbuild. Remove the dependency and refresh the lockfile with the detected package manager. Scripts always run via `<pm> run` and tools via the direct bin or `<pm> exec`, never bare `npx`.

## Verification
T2 legs: every rewritten script runs once with real input; typecheck, test and build stay green on the authoritative compiler; lint leg starts. `git grep ts-node` returns nothing in scripts, configs and CI.

## Pitfalls
- `tsx` does not type-check, so a script that was "validated" by ts-node's type check loses that guarantee; `tsc --noEmit` must include the script directory.
- Decorator metadata (`emitDecoratorMetadata`) is not emitted by esbuild: Nest/TypeORM apps need SWC or the compiler for those entry points.
- Mixed ESM/CJS: `tsx` handles both but `ts-node` flags in Mocha/Jest configs must also be changed.
- Do not run `npx tsc` to check the result: it fetches an obsolete registry package when the local one is absent.
