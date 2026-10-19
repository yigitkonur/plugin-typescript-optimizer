---
schema: ts-optimize/rule@1
id: reach-12
version: 1
name: Knip configuration needed
domain: reachability
batch: null
wave: null
severity: warn
fix_risk: low
fix_mode: flag-only
grain: project
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [K, G]
requires: {}
adapter: meta:noise-gate
primary_over: []
sources: ['FPT §2-§7, §10', 'knip-configuration §8', 'doc 06 §9.2 and §12 (noise gate, overlay)', 'doc 08 defect 5']
---
## What
A meta finding raised by the noise gate before dead-code candidates are trusted. After a zero-config Knip pass it trips when more than 25 % of project files are reported unused, when no entry points were found, or when framework, RPC or ambient candidates exist that no config covers. It carries one overlay proposal; the noisy batch 2/3/5 candidates are suppressed from the plan until an overlay is accepted. The plugin never writes into the user's Knip configuration.

## Triage
The agent confirms each proposed entry against the repository before it goes into the overlay. Keep the overlay minimal, proven entries only:
- `entry` for framework route globs and registered RPC classes (Durable Object, `WorkerEntrypoint`, `WorkflowEntrypoint` named in wrangler), dynamically imported folders, scripts named in `package.json`.
- `ignoreDependencies` for config-referenced packages (postcss/tailwind/babel presets, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `-r`/`--loader` modules); `ignoreBinaries` for host tools; `ignoreExportsUsedInFile: {interface: true, type: true}` only when the user's policy says so.
- A single-file `ignore` only for an import-less ambient `.d.ts` (`worker-configuration.d.ts`, `env.d.ts`).
Reject: a broad top-level `ignore` (it severs graph edges: files the ignored code imports then look dead, its dependencies look unused). A trailing `!` on an entry means "production" for `--production`, not "public API". Do not copy generated workspace maps or per-framework entry lists; Knip's plugins already do that.

## Proposed change
Suggested shape only. The overlay is written to `.ts-optimize/knip.config.jsonc` by `ts-opt knip-overlay --write` (bootstrap, from detection) and refined by `--from-verdicts --write`; scans then run with `--config` pointing at it:
```jsonc
{
  "entry": ["src/index.ts", "src/objects/**/*.ts"],     // wrangler-registered RPC classes
  "ignoreDependencies": ["@cloudflare/workers-types"],
  "ignoreBinaries": ["docker", "gh"]
}
```
Promoting it to the user's `knip.jsonc` is an ordinary, separately approved finding in `{{package}}`.

## Verification
`ts-opt scan --rescan-engine knip` after the overlay: unused-file ratio drops below the gate, entry points are found, and the candidates that vanished are recorded as confirmed false positives. Candidates that remain are still open.

## Pitfalls
- Two source Worker configs protected `worker-configuration.d.ts` by `entry` in one and `ignore` in the other; the single-file ambient `ignore` is the only allowed form.
- Knip v5 and v6 differ in rule names and JSON shape; the adapter reads both, the overlay must not assume one.
- Do not "fix" the noise by deleting what the engine lists; reach-01 stays suppressed until the gate passes.
