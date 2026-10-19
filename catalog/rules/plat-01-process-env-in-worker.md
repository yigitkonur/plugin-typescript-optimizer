---
schema: ts-optimize/rule@1
id: plat-01
version: 1
name: process.env read in worker code
domain: platform
batch: null
wave: "R"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: file
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [R, X]
requires: {pack: workerd}
tells:
  - {id: t1, regex: '\bprocess\s*\??\.\s*env\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/scripts/**', '**/tools/**', '**/build/**', '**/test/**', '**/tests/**', '**/__tests__/**', '**/e2e/**', '**/*.{test,spec}.*', '**/{vite,vitest,tsup,rollup,webpack,esbuild,eslint,jest,playwright,drizzle,prisma,tailwind,postcss,next,astro,svelte}.config.*']}
downgrade_in: {process_env_populated_unknown: warn, process_env_populated_true: advisory}
primary_over: [type-05]
sources: ['SK Priority Section §3', 'CFW §4', 'FPT §5.4', 'doc 05 §6 (process_env_populated, corrects the absolute claim)']
---
## What
A `process.env.X` read in code that runs inside workerd. Bindings (KV, D1, R2, queues, service bindings) never live on `process.env`; vars and secrets do only when the pack reports `process_env_populated: true` (Node compatibility effective and compatibility date >= 2025-04-01 or the populate flag). Severity follows the pack: `hard` when `false`, `warn` when `unknown`, `advisory` when `true` (reading a var still works but is a Node habit that hides the `Env` contract).

## Triage
Keep when:
- The pack says `process_env_populated: true` **and** the read is a var or secret, never a binding (advisory only; still prefer `env`).
- The file is build-time or tooling code: bundler config, scripts, seed/migration tools, test setup. The tell already excludes these by path *segment* and file-name class (`scripts/`, `test/`, `*.spec.*`, `vite.config.*`); it is **not** a substring test, so `src/latest/handler.ts` is production code and is scanned.
- `process.env.NODE_ENV` that the build replaces statically (`define`); confirm in the bundler config, not by guessing.
- The read sits in a dependency that the repo does not own (vendored code): report, do not edit.

Three-question notes: Q1 the handler is invoked by the platform, so `env` arrives as a parameter or `this.env`; Q2 check string-keyed access (`process.env[name]`); Q3 shared libraries consumed by both Node and worker packages need an `env`-accepting seam, not deletion.

## Proposed change
In `{{file}}` ({{package}}), replace each read listed in `{{members}}` with a request-scoped value:
- Module functions: add an `env: Env` parameter and thread it from `fetch(request, env, ctx)`; update the call sites in `{{consumers}}`.
- `DurableObject` / `WorkerEntrypoint` / `WorkflowEntrypoint` classes: use `this.env.NAME`.
- Module-scope reads (`const KEY = process.env.KEY`) move into the function that needs them; do not cache `env` in a module variable.
Add the missing field to `Env` only through the generated `worker-configuration.d.ts` (`wrangler types`), never by hand-editing it.

## Verification
Legs: typecheck (the `Env` member must exist), test (including the workers pool when present), build. Extra proof: `rg -n 'process\.env' {{file}}` returns nothing outside excluded path classes, and wrangler `vars`/secrets declare every name that was read. Commit-guard edit pattern (c) refuses an **added** `process.env` in a worker file when the pack is not `true`.

## Pitfalls
- Do not "fix" by adding `nodejs_compat` to wrangler: that changes the runtime for the whole worker and is a user decision.
- Do not delete `worker-configuration.d.ts` or `@cloudflare/workers-types` while tidying `Env`.
- `process.env` reads inside `try/catch` fallbacks may hide a deliberate default; keep the default, change only the source.
- A read like `process.env[name]` with a dynamic name needs the list of names before conversion; stop and ask rather than guess.
