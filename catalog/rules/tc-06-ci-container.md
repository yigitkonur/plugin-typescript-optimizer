---
schema: ts-optimize/rule@1
id: tc-06
version: 1
name: CI and container hygiene
domain: toolchain
batch: null
wave: "T4"
severity: warn
fix_risk: low
fix_mode: assisted
grain: project
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:ci-container"
downgrade_in: {node-options-flags: advisory}
primary_over: []
sources: ['UG cicd-container-optimization.md', 'UG memory-and-oom-prevention.md', 'UG common-migration-pitfalls.md (Pitfall 5)', 'doc 05 §8.3 step 4', 'doc 05 §8.4 T4']
---
## What
CI and container configuration that fights the native compiler or the Node tools around it. Detection reads `.github/workflows/*`, `.gitlab-ci.yml`, `Dockerfile*` and wrangler build settings. Sub-kinds:
1. **Worker-incompatible `NODE_OPTIONS`**: `--v8-pool-size` or `--max-semi-space-size`. The source skill reports that Node worker threads (Next.js, Vitest) reject them with `ERR_WORKER_INVALID_EXEC_ARGV`. This is **reported by the source skill; verify in your CI**: the sub-kind is `advisory`. Keep `--max-old-space-size` for the Node tools that remain.
2. **`GOMAXPROCS`**: the Go runtime detects all host CPUs, so a container with a cgroup CPU quota can over-subscribe. Set it to the quota **only when a quota is detected**; otherwise leave it alone.
3. **Stale caches**: committed or restored `*.tsbuildinfo` (and `.cache/tsc`) keep errors for deleted files or pass locally and fail in CI.
4. **Bare `npx tsc`** in CI steps: when `tsc` is not installed locally it fetches the obsolete registry package `tsc@2.0.4`. Use the package manager's exec or the direct bin.
5. Monorepo concurrency: native flags `--checkers` and `--builders` exist and are documented as experimental; propose them only with measured benefit from `fit`.
The source's memory tables and wall-clock benchmarks are not repeated; the plugin measures your project.

## Triage
Deterministic from file evidence. Keep when the flag is conditional on a legacy job that still runs TypeScript 6 only, or a Docker layer deliberately caches `.tsbuildinfo` with an explicit key. A `GOMAXPROCS` finding needs the quota evidence (cgroup file or the CI provider's documented vCPU count) quoted in the finding.

## Proposed change
In `{{file}}` ({{package}}):
```diff
-env:
-  NODE_OPTIONS: "--max-old-space-size=4096 --v8-pool-size=16"
+env:
+  NODE_OPTIONS: "--max-old-space-size=3584"
```
```diff
-      - run: npx tsc --noEmit
+      - run: pnpm exec tsc --noEmit        # or: pnpm run type-check
```
Add `.cache/` and `*.tsbuildinfo` to `.gitignore`, point `tsBuildInfoFile` at the cache (tc-08), and clear stale files: `rm -rf .cache/tsc *.tsbuildinfo`. For quota-limited runners, `export GOMAXPROCS=<vCPUs>`. Align the step order with the gate: typecheck, lint, test, build.

## Verification
T4 legs: the full six tiers on the authoritative (now native) compiler locally. CI files cannot be executed here, so the finding records the evidence and the verification command for the user's pipeline run; the plugin never edits secrets or pipeline variables.

## Pitfalls
- Removing a flag from `NODE_OPTIONS` also removes it for tools that did use it; check which step needs the larger heap.
- A repo-level `NODE_OPTIONS` in `.npmrc`-style or Dockerfile `ENV` affects every step; scope the edit to the failing step.
- Do not invent memory budgets or CPU counts; quote the CI provider's documented limits.
- Cloudflare Workers Builds and similar hosts have their own invariants (shard count, installed Node); read their settings before assuming GitHub Actions behaviour.
