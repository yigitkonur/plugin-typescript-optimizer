# Knip: version facts, config policy, pitfalls

Backs reach-01 to reach-09 and reach-12. Knip supplies the unused set only; importers/consumers come from the plugin's own importer index. Knip's JSON is read by the engine adapter; you rarely run Knip by hand. Do not hand-write Knip config in the user's repo.

## 1. Versions

| Fact | Knip 5 | Knip 6 |
|---|---|---|
| Parser | TypeScript compiler API | oxc (`oxc-parser`, `oxc-resolver`); no TS JS API needed |
| Runs on a TS 7 project | no, expected to crash (inferred from the v6 announcement; the probe decides) | yes |
| Node | older Node accepted | Node 20.19 or newer |
| `classMembers` rule | exists (set `off` for decorator-heavy code) | removed; never enable it on v5 either |
| `namespaceMembers` rule | not in v5 | present |
| `--isolate-workspaces`, `--include-libs`, `--experimental-tags` | exist | removed; never pass them |
| JSON reporter | root `files` array | root `files` removed; every issue type is an array under `issues` |
| `--cycles` | probe; if unusable fall back to project madge/dpdm, then the built-in graph | primary source for struct-02 |

- Require Knip 6 on TS 7 projects; on TS 6 or older with Node below 20.19, Knip 5 is acceptable. Record the version in `run.json`.
- Use the version-aware reader; never assume a JSON shape.
- Unreliable claim from the source: Knip's wrangler plugin "only reads `main`". Not confirmed by Knip docs. Treat RPC and workflow classes as needing explicit `entry` by evidence (the workerd pack reads wrangler) until a fixture proves the plugin covers them.

## 2. Config policy: overlay, never the user's config

- If the user has a Knip config (`knip.json`, `knip.jsonc`, `.knip.json[c]`, `knip.ts`, `knip.js`, `knip.config.ts|js`, or `package.json#knip`): use it untouched. Never edit it.
- If none: zero-config first. Knip auto-detects workspaces and enables plugins from `package.json` dependencies. Do not generate per-framework `entry` lists or workspace maps; that duplicates plugins.
- Noise gate: if more than 25% of project files are reported unused, or zero entry points were found, or framework/RPC/ambient candidates exist that no config covers, emit one `reach-12` finding and hold back the noisy batch-2/3/5 candidates until an overlay is accepted.
- Overlay file: `.ts-optimize/knip.config.jsonc`, written only by `ts-opt knip-overlay --write` (bootstrap from detection) and refined by `ts-opt knip-overlay --from-verdicts --write` after triage. The next scan passes it via `--config`. It contains only what is proven needed. The user promotes it to `knip.jsonc` through an ordinary finding.
- Schema URL follows the installed major: `https://unpkg.com/knip@<major>/schema-jsonc.json`.

## 3. Where a false positive is codified (in this order)

1. Knip: `entry`, `project` negation globs, `ignoreDependencies`, `ignoreBinaries`, `ignoreExportsUsedInFile`, plugin enablement (`"next": true`, `"vitest": true`, ...).
2. The project's lint engine: the `_` convention (`argsIgnorePattern`, `caughtErrorsIgnorePattern`, `varsIgnorePattern`).
3. `tsconfig`.
4. The coverage engine's ignore-files list.

Never a broad top-level `ignore`.

## 4. Why broad `ignore` is forbidden

A glob in top-level `ignore` removes those files from Knip's walker and graph entirely.

- If `A.ts` imports `B.ts` which imports `lodash`, ignoring `B.ts` makes `lodash` an unused dependency.
- If `B.ts` is the only importer of `C.ts`, `C.ts` is reported dead, and may be deleted.
- Ignored files rot: dead imports accumulate with no CI signal.

The only permitted `ignore` entries are single, import-less ambient `.d.ts` files (for example `worker-configuration.d.ts`). This resolves a contradiction in the source (two canonical Worker configs, one protecting that file via `entry`, one via `ignore`).

Targeted alternatives:

| Situation | Do |
|---|---|
| generated code with unused types | `entry` for the file with `includeEntryExports` left at default, or negation glob `!src/generated/**` in `project` |
| test helpers flagged | include test globs in `project` or enable the test-runner plugin |
| tailwind/postcss/babel packages flagged unused | enable the plugin (`"tailwind": true`) or `ignoreDependencies` |
| types used only in their own file | `ignoreExportsUsedInFile: { interface: true, type: true }` (granular per kind; leave `variable`, `function`, `class` false) |
| file truly dead | delete it; never ignore it |

## 5. Entry exports, `!`, production

- `includeEntryExports` defaults to false: exports of `entry` files are treated as public API and not reported. Setting it true makes Knip verify entry exports; then mark real public API with `/** @public */` and keep `tags` consistent (`-internal` hides `@internal` symbols; `+public` reports only `@public`).
- A trailing `!` on an entry (`"src/index.ts!"`) means "production code" for `--production` mode. It does NOT mean "public API" and does not change export reachability. Do not add `!` to silence reports.
- `--production` excludes devDependencies, tests, stories and dev scripts from the graph. reach-03 compares a default run against a `--production` run: an export reported in the production run but not in the default run is used only by non-production files (test-only leak).
- If `package.json#exports|main|types` point at `dist/**`, point `entry` at the matching `src/**` files.

## 6. Workspaces

- Knip 6 isolates workspaces by default. Let it auto-detect; run per workspace root.
- Declared-in-root-only dependencies used by a workspace show as `unlisted`; that is a real finding (reach-08, flag-only: the human chooses add vs delete).
- Importing a sibling's internal file (`@repo/ui/src/button.ts`) bypasses its `exports` map; keep library `entry` to the public entry points.
- `pnpm-workspace.yaml` entries starting with `!` are exclusions; honour them.
- A `workspace:*` dependency with no imports is reported as an unused dependency: correct.

## 7. Other facts worth knowing

- Compilers for Astro, MDX, Svelte and Vue are built in (`"compilers": { "vue": true, ... }`). Never supply identity functions or regex "compilers": raw markup reaching the JS parser causes parse errors.
- Rules take `error | warn | off`. Useful triage severities: `binaries` warn, `exports`/`types` warn, `nsExports`/`nsTypes`/`enumMembers` off.
- Binaries invoked in scripts that are host tools (`docker`, `git`, `gh`, `curl`, `jq`, `which`, shell builtins) go in `ignoreBinaries`. Packages used only via `node -r`/`--loader` (`dotenv/config`, `source-map-support/register`, `ts-node`) go in `ignoreDependencies`.
- Dynamic `import(\`./locales/${lang}.json\`)` cannot be resolved: add the folder to `entry` (never `ignore`), after `rg 'import\s*\('` finds the pattern.
- The engine's fixer is used only as a scoped bulk optimisation under the conditions in the commit policy (`batched` granularity, every finding of that fix type approved, dry re-scan equals approved set). Never the unscoped `--fix`; a bare `knip --fix` is blocked by `cmd-guard`.
- Every deletion must pass the Three-Question Test first (`skills/audit/references/triage-protocol.md`).
