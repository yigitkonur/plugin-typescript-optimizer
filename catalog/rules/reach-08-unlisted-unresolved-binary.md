---
schema: ts-optimize/rule@1
id: reach-08
version: 1
name: Unlisted dependency, unresolved import or unlisted binary
domain: reachability
batch: 1
wave: null
severity: hard
fix_risk: medium
fix_mode: flag-only
grain: package
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [K]
requires: {}
adapter: knip:unlisted
downgrade_in: {binaries: warn}
primary_over: []
sources: ['CLS Batch 1 (unlisted)', 'FPT §7 (binaries)', 'knip-configuration §7 (rules matrix)']
---
## What
Knip `unlisted` (imported but not in `package.json`), `unresolved` (a specifier that cannot be resolved) and `binaries` (a CLI used in scripts but not provided by any dependency). `hard` for unlisted and unresolved because the build can break on a clean install; `warn` for binaries. A human decides between adding the dependency and deleting the import, so this rule never schedules a wave.

## Triage
Deterministic: the engine output is the evidence, but resolve the config-shaped false positives before showing a finding. Keep (codify, do not change code) when:
- Virtual or platform specifiers: `cloudflare:workers`, `cloudflare:test`, `virtual:*` (Vite), `astro:*`, `$app/*`/`$lib/*` (SvelteKit), `node:*`.
- Path aliases and `tsconfig` `paths` Knip could not map, or a workspace package reachable through a protocol (`workspace:*`).
- Host binaries that are not packages: `docker`, `docker-compose`, `git`, `gh`, `curl`, `jq`, shell builtins: `ignoreBinaries`.
- A dependency hoisted from the workspace root and declared there.
Only after those are excluded does the item reach the human.

## Proposed change
Suggested diff shape only (nothing is applied by the plugin). For `{{symbol}}` imported in `{{file}}` ({{package}}):
```diff
 "dependencies": {
+  "{{symbol}}": "<range matching the version already resolved in the lockfile>"
 }
```
or delete the dead import if reach-01/reach-02 show the importing code is itself unreferenced. For an unresolved specifier fix the path or the alias; for a binary add the owning package to `devDependencies` or list it in `ignoreBinaries`.

## Verification
After the human's change: install with the frozen-lockfile check, typecheck, and a Knip rescan showing the item gone. No wave gate applies because the plugin makes no edit.

## Pitfalls
- Never auto-add a package from an import string: typosquatting and wrong-name resolution are supply-chain risks; show the proposed name and version and let the human confirm.
- `unresolved` right after wave 1 can be a deletion mistake: check whether the missing target was removed in this run before blaming the importer.
- A package imported only by files that wave 1 will delete should not be added; resolve ordering first.
