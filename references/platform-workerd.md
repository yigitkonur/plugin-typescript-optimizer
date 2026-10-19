# Cloudflare Workers (workerd): invariants for cleanup

Backs plat-01, plat-02 and the `workerd` pack (`catalog/packs/workerd.json`). The pack is active when `wrangler.json|jsonc|toml` exists or `wrangler`, `@cloudflare/workers-types` or `@cloudflare/vitest-pool-workers` is a dependency. It reads `main`, `compatibility_date`, `compatibility_flags`, `durable_objects.bindings[].class_name`, `workflows[].class_name`, service bindings and queue consumers, and supplies the protected set below.

Workers run on `workerd` (V8 isolates), not Node. Node-minded static analysis and cleanup agents commonly: delete entry points and RPC classes no local file imports; delete ambient types or `@cloudflare/workers-types`; assume `process.env` holds bindings; and strip `ctx.waitUntil`.

## 1. Protected: entry points and RPC classes

The platform invokes these; no local import exists.

- Default export implementing `ExportedHandler<Env>`: `fetch`, `scheduled`, `queue`, `email`, `tail`. Never remove `export default` or a handler method, even if nothing in the repo calls it (cron triggers and queues call it).
- Classes extending `DurableObject`, `WorkerEntrypoint`, `WorkflowEntrypoint` (from `cloudflare:workers`), registered by name in wrangler (`durable_objects.bindings[].class_name`, `workflows[].class_name`, service-binding entrypoints) and exported from the entry module.
- Knip will report these as unused exports or dead files. The verdict is false positive. Codify, in order of preference:
  1. explicit `entry` for the file(s) containing registered classes (the pack computes these from wrangler);
  2. `/** @public */` on the class together with `includeEntryExports` true, if the project's policy wants entry exports verified;
  3. leave `includeEntryExports` at default (false), which already treats entry-file exports as public.
- Whether Knip's `wrangler` plugin covers Durable Object/Workflow classes beyond `main` is unconfirmed. Do not rely on it; the pack adds the entries.

## 2. Protected: ambient types and test harness

- `worker-configuration.d.ts` (output of `wrangler types`) and `env.d.ts` contain `interface Env` with no `import`/`export`. Knip flags them as unreferenced files. Never delete; this is the one permitted single-file Knip `ignore` (see `knip-pitfalls.md`). Any `.d.ts` named by tsconfig `include`/`files`/`types` is protected the same way.
- `@cloudflare/workers-types` is consumed only via tsconfig `compilerOptions.types` (for example `@cloudflare/workers-types/2023-07-01`); Knip reports it as an unused devDependency. `ignoreDependencies`.
- `@cloudflare/vitest-pool-workers` is consumed by vitest pool options and the virtual module `cloudflare:test`. `ignoreDependencies`. Never delete `cloudflare:test` imports; keep the vitest plugin enabled.
- `.wrangler/**` is build state: exclude with a negation glob, not `ignore`.

## 3. process.env (plat-01), corrected

The source claimed `process.env` is never populated in workerd. That is wrong for current runtimes.

- With `nodejs_compat` active and `compatibility_date` on or after 2025-04-01 (or the flag `nodejs_compat_populate_process_env`), `process.env` is populated with vars, secrets and version metadata. It does NOT contain bindings (KV, D1, R2, Queues, service bindings, Durable Object namespaces); those exist only on `env`.
- `nodejs_compat` is also treated as implicitly enabled for compatibility dates on or after 2026-08-04 (Cloudflare docs, checked 2026-10-19). Treat both the implicit date and the exact name of the opt-out flag as unverified; when the config does not settle it, `process_env_populated` is `unknown`.
- The pack sets `process_env_populated` to `true`, `false` or `unknown`, and plat-01 severity follows it: `false` is hard, `unknown` is warn, `true` is advisory.
- Without `nodejs_compat`, or with an older compatibility date and no flag, `process.env` is not populated, so reading `process.env.X` yields `undefined` or fails. That is the real defect.
- Fix pattern (assisted, never auto): thread `env` from the handler, or use `this.env` in `DurableObject`/`WorkerEntrypoint`/`WorkflowEntrypoint` classes. Build clients in a function taking `env`, not at module scope.
- Scope: only under worker packages. Exclude config, build scripts, tests and tooling by path class; never decide "test" by substring (`latest`, `contest`).
- Introducing a new `process.env` in a worker file is blocked by `commit-guard` unless `process_env_populated` is `true`.

## 4. ctx.waitUntil and floating promises (plat-02)

- When the promise returned by `fetch` settles, workerd may suspend the isolate; un-awaited background work (queue sends, logging, metric writes, KV/R2 puts) can be cancelled.
- Background work that must outlive the response goes in `ctx.waitUntil(promise)`. Always attach error handling inside the promise.
- `ctx.waitUntil(...)` calls are protected. Never remove, inline or unwrap them as "redundant wrapper bloat". `commit-guard` blocks a diff that lowers the count of `ctx.waitUntil(` in a file without raising it.
- plat-02 detects a statement-level call to `env.<BINDING>.<send|put|delete|run|batch>` in a function with an `ExecutionContext` parameter, preferring tsgolint `no-floating-promises` when present. It is advisory/warn, `assisted`, never auto. Not applicable inside Durable Objects, which are kept alive by their own lifecycle.
- Do not run lint autofixes that prefix promises with `void` (see `lint-bridge.md`).

## 5. Cleanup triage matrix

| Finding | Cause in Workers | Verdict and action |
|---|---|---|
| Unused export: DO / WorkerEntrypoint / Workflow class | bound in wrangler, not imported | false positive; explicit `entry` or `@public` plus `includeEntryExports` policy |
| Unused file: `worker-configuration.d.ts`, `env.d.ts` | ambient, generated by `wrangler types` | false positive; protected; single-file `ignore` |
| Unused devDependency: `@cloudflare/workers-types` | referenced from tsconfig `types` | false positive; `ignoreDependencies` |
| Unused devDependency: `@cloudflare/vitest-pool-workers` | vitest pool options | false positive; `ignoreDependencies` |
| `process.env.X` in handler code | Node assumption | true defect if `process_env_populated` is false, warn if unknown; env is for vars/secrets only |
| `ctx.waitUntil(...)` | lifecycle contract | invariant; never touch |
| Unused handler method `scheduled`/`queue`/`email`/`tail` | invoked by platform | false positive |

## 6. Gate and test notes

- `@cloudflare/vitest-pool-workers` tests run real workerd isolates; a green `test` leg is meaningful for Workers code. A repo with no tests limits the run to waves `B` and `4` (see `gate-spec.md`).
- Regenerate ambient types only with the project's own script (`wrangler types`), never by hand.
