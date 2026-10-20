# 05 — Runtime detection, engine resolution, tsgo strategy, degradation

Nothing here is configured by the user. Every fact is **probed** (file checks, `--version`, a ≤ 5 s smoke
invocation) and recorded in `run.json.env`; code never branches on a guessed version. Detection output is cached
in `.ts-optimize/.cache/detect.json`, keyed by the mtimes of every lockfile, `package.json`, `tsconfig*.json`,
workspace manifest, and `wrangler.*` it read; `detect --refresh` ignores the cache.

## 1. Repo root and "is there TypeScript here?" (the silence test)

**Root.** First hit of: `git -C <cwd> rev-parse --show-toplevel` → nearest ancestor containing `.git` (file or dir, so worktrees and submodules work) → highest ancestor containing a workspace marker (`pnpm-workspace.yaml`, `package.json` with `workspaces`, `lerna.json`, `nx.json`, `turbo.json`, `rush.json`) → nearest ancestor with `package.json` → `cwd`.

**Presence test** (used by `detect --brief`, the skills and `cmd-guard`; **not** by the hooks' prefilter, which only looks for `.ts-optimize/state/open-run`; budget ≤ 150 ms worst case on a 100 k-file index; spawns at most two `git` processes — `rev-parse`, `ls-files`):
1. `<root>/.ts-optimize/` exists → TypeScript = yes (a run was made here).
2. any `tsconfig*.json` directly in `<root>` or in a workspace package dir, or any `package.json` listing `typescript` in `dependencies|devDependencies|peerDependencies`, or a `packages/*`-style package with a `types|typings` field.
3. `git ls-files -z --cached --others --exclude-standard -- '*.ts' '*.tsx' '*.mts' '*.cts'` returns a non-`.d.ts` file (read the first record, then kill the process). Outside git: depth-limited (4) walk with the prune list, stop at the first hit.
No hit → `typescript: none`. Consequences are in §10: every hook exits 0 with no output; `audit`/`fix`/`tsgo` print one line (`No TypeScript found under <root>; nothing to do.`) and exit 3.

**Polyglot repos.** TypeScript may live in a subdirectory (`web/`, `frontend/`, `services/api`). Roots are *TS packages* (§2); everything downstream (PM, compiler, gate, scope) is per TS package. Python, Go, Rust, Swift sources are never read by any rule.

Prune list (never scanned): `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.svelte-kit`, `.astro`, `.turbo`, `.cache`, `.output`, `.wrangler`, `.vercel`, `.parcel-cache`, `storybook-static`, `.yarn`, `.pnp.*`, `.pnpm-store`, `vendor`, `.ts-optimize`, any dir listed in `.gitignore` (via git), plus anything in `config.scope.exclude`.

## 2. TS packages, tsconfig graph, and the typecheck set

A **TS package** = a directory with a `package.json` and (a `tsconfig*.json` or a `typescript` dependency), or — in repos without workspaces/package.json files — a directory with a `tsconfig.json`.

For each TS package:
1. `tsconfigs[]` = every `tsconfig*.json` and `jsconfig.json` in the dir.
2. **Resolve `extends`** per file: relative paths, bare package specifiers (`@tsconfig/node20`, resolved through `node_modules`), array form (later wins), depth ≤ 8, cycle-safe; unresolved links are recorded as `unresolved_extends` and shown in `doctor` (the source script reported "0 %" health for a correctly configured repo because it read only the leaf config; this design merges the chain).
3. Parse with JSONC (comments, trailing commas, BOM).
4. **Classify** each config: `solution` (`files: []` or no `include`, plus `references`), `project` (has `include`/`files`), `base` (only referenced via `extends`, e.g. `tsconfig.base.json`), `tooling` (name matches `*.node.json|*.vite.json|*.eslint.json`).
5. **Typecheck set** (what the gate and `check` run), in order of preference:
   a. a `solution` config → `[solution]` with `build: true` (`tsc -b`);
   b. configs named by `-p/--project/-b` in the package's `typecheck|type-check|check-types|tsc|check` script (and `build` script when it invokes `tsc`);
   c. `tsconfig.json`;
   plus `tsconfig.{test,spec}.json` and any `project`-class config not covered by an include-union with the others (compute coverage via `tsc --listFilesOnly` is **not** used; instead dedupe by identical `include` globs). The set is stored per package and shown in `doctor`; `config.json` can override with `gate.typecheck: ["tsconfig.app.json", …]`.
5b. **Script-defined typecheck.** If the package's typecheck/build script invokes a different checker — `vue-tsc`, `svelte-check`, `astro check`, `ngc`/`ng build`, `next build`, `nuxi typecheck`, `deno check` — that script is the authority for the leg (`variant: script`, command taken verbatim from the script, run through the package manager) and plain `tsc` is added only as a second leg if the package also has a `tsc`-based script. This is how single-file-component projects (Vue/Svelte/Astro) get a typecheck that can see their consumers. Deno projects (`deno.json`) get `deno check` and no Node-based engines.
6. **Signals** recorded: `strict`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `isolatedDeclarations`, `erasableSyntaxOnly`, `declaration`, `emitDeclarationOnly`, `composite`, `noEmit`, `allowJs`, `checkJs`, `target`, `module`, `moduleResolution`, `baseUrl`, `paths`, `types`, `rootDir`, `plugins`, `noUnusedLocals`. A key absent from the resolved chain is recorded as `null` (not `false`); the **TS 7 default flips** (`strict` true, `types` `[]`, `module` esnext, `rootDir` `./`) are applied by the fit probe, not by detection.
7. `declaration_signal` = any of `declaration|composite|isolatedDeclarations|emitDeclarationOnly` true, or the package's `package.json` has `types|typings|exports[*].types`, or `main/module/exports` point at `dist/**`. Drives the declaration-emit leg (§9).

## 3. Workspaces and monorepo orchestration

Workspace sources, all merged: `pnpm-workspace.yaml` `packages:` (mini-YAML; `!` entries are exclusions), `package.json#workspaces` (array or `{packages}`), `lerna.json#packages` (default `packages/*`), `rush.json#projects[].projectFolder`, Nx `project.json` files, `turbo.json` (indicator only). Globs are expanded with the mini-glob over directories that contain a `package.json`; exclusions applied last. If none of these exist but several `package.json` files exist one or two levels down, treat each as a package (flag `inferred_workspaces: true`).

Orchestrators detected for `gate.scope: "affected"`: `turbo` (`turbo run test --filter=...[<base>]`), `nx` (`nx affected -t test --base=<base>`), `pnpm` (`pnpm --filter "...[<base>]" run test`). Default is `full` (the source gate: whole `test` and `build`).

## 4. Package manager and how binaries are run

Order: `packageManager` field (Corepack pin; authoritative) → root lockfile (`pnpm-lock.yaml` → pnpm; `yarn.lock` → yarn, with `.yarnrc.yml` + (`nodeLinker: pnp` or `.pnp.cjs`) ⇒ **berry-pnp**; `bun.lock`/`bun.lockb` → bun; `package-lock.json`/`npm-shrinkwrap.json` → npm) → `deno.json[c]` + `deno.lock` ⇒ **deno** → `npm` if a `package.json` exists → `none`.

Running a tool: (1) direct `node_modules/.bin/<tool>` walking up from the package dir to the repo root (fast, no PM start-up, no Corepack prompt, immune to `npx` fetching a registry package); (2) berry-pnp: `yarn run <tool>`; (3) PM exec prefix as in the source gate (`pnpm exec`, `yarn run`, `bun x`, `npm exec --`); (4) **never bare `npx <tool>`** for a tool that might be absent (`npx tsc` fetches the obsolete `tsc@2.0.4`; `cmd-guard` blocks it). Scripts always use `pnpm run | yarn run | bun run | npm run` (`bun test` ≠ `bun run test`; `npm build` ≠ `npm run build`).

`none`/`deno`: Node-based engines are skipped, tells + tsconfig health still run, and the coverage table says why.

## 5. Compilers: authoritative, fast, API provider

For each TS package resolve `typescript` with Node resolution from the package dir (pnpm symlinks realpath'ed), then `<root>/node_modules`, then `tsc` on `PATH`.

| Field | Definition | Probe |
|---|---|---|
| `authoritative` | the `tsc` the package's own scripts would run (`node_modules/.bin/tsc`, else the PATH one) | `<bin> --version` (cached per bin path) |
| `authoritative.kind` | `native` if major ≥ 7; `js` if ≤ 6; `none` | version string |
| `fast` | first of: authoritative if `native`; project `node_modules/.bin/tsgo` (`@typescript/native-preview`, kind `native-preview`); toolbox `typescript-native` (`typescript@7`, only with toolbox consent); else `null` | `--version` |
| `api_provider` | the package named `typescript` if it exposes the JS API (`kind js`), including the `@typescript/typescript6` alias scheme; else `null` | `require.resolve` + a `ts.version`/`createProgram` check in a 2 s child process |

Support matrix for audited projects: TS 4.9–5.7 `js` (no `-b --noEmit`; use the emit-and-clean pattern), 5.8–6.x `js`, 7.x `native`, `@typescript/native-preview` nightlies. TS < 4.9: audit (tells, Knip) runs, gate typecheck runs the project's own compiler, but `doctor` prints `unsupported (tested ≥ 4.9)`.

**The `-b --noEmit` question is probed, not versioned.** First composite typecheck at baseline runs `<tsc> -b --noEmit`; a `TS5094` result marks the variant `emit-and-clean` (`tsc -b --emitDeclarationOnly` then `tsc -b --clean`), recorded in `run.json.gate.legs[].variant`. Same for `TS5053` (`--emitDeclarationOnly` with `--noEmit`) and `TS5065` (`--outDir` with `-b`).

## 6. Frameworks, runtime packs, generated code, scripts

**Frameworks** (from deps and config files; feed triage packs and the Knip overlay): `next`, `remix`/`react-router`, `astro`, `nuxt`, `sveltekit`, `nest`, `express|fastify|hono`, `vite`, `angular`, `expo|react-native`, `storybook`, test runners `vitest|jest|mocha|ava|playwright|cypress|node-test|bun-test`, `tailwind`, `postcss`, `prisma|typeorm|mikro-orm|drizzle`, `trpc`, `msw`, orchestrators. Pack data lives in `catalog/packs/frameworks.json`: entry conventions, route file names, special exports, decorator/reflection patterns, config-referenced dependencies (the source `false-positive-triage.md` §2–§7).

**Runtime pack `workerd`** active when `wrangler.json|jsonc|toml` exists or `wrangler|@cloudflare/workers-types|@cloudflare/vitest-pool-workers` is a dependency. It reads `main`, `compatibility_date`, `compatibility_flags`, `durable_objects.bindings[].class_name`, `workflows[].class_name`, `services`, queue consumers, and sets:
- `process_env_populated`: `true` when Node compatibility is effective **and** the `nodejs_compat_populate_process_env` behaviour applies. Node compatibility is effective when `nodejs_compat` is in `compatibility_flags` **or** `compatibility_date` ≥ 2026-08-04 (Workers enables `nodejs_compat` automatically from that date). The populate behaviour applies when `compatibility_date` ≥ 2025-04-01 or the flag `nodejs_compat_populate_process_env` is listed, unless an explicit opt-out flag is listed (**verify the opt-out flag's exact name against the Cloudflare compatibility-flags page at build time**; until verified, treat any flag containing `process_env` and `not`/`no` as an opt-out and mark the result `unknown`). `false` when Node compatibility is not effective or the date is earlier and the flag is absent; `unknown` when no wrangler config can be read. (Corrects the source's absolute "never populated"; Cloudflare docs, checked 2026-10-19: populated by default for compat dates ≥ 2025-04-01 with Node compat on; it contains vars, secrets and version metadata, not bindings.)
- `rpc_classes[]`, `entry_files[]`, `ambient_files[]` (`worker-configuration.d.ts`, `env.d.ts`, any `.d.ts` named by `tsconfig` `include|files|types`), protected paths and protected edit patterns (doc 03 §4).

**Generated code** (excluded from slop/coverage/structure rules; still counted for Knip): path patterns (`**/generated/**`, `*.gen.ts`, `*.generated.ts`, `__generated__`, `.graphql.ts`, `prisma/client`), first-five-line markers (`@generated`, `DO NOT EDIT`, `auto-generated`, `eslint-disable` + `generated`), `.gitattributes linguist-generated`, and output dirs of detected codegen configs (graphql-codegen, orval, openapi-generator, prisma, protobuf-ts).

**Scripts** per TS package: `test`, `build`, typecheck script (`typecheck|type-check|check-types|tsc|check`), `lint`. **Monorepo legs:** the `test` and `build` legs use the **root** script when the root `package.json` defines it (typically a turbo/nx/`pnpm -r` fan-out); otherwise one leg per package that defines the script, run in workspace-topological order through the package manager (`pnpm -r --workspace-concurrency=1 run test`, `yarn workspaces foreach -A run test`, `npm run test --workspaces --if-present`, `bun run --filter '*' test`). "No test script" means neither the root nor any TS package defines one. `run.json.gate.legs[]` may therefore hold several entries per id, each with its own `cwd`. runner inferred from the script body (`vitest`, `jest`, `mocha`, `node --test`, `playwright test`, `bun test`) for CI-mode env and summary parsing. Husky/lint-staged/commitlint presence is recorded (it affects `commit`, doc 09 #31).

## 7. Engine resolution and probes

Resolution order for every engine: **project-local** (respects the project's pinned version and its config) → **toolbox** (`$TS_OPT_HOME/toolbox`, only if installed) → **PATH** → `npx` ad hoc (only if `network.npx` allows, never modifies `package.json`/lockfile) → absent. Each result is `{version, source, works, reason}`; `works` is a smoke test (`--version` or `--help` within 5 s, exit 0, no stack trace) executed **with the project's resolved TypeScript on the module path**, which is what catches `type-coverage` crashing on TS 7.

| Engine | Needs | Used for | If unusable |
|---|---|---|---|
| **Knip ≥ 6** (v5 supported on TS ≤ 6 and Node < 20.19) | Node ≥ 20.19 (v6); no TS JS API (v6 is oxc-based) | reach-01…09, cycles (`--cycles`), baseline counts | reachability domain `unavailable`; cycles fall back (below); everything else runs |
| Knip v5 on a TS 7 project | imports the JS API → crashes (inferred from v6 announcement; verify with fixture) | — | upgrade hint; toolbox Knip 6 if allowed |
| **tsc / native tsc / tsgo** | the compiler itself | typecheck leg, diagnostics fingerprints, declaration probe, fit | typecheck leg `unavailable` → `fix` refuses |
| **Ultracite > Biome > Oxlint > ESLint (flat) > ESLint (legacy)** (detected in this priority order, exactly one wins; the order of the source's engine matrix) | project config | wave `B` autofix, slop-01/03 `auto`, complexity if the engine has the rule | wave `B` skipped; slop fixes become `assisted` |
| **ESLint + typescript-eslint on TS 7** | JS API → throws "does not support TS 7.0" | only as the project's own lint leg (tsgo adoption tier 4) | lint leg marked `untrusted` at baseline (red-baseline policy §9) |
| **tsgolint (`oxlint --type-aware`)** | `oxlint` + `oxlint-tsgolint@7`, TS ≥ 7, no `baseUrl` | optional engine for plat-02 (`no-floating-promises`) and `no-unsafe-*` hotspots | ast-grep/tells fallback with lower confidence |
| **type-coverage** | JS API of the `typescript` it resolves | type-06 ratchet (`type-coverage@<v>` metric) | run from the toolbox (private TS 6) if allowed; else proxy metric `escape-hatch@1` |
| **madge / dpdm** | JS API via `typescript-estree` (madge) | optional second opinion on cycles | Knip `--cycles`; else built-in Tarjan over a regex import graph (`engine: builtin-graph`, confidence `likely`) |
| **anti-slop** (Oxlint JS plugin) | already vendored in the repo (`tools/oxlint/anti-slop/` + `jsPlugins` entry) and Oxlint working | consumed read-only as high-precision candidates for type-01/rules it covers (`no-chained-type-assertions`, `no-widen-then-assert`, …) via `oxlint --format json` | tells/ast-grep tiers; the plugin never installs or vendors it |
| **ast-grep** (`ast-grep`, `sg`, toolbox `@ast-grep/cli`) | binary; TS/TSX grammars | tier-2 structural rules (shallow wrapper shape, `catch` passthrough, optional-chain depth, `export *` + importer) | tier-1 tells only; affected rules show `degraded` in the coverage table and cap at `confidence: likely` |
| **ripgrep** | binary | speed only | the Node tells engine (streaming, size cap 1 MB per file, bounded concurrency) |
| **git** | — | everything under `fix`, `--diff`, churn | audit-only mode |

Tier-1 tells engine: reads `catalog/rules/*.md` `tells:`; honours `.gitignore` via `git ls-files`; skips generated code, files > 1 MB and binary files; a **parse probe** flags files the structural tier could not parse (ast-grep `kind: ERROR`, plus a brace/paren balance heuristic), so a structural miss never masquerades as clean (the reference plugin's safety rail, kept).

### TS 7 ecosystem table (`catalog/ecosystem-compat.json`; `v` = verified in sources cited in doc 08, `i` = inferred, re-verify with fixtures)

| Tool | On a TS 7 project | Remedy `tsgo` command proposes | Basis |
|---|---|---|---|
| typescript-eslint, `eslint-config-next` | throws at startup (no JS API until 7.1) | alias scheme (§8) or move lint to Oxlint/Biome | v |
| ts-morph | breaks | pin to TS 6 via alias; own scripts: import from `@typescript/typescript6` | v |
| ts-node | crashes | `tsx` or `node --experimental-strip-types` | v |
| ts-jest | breaks | `@swc/jest` / `vitest` / alias | v |
| type-coverage | crashes unless given a TS 6 | toolbox, or proxy metric | v |
| madge | crashes | Knip `--cycles` | v |
| dpdm | likely breaks (parses with TS) | Knip `--cycles` | i |
| Knip v5 | breaks; v6 fine | upgrade (Node ≥ 20.19) | i / v |
| Biome, Oxlint (+ tsgolint v7), Prettier | fine | — | v |
| Vite, esbuild, SWC, Rolldown, tsx, Bun, Deno | fine (transpile only) | — | v |
| `vite-plugin-checker`, `next build` type-check | use whichever `typescript` resolves; with the alias scheme that is TS 6 | note divergence | v |
| vue-tsc, Svelte/Astro/Angular template checking, MDX | need TS 6 for editor/template support | keep TS 6 for those tools | v |
| tsup/tsdown `dts`, rollup-plugin-dts, api-extractor, typedoc, ts-json-schema-generator | use the JS API | alias scheme | i |

## 8. tsgo strategy

### 8.1 Three usage modes
1. **already-native** — `authoritative.kind == native`. `tsc` *is* tsgo. The plugin just uses it; `fit` reports parity as n/a and speed vs nothing; adoption findings are limited to tooling around it (tc-04…tc-08).
2. **accelerator** — project stays on TS ≤ 6; the plugin uses a native compiler (project `tsgo`, else toolbox `typescript-native`) **only as the inner loop**: `ts-opt check`, the `fast-check` hook, and `fit`. Zero repo changes. The project's own compiler remains the gate.
3. **adopt** — migrate the project to TS 7 (`/ts-optimize:tsgo`), producing toolchain findings (tc-01…tc-11) fixed in waves `T1–T4` under the same approval and commit discipline.

### 8.2 Authority rule
The authoritative compiler decides every gate. The fast compiler may only (a) block early (a fast failure that the authority reproduces is a real failure) or (b) advise. Divergences are logged to `apply/log.jsonl` as `{"ev":"divergence","fast":"pass","auth":"fail"}`; if the fast compiler fails where the authority passes three times in a run, `fast-check` disables itself for that run and `SUMMARY.md` records `tsgo-divergence`. Declaration-emit output is **never** compared byte-for-byte between compilers (upstream states exact `.d.ts` parity is a non-goal); only diagnostics are.

### 8.3 `ts-opt fit` procedure (per TS package; read-only; run-less — output goes to `.ts-optimize/fit/latest/`, and `scan --mode tsgo` imports it when it is under an hour old for the same HEAD, otherwise re-runs it; result shape in doc 02 §3.2a)
1. Static pass: resolved options vs `catalog/removed-options.json` (hard errors in 7: `target es5`, `downlevelIteration`, `moduleResolution node|node10|classic`, `baseUrl`, `module amd|umd|systemjs|none`, `alwaysStrict: false`; also long-removed options still flagged: `noImplicitUseStrict`, `keyofStringsOnly`, `suppressExcessPropertyErrors`, `suppressImplicitAnyIndexErrors`, `out`, `charset`) and `catalog/defaults-changes.json` (`strict`→true, `types`→`[]`, `module`→esnext, `rootDir`→`./`, `stableTypeOrdering`) → tc-01…tc-03 candidates.
2. Run the authoritative typecheck (reuse baseline if fresh) and the fast compiler on the same config; time both; if native, also `--singleThreaded` once to report the parallel speed-up honestly (flags `--checkers`, `--builders`, `--singleThreaded` are documented as experimental).
3. Compare diagnostics as multisets of `(file, TS code, normalised message)`; classify extra/missing items with the known-divergence table (conflicting declarations under `skipLibCheck`, JSDoc/JS differences, strict-default changes).
4. Ecosystem scan: repo imports of `typescript` (`git grep -E "from ['\"]typescript['\"]|require\(['\"]typescript['\"]\)"` outside `node_modules`), dependency names against §7, CI files (`.github/workflows/*`, `.gitlab-ci.yml`, `Dockerfile*`, `wrangler` build settings) for `NODE_OPTIONS` flags that break worker threads (`--v8-pool-size`, `--max-semi-space-size`), `.vscode/settings.json`.
5. Verdict (`fit.json.verdict`): `already-native` · `ready` · `ready-with-bridge` (config fine, JS-API consumers present) · `needs-config` (auto/assisted fixes will clear it) · `blocked` (unbridgeable tooling or unexplained divergence) · `not-applicable`. The Markdown report lists blockers with the finding rule that fixes each and the measured speed-up vendor-independently (never quoted from marketing).
6. If no native compiler is available and toolbox consent is absent, the verdict is `cannot-probe` plus the single next action (allow the toolbox, or install `typescript@next` — the channel nightlies moved to — in a scratch branch).

### 8.4 Adoption plan (what `tsgo` proposes, in order; each item is a finding with its own verification)
- **T1 config modernisation**: remove/replace hard-error options; rewrite `paths` to `./`-relative when `baseUrl` is removed (bare imports that relied on `baseUrl` become explicit `paths` or `@/` aliases, found by `git grep` for imports that resolve only via `baseUrl`); set `moduleResolution: bundler` (bundled apps) or `nodenext` (Node ESM/CJS libraries, which requires explicit `.js` extensions) per the source decision matrix; set `target` per archetype (ES2022 default; library ES2020); restore `types` explicitly where globals broke (`node`, `vitest/globals`, `@cloudflare/workers-types/…`); set `rootDir` where emit layout mattered.
- **T2 tooling bridge**: choose the **alias scheme** when any third-party tool needs the JS API: `"typescript": "npm:@typescript/typescript6@^6"` and `"@typescript/native": "npm:typescript@^7"` (so `tsc` is native, `tsc6` and every `require('typescript')` is TS 6; this is Microsoft's documented side-by-side setup). Own scripts that import `typescript` are listed; with the alias scheme they need no edit, otherwise rewrite the import to `@typescript/typescript6`. Replace `ts-node` with `tsx`. Caveat recorded in the finding: frameworks that type-check through the resolved `typescript` (`next build`) will use TS 6 until their 7.1 support lands. Prefer **moving lint to Oxlint/Biome** when the repo already uses them.
- **T3 engine switch**: `typescript@^7` (or `@typescript/native-preview` when the project deliberately tracks nightlies) and script updates (`tsc --noEmit` stays `tsc --noEmit` on TS 7; no `tsgo` script names are introduced unless the preview package is the chosen channel). Lockfile refresh via the detected PM.
- **T4 CI/IDE alignment**: sanitise `NODE_OPTIONS` (keep `--max-old-space-size` for the remaining Node tools, drop worker-incompatible flags), set `GOMAXPROCS` only when a cgroup CPU quota is detected, consider `--checkers`/`--builders` for monorepos, delete stale `*.tsbuildinfo`, and IDE guidance (editor native-preview extension / `js/ts.experimental.useTsgo`, workspace TypeScript version) marked **advisory + re-verify** because the source's `typescript.native.*` settings could not be confirmed.
- **Verification**: the six tiers of the source become gate legs `typecheck`, `build-refs`, `declaration-emit`, `lint`, `test`, `build` (any leg that does not apply is recorded as such, with the reason). Branch default `chore/upgrade-typescript-go`.

## 9. Gate policy (the only definition; implemented in `lib/gate/`, prose in `references/gate-spec.md`)

**Legs.** `typecheck` (per typecheck-set entry) · `build-refs` (`tsc -b` for solution/composite) · `declaration-emit` (only with `declaration_signal`; commands: single project `<tsc> -p cfg --declaration --emitDeclarationOnly --outDir <os-tmp> [--noEmit false] --tsBuildInfoFile <os-tmp>/x`; composite: `-b --emitDeclarationOnly` then `-b --clean`, then assert `git status --porcelain` is unchanged) · `lint` (only in tsgo tiers and when the project has a `lint` script) · `test` · `build` · post-flight extras: `cycles` (no new fingerprints), `coverage` (≥ baseline for the same metric id), `knip` (zero remaining in the run's scope).

**Environment.** `CI=1`, runner-specific non-watch behaviour via the project's own script (never edited), a timeout per leg from `config.json` (defaults 600/1800/1800 s), process-group kill on timeout, output tail saved to `apply/gate/`.

**Wave → required legs.**
| Wave | Required legs |
|---|---|
| R0, R, 1, 2 | typecheck, test, build (2 also: cycles no-new) |
| 3 | typecheck, test, build, declaration-emit (if signal) |
| B | typecheck, test, build |
| 4 | typecheck, test, build, declaration-emit (if signal), coverage no-regress |
| 5 | typecheck, test, build, install-frozen sanity (`pnpm install --frozen-lockfile` / `yarn install --immutable` / `npm ci` / `bun install --frozen-lockfile` in a no-op check) |
| P (post-flight) | all of the above + knip zero + diff accounting |
| T1–T4 | the six tiers |

**Missing legs.** No `typecheck` possible → `fix` refuses. **No `test` script, or tests collected = 0** (parsed from runner output where possible, else a glob of `**/*.{test,spec}.*`/`__tests__` found nothing) → only waves `B` and `4` are allowed (zero-runtime type edits), per the source; the plan says so up front. No `build` script → the leg is recorded `not-applicable` (a library compiled only by `tsc` is covered by `typecheck`).

**Red baseline.** Any required leg red before the first edit → `run begin` exits 5 naming the leg. Override `run begin --allow-red-baseline typecheck,lint` records `gate.red_baseline` with the diagnostic multiset; from then on the leg passes iff it produces **no fingerprint that was not in the baseline** (typecheck) / no new failing test names (when parsable). A red `test` or `build` whose failures cannot be fingerprinted is `untrusted`: waves that depend on it are blocked. `accepted_risk` in `run.json` records who accepted what.

**Flakiness.** A failed `test`/`build` leg is re-run once. Pass-on-retry ⇒ leg passes with `flaky: true` in the log; two failures ⇒ failed.

### 9.1 Fingerprint definitions

- **Diagnostic fingerprint** = `sha1(relative_file | "TS" + code | normalised_message)`. Normalised message: file paths made repo-relative, line/column numbers removed, runs of whitespace collapsed, quoted identifiers and types kept. Compared as a **multiset** (counts matter) — a "new error" is any fingerprint whose count exceeds its baseline count.
- **Worktree fingerprint** = `sha1(HEAD sha + "\0" + sorted list of "<path>\0<sha1(content)>" for every path reported by git status --porcelain=v1 -z, excluding .ts-optimize/)`. A fast check or gate result is valid only for the fingerprint it was computed at; `ts-opt commit` recomputes it and refuses a stale result.
- **Finding fingerprint**: doc 04 §3.4.

**Wave failure handling.** Gate red ⇒ `bisect --wave id` over that wave's finding commits using `gate --quiet`; the culprit is reverted (`revert`), recorded with the failing output reference, the finding becomes `reverted`, the wave gate re-runs; it is never "fixed forward" by loosening `tsconfig`, skipping a test, or adding `@ts-expect-error`.

## 10. Degradation matrix (what each part does when something is missing)

| Missing | Hooks | `audit` | `fix` | `tsgo` | Agents |
|---|---|---|---|---|---|
| Node ≥ 18.17 | silent (prefilter) | prints requirement, exit 4 | same | same | not dispatched |
| git | silent | runs; no `--diff`, no churn; warns | refuses (exit 5) | `fit` runs; adopt refuses | n/a |
| ripgrep | — | Node tells engine (slower) | — | — | triager uses `grep`/Node via `ts-opt` helpers |
| ast-grep | — | tier-2 rules skipped, marked `degraded`, confidence capped | — | — | — |
| Knip | — | reachability `unavailable` (one advisory: allow toolbox / install Knip); cycles via built-in graph | waves 1–3, 4 (unused types), 5 absent | — | — |
| Single-file-component framework (Vue/Svelte/Astro) with no script-defined checker | — | tells scan `<script>` blocks; Knip uses its built-in compilers; reach rules that depend on template usage are `degraded` (a template-only consumer is invisible to the importer index) | typecheck leg `unavailable` ⇒ refuses; with `vue-tsc`/`svelte-check`/`astro check` scripts the leg is script-defined | — | — |
| Lint engine | — | slop `auto` fixes become `assisted` | wave `B` skipped; `noUnusedLocals` residue handled by `assisted` edits | lint tier `not-applicable` | — |
| TypeScript compiler | silent | tells + Knip only; types domain partial | refuses (no typecheck leg) | `fit`: not-applicable | — |
| Fast compiler | `fast-check` off | — | `check` uses the authority (slower) | accelerator mode unavailable; `fit` may say `cannot-probe` | — |
| `test` script | — | plan states waves limited to `B`/`4` | enforces that limit | tier 5 not-applicable | — |
| Network / consent | — | local engines only | — | `cannot-probe` if no native compiler | — |
| Git Bash (Windows without it) | shell-form hooks may be inactive; verified in Phase 6, fallback is exec-form Node handlers on every platform (doc 03 §3) | works | works; `ts-opt commit` enforces the same checks, only the raw-commit interception is affected | works | works |
| `.ts-optimize/` not writable | silent | exit 4 with path | exit 4 | exit 4 | — |

## 11. Behaviour in a repo with no TypeScript

| Primitive | Behaviour |
|---|---|
| Skill listing | present in `/help` (cannot be hidden); model-invoked skills carry `paths:` TS globs to stay quiet; combined listing cost target ≤ 900 tokens (measured with `claude plugin details`) |
| `/ts-optimize:*` | one line, exit 3, no files written |
| `SessionStart` hook | prefilter fails (`.ts-optimize/state/open-run` absent) → exits 0, no output, ≤ 10 ms |
| `PreToolUse` `cmd-guard` | only spawns when the command matches its `if` filter; then checks the repo for TS before ever blocking; non-TS repos: allow |
| `PreToolUse` `commit-guard` | spawns only on `git commit`; no open run ⇒ allow |
| `PostToolBatch` `fast-check` | prefilter on `open-run` ⇒ exit 0 |
| `bin/ts-opt` | on PATH, inert until called |
| Agents | never auto-selected (descriptions say "dispatched by /ts-optimize:audit") |
