# 06 — Rules catalog, waves, gate semantics, triage protocol

This document fixes **what is audited, how each finding is verified, and the order it is fixed in**. Rules live as
data in `catalog/rules/<id>-<slug>.md` (format in §8); this file is the index the builder implements from. Source
pointers (`SK` = `run-ts-cleanup/SKILL.md`, `CAT` = `references/detection/code-slop-catalog.md`, `CLS` =
`finding-classification.md`, `FPT` = `false-positive-triage.md`, `WAV` = `remediation/waves.md`, `STR` =
`structural-refactor.md`, `CX` = `complexity-thresholds.md`, `STM` = `types/strict-migration.md`, `DEC` =
`types/declaration-emit.md`, `CFW` = `runtimes/cloudflare-workers.md`, `LNT` = `engines/lint-engines.md`; `UG` = the
`upgrade-typescript-go` skill and its references) show where the knowledge came from.

## 1. Domains (rule groups, not skills) and the source pillars they carry

| Domain | Prefix | Source pillar | Count |
|---|---|---|---|
| `platform` | `plat-` | Pillar 1 Runtime & Platform Invariants (SK "Priority Section", CFW) | 2 |
| `reachability` | `reach-` | Pillars 2–3 Reachability & Dead Code, Encapsulation (SK, CLS batches 1–7, FPT) | 12 |
| `types` | `type-` | Pillar 4 Type Rigor (SK Sins 1,2,3,7,10; STM; DEC) | 11 |
| `structure` | `struct-` | Pillar 5 Architectural Deepening (SK Sins 4,6,8,9; STR; CX) | 11 |
| `slop` | `slop-` | the mechanical slop manifestations (CAT §2.1, Pattern 5) | 5 |
| `toolchain` | `tc-` | the whole `upgrade-typescript-go` skill | 11 |
| | | **Total** | **52** |

Provenance: every rule maps to source content (the `Notes` column and doc 08) except those listed as NEW in doc 01 §6 (plat-02 detector, tc-09/10/11, the no-score form of type-09, reach-12's noise gate). Naming drift in the source (4 pillars in CAT, 5 in SK; 7 patterns / 8 sins / 10 sins across CAT, README, SK) is resolved to **5 pillars + 10 sins**; CAT's 10 patterns and 4 manifestations map to the rules below.

## 2. The rules

Tables abbreviate for width — `med`=medium, `asst`=assisted, `adv`=advisory, `flag`=flag-only, `low–med`=low or medium by case; **rule files and artifacts always use the full words** (`medium`, `assisted`, `advisory`, `flag-only`). Legend — Eng: `K` Knip · `T` tsc/native diagnostics · `L` project lint engine · `R` tier-1 regex tells · `A` ast-grep tier-2 · `G` git/fs metrics · `C` type-coverage or proxy · `X` ecosystem table / fit probe · `H` human/architect judgement. Sev: `hard`/`warn`/`adv`. Risk = fix risk `low/med/high`. Mode: `auto`/`asst` (assisted)/`flag`. Wave: see §4 (`R0` mechanical autofix, `R` root-cause [deep only]).

### 2.1 platform
| ID | Rule | Detection | B | Wave | Sev | Risk | Mode | Notes / keep-when |
|---|---|---|---|---|---|---|---|---|
| plat-01 | `process.env` read in worker code | R + pack (`process_env_populated`), only under worker packages; path-class exclusions (config, build, scripts, tests) — **not** a substring test on "test" | – | R | hard if `false`, warn if `unknown`, adv if `true` | med | asst | Thread `env` / `this.env`. Corrected from SK/CFW's absolute claim (doc 05 §6). `nodejs_compat` + compat date ≥ 2025-04-01 populates vars/secrets but not bindings. |
| plat-02 | Un-awaited binding call in a handler (needs `ctx.waitUntil`) | tsgolint `no-floating-promises` if present, else A (statement-level call on `env.<X>.<send\|put\|delete\|run\|batch>` in a function with an `ExecutionContext` param) | – | R | warn (adv for tells-only) | med | asst | Never auto. Not applicable inside Durable Objects. `ctx.waitUntil(...)` calls are **protected**, never findings (doc 03 §4). |

### 2.2 reachability (engine K unless noted; CLS batches)
| ID | Rule | Detection | B | Wave | Sev | Risk | Mode | Notes / keep-when |
|---|---|---|---|---|---|---|---|---|
| reach-01 | Unreferenced file | K `files` | 2 | 1 | warn | high if route-like (pack route names) · low if test/story/fixture · else med | asst | Grain: file. Fix: `git rm`, or quarantine (`git mv` to `.quarantine/`) when a dynamic consumer is plausible. Three-Question Test mandatory. Reject if ambient `.d.ts` named by tsconfig. |
| reach-02 | Dead barrel re-export | K `exports\|nsExports\|duplicates` inside a **barrel** (majority of statements are re-exports — not decided by filename; the source's `index.ts` filename test misclassified real modules) | 3 | 2 | warn | low | asst | Re-run engine afterwards: orphaned modules cascade to wave 1. |
| reach-03 | Test-only export leak | K twice: default run vs `--production` run; an export reported in the production run but not in the default run is used only by non-production files (CLS batch 4 definition) | 4 | 3 | warn | med | asst | Never un-export alone: relocate the helper or retarget the test at the public interface ("Replace, don't layer"), same commit. |
| reach-04 | Internal-only export | K `exports` with in-file usage not ignored | 5 | 3 | warn | low | **auto** | Strip `export`. Mandatory declaration-emit pre-check (DEC §6, doc 05 §9) when a declaration signal exists. |
| reach-05 | Unused type / interface / enum member / namespace member | K `types\|nsTypes\|enumMembers\|namespaceMembers` | 6 | 4 | warn | low | `auto` for a top-level `interface`/`type`/`enum` with zero references when the declaration-emit leg is not applicable or its pre-check passed; `asst` for enum/namespace members and anything that fails the pre-check | Declaration-emit leg is part of the wave gate. Knip v6 has no `classMembers`; never enabled on v5 either. |
| reach-06 | Unused local / dangling import residue | L autofix + T `TS6133/6192/6196`; sub-kinds: un-export residue, dangling specifier (`TS2305`: fix consumer), pre-existing, intentional `_` | 7 | B | warn | low | auto | `_`-prefix is the contract; configure the engine, never disable the rule. Scope autofix to files changed in the run. **Created at wave `B` start, not at audit time** (the residue does not exist before wave 3): `run wave begin B` runs the lint engine in report mode plus `tsc` `TS6133`, writes one `reach-06` finding with `touches` = files changed since the run base that have residue, and it is covered by the plan lock as part of the approved wave-3 set. |
| reach-07 | Unused dependency / devDependency / optionalPeer / catalog entry | K `dependencies\|devDependencies\|optionalPeerDependencies\|catalog*` | 1 | 5 | warn | med (prod dep: high) | asst | Triage config-string consumers first (postcss/tailwind/babel presets, `-r`/`--loader`, `@cloudflare/workers-types` via tsconfig `types`). Uninstall + lockfile refresh with the detected PM. |
| reach-08 | Unlisted dependency / unresolved import / unlisted binary | K `unlisted\|unresolved\|binaries` | 1 | – | hard / warn(binaries) | – | flag | Human decides add vs delete. |
| reach-09 | Duplicate exports | K `duplicates` | 3 | 2 | warn | low | asst | |
| reach-10 | Zombie feature (permanently disabled flag, sole caller is the branch) | R + H | – | – | adv | high | flag | CAT Origin A. Verify the flag against the dashboard (human). Remedy when confirmed: delete branch, feature dir, fixtures/mocks/MSW handlers/schemas, re-run engine. |
| reach-11 | Dual abstraction / half-finished refactor | G: competing libs in `package.json` (axios+ky, lodash+lodash-es, date-fns+dayjs+moment, redux+zustand…), shadow dirs (`v1/` beside `v2/`), compat adapters; `rg -c "from 'x'"` ranks the survivor | – | R | adv | high | asst | CAT Origin D. |
| reach-12 | Knip configuration needed | meta: noise gate (§9.2) | – | – | warn | low | flag | One finding carrying the overlay proposal; never written into the user's config. |

### 2.3 types
| ID | Rule | Detection | B | Wave | Sev | Risk | Mode | Notes / keep-when |
|---|---|---|---|---|---|---|---|---|
| type-01 | Type laundering (`as any`, `as unknown as T`, `<any>x`) | R + A (not in comments/strings); tests → adv | 8 | 4 | warn | med | asst | Replacement ladder (STM §2): inference → `unknown`+guard → `Record<string, unknown>` → explicit signature → alias/union; boundaries via schema `safeParse`; literals via `satisfies`. |
| type-02 | Chained non-null assertions `a!.b!.c!` | R | 8 | 4 | adv | med | asst | |
| type-03 | Schema/type dual declaration (`XSchema` + `interface X`) | G symbol index (zod/valibot/yup/arktype detected) | 8 | R | warn | med | asst | `type X = z.infer<typeof XSchema>`. |
| type-04 | Anemic type guard (`val is T` without field checks) | R + A | 8 | 4 | warn | med | asst | Delegate to schema or verify every mandatory field. |
| type-05 | Defensive null paranoia / optional-chain smog | R (`if (x && x.y`, `(?:\?\.\w+){3,}`, redundant `?? null`); **requires** `strictNullChecks` in the file's resolved config | – | R | adv | med | asst | Keep when: external boundary (fetch, WebSocket, raw SQL row) not yet validated, genuinely optional schema field, DOM traversal. |
| type-06 | Any-creep hotspot / ratchet regression | C: `type-coverage --detail --strict` with `--ignore-files` for generated code and `--ignore-catch`; else proxy `escape-hatch@1` | 8 | 4, P | adv (hotspots) / hard (regression vs baseline, same metric id) | – | flag | Judge the delta, not the absolute. |
| type-07 | Declaration-emit failure (`TS4023 TS4058 TS4060 TS4081 TS4082 TS2742 TS2883`) | T declaration-emit leg | 8 | 4 | hard | med | asst | Never suppress with `@ts-expect-error`; annotate or re-export. Skill `declaration-emit`. |
| type-08 | Non-erasable syntax (enum, namespace, ctor parameter properties) | R + A | 8 | 4 | hard if `erasableSyntaxOnly` fails, warn if the pipeline strips types (Vite/esbuild/SWC/Bun/Deno/Node strip-types), else adv | med | asst | String-literal unions / `as const` objects / explicit fields. |
| type-09 | Strictness ladder gaps | tsconfig signals (doc 05 §2.6): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `useUnknownInCatchVariables`, `isolatedDeclarations` (libraries only) | – | – | adv | – | flag | Offer Model A (file-by-file ratchet, `tsconfig.strict.json`) or Model B (flag-by-flag, tagged `@ts-expect-error [MIGRATION-…]` with a shrinking ceiling). The source script's single percentage (isolatedDeclarations = 25 %) is dropped as misleading for apps. |
| type-10 | Type tidying | R + A: identity aliases (`type StringId = string`), third-party rename aliases, parallel representations (`UserDTO`/`IUser`/`UserData`), empty interface extension, dead `extends`, `extends Record<string, any>`, optional-bag unions → discriminated unions | 8 | 4 | adv | low–med | asst | Keep true brands. |
| type-11 | Catch-variable widening (`catch (e: any)`, `(e as any).message`) | R | 8 | 4 | warn | low | asst | `e instanceof Error ? e.message : String(e)`. |

### 2.4 structure
| ID | Rule | Detection | Wave | Sev | Risk | Mode | Notes |
|---|---|---|---|---|---|---|---|
| struct-01 | Barrel smog (`export *`; a module importing its siblings through its own directory barrel) | R + K/graph | 2 | warn | med | asst | Direct relative imports; explicit named exports; leaf modules for shared types. |
| struct-02 | Import cycles (barrel-manufactured / value / type-only) | K `--cycles` → madge/dpdm (`--ts-config`) if working → built-in graph | 2 | warn (value) | med | asst | Type-only cycles (every edge `import type`/inline `type` specifiers, or only via `.d.ts`) are false positives; convert borderline `import {Foo}` to `import type`; `verbatimModuleSyntax` keeps it enforced. Strategies: leaf extraction (default) → type-only imports → dependency inversion. Grain: cycle. |
| struct-03 | Shallow passthrough wrapper (Deletion Test) | A: single-expression function forwarding its params unchanged | R | adv | med | asst | Inline only if **all**: single consumer; zero transformation; no hidden complexity; no architectural seam (mock seam, anti-corruption layer, interface implementation). |
| struct-04 | Phantom interface / single-implementation seam (Seam Test) | R `export interface I[A-Z]\w*` + implementer count | R | adv | med | asst | One adapter = hypothetical seam (delete); two = real. TypeScript is structural: `implements` is not needed to mock. |
| struct-05 | Speculative generics, unused type parameters, speculative enum variants | A | R | adv | low | asst | |
| struct-06 | Single-consumer helper in a shared dir (1-to-1 rule < 25 LOC; Rule of Three) | G + graph | R | adv | low | asst | Strip `export` when moving; `git mv`; update test imports. |
| struct-07 | Duplicate utility implementations | R names (`cn`, `clsx`, `formatDate`, `formatTime`, `formatCurrency`, `slugify`, `capitalize`, `sleep`, `delay`, `truncate`, `clamp`, `safeJsonParse`, `isEmpty`, `isNil` …) in ≥ 2 files + normalised-body hash | R | warn | med | asst | Consolidation protocol (CAT §2.1.D): catalogue call sites → one canonical cohesive module (never a junk drawer) → superset → redirect → delete duplicates → verify. |
| struct-08 | Micro-file sprawl, depth > 4 below `src/`, single-child folders | G | R | adv | med | asst | Feature pods; only `WORTH_EXPLORING`. |
| struct-09 | Complexity hotspot (cyclomatic > 10 warn / > 16 high / > 25 critical; cognitive > 15; > 60 LOC; nesting > 3; ≥ 4 params; boolean flag arguments) | L (Biome `noExcessiveCognitiveComplexity`; ESLint `complexity`, `max-depth`, `max-params`, `max-lines-per-function`) run read-only with CLI rule overrides — never editing config — else G keyword-density ranking | – | adv | – | flag | Ranks refactor targets; dead code concentrates here. Thresholds in `config.thresholds`. |
| struct-10 | Subsystem locality violation (feature deletion test) | H (`ts-architect`) | R | adv | high | flag | |
| struct-11 | Shallow module / deepening opportunity | H (`ts-architect`) | R | adv | high | flag | Badge required. |

### 2.5 slop
| ID | Rule | Detection | Wave | Sev | Risk | Mode | Notes |
|---|---|---|---|---|---|---|---|
| slop-01 | Useless try/catch (rethrow only, blind swallow `console…; return null`, empty) | R multi-line + L (`noUselessCatch`/`no-useless-catch`) | R0 | warn | low | auto (rethrow via lint) / asst (swallow, empty) | Keep when the catch logs with context, enriches (`new Error(…, {cause})`), or is an intentional boundary fallback. |
| slop-02 | Narrating/obvious comments; comment-to-code ratio > 1:3 | R + G | R | adv | low | asst | Delete *what* comments, keep *why*. |
| slop-03 | Boolean theater (`? true : false`, `=== true`, redundant `!!`, `if/else return true/false`) | R + L (`noUselessTernary`, `noExtraBooleanCast`, `no-unneeded-ternary`) | R0 | adv | low | auto via lint | |
| slop-04 | Mock/test-utility names exported from production files | R (outside test globs) | R | warn | low | asst | Seam: `reach-03` is primary when both fire. |
| slop-05 | Inline re-implemented micro-helpers (`new Promise(r => setTimeout(r, ms))`, local `capitalize`) | R | R | adv | low | asst | Cross-file duplicates belong to `struct-07`. |

### 2.6 toolchain (the `tsgo` command; waves T1–T4; doc 05 §8)
| ID | Rule | Detection | Wave | Sev | Risk | Mode |
|---|---|---|---|---|---|---|
| tc-01 | Removed/changed compiler options (table in `catalog/removed-options.json`) | resolved tsconfig chain | T1 | hard | med | auto (pure removals) / asst (`target`, `module`, `moduleResolution`) |
| tc-02 | `paths` rewrite / reliance on `baseUrl` | tsconfig + import resolution scan | T1 | hard | med | asst |
| tc-03 | TS 7 default-change exposure (`types: []`, `rootDir`, `strict`, `module`) | X: fit probe diagnostic delta | T1 | warn | med | asst |
| tc-04 | JS-compiler-API consumers and incompatible tooling | X: `git grep` imports + deps vs `ecosystem-compat.json` | T2 | hard (blocks lint/test) / warn | med | asst (alias scheme or replace tool) |
| tc-05 | Transpile-runner hygiene (`ts-node`, `ts-loader` custom transformers, `ttypescript`, `ts-patch`) | deps + scripts | T2 | warn | low | asst |
| tc-06 | CI/container: worker-incompatible `NODE_OPTIONS`, CPU-quota `GOMAXPROCS`, stale `*.tsbuildinfo`, caches | CI files, Dockerfiles | T4 | warn | low | asst |
| tc-07 | Editor/LSP configuration | `.vscode/settings.json` | T4 | adv | low | flag |
| tc-08 | Project references / composite readiness (solution config, `tsBuildInfoFile`, `--builders`) | tsconfig graph | T4 | adv | med | asst |
| tc-09 | JS/JSDoc semantic differences (Closure types, `@enum`, `@class`/`@constructor`, constructor functions, `module.exports` mixing) in `allowJs`/`checkJs` packages | R over JS files | T1 | warn | med | flag |
| tc-10 | Declaration-emit parity risk (libraries) | declaration probe | T3 | adv | med | flag |
| tc-11 | Diagnostic parity drift between authority and native | fit probe | – | adv | – | flag |

## 3. Batches → waves (corrected; the three axes stay separate)

Three numbering schemes never substitute for each other: **phase** (workflow step), **wave** (remediation layer), **batch** (kind of finding; carries a wave pointer, not a phase). Reports name the batch and its `wave:`; they never emit a phase number.

| Batch | Kind | Producer | Wave |
|---|---|---|---|
| 2 | unused files | K | 1 |
| 3 | dead barrel re-exports, duplicate exports | K | 2 |
| 9 | import cycles | K / graph | 2 |
| 4 | test-only leaks | K ×2 | 3 |
| 5 | internal-only exports | K | 3 |
| 7 | unused locals, dangling imports | L, T | B (bridge) |
| 6 | unused types/enums | K | 4 |
| 8 | type-safety findings | T, C, R | 4 |
| 1 | unused dependencies | K | 5 |

Collapses (same structural layer ⇒ one commit group and one gate): 3+9 → wave 2; 4+5 → wave 3; 6+8 → wave 4.

**Order is causal:** `R0` (mechanical lint autofix) → `R` (root cause, deep only) → 1 files → 2 barrels/cycles → 3 encapsulation → `B` bridge → 4 types → 5 dependencies → `P` post-flight. Reasons carried from the source: dead files first removes dead import branches (dependency pruning later never causes `TS2307`); barrels/cycles before un-export prevents init-order hazards; the bridge sits *after* wave 3 because un-export residue (`TS6133`) does not exist earlier and would pollute wave 4's diff if run later; slop/root-cause work precedes pruning because it often removes the only consumer of a symbol (fixing slop *after* pruning wastes a wave).

**Cascade rule.** After `R0`, after `R`, and after each of waves 1–3, `ts-opt rescan --wave <id>` re-runs the producing engines. Pending findings whose evidence vanished become `stale`/`superseded`; new findings caused by the previous wave (e.g. a file orphaned by barrel pruning) are created with `origin: cascade:F-xxxx`, need approval, and the `fix` skill offers one grouped approval (`ts-opt plan amend --cascade`) per wave. A cascade finding whose wave has already run is queued for a **repeat pass**: after wave 5 completes and before the post-flight gate, the waves that have pending approved cascade findings run again in order (`pass: 2`, then at most `pass: 3`); anything still cascading after that is reported as residual in `SUMMARY.md`. This is the source's "cascades into Wave 1 on any subsequent cycle" made mechanical.

**Mode matrix.**
| Mode | Rules scanned | Waves schedulable |
|---|---|---|
| `sweep` | reach-01, slop-01, slop-03 (+ plat-* if a worker pack is active, report-only) | R0, 1 |
| `standard` (default) | platform (report), reachability (all except 10, 11), types 01, 02, 04, 06, 07, 08, 10, 11, structure 01, 02, slop 01, 03, 04 | R0, 1, 2, 3, B, 4, 5 |
| `deep` | all of the above + type-03, type-05, reach-10, reach-11, structure all (via `ts-architect` for 10, 11), slop all, plat actionable | R0, R, 1, 2, 3, B, 4, 5 |
| `tsgo` command | toolchain only | T1–T4 |
Rules whose wave is not schedulable in the chosen mode still appear (as `wave: null`, "not scheduled in this mode; run deep").

## 4. Risk matrix (data: `catalog/risk.json`; used for `fix_risk` defaults and the plan's gate coverage note)

| Batch | Blast radius | Runtime impact | Rollback | Gate leg that catches a mistake |
|---|---|---|---|---|
| 2 files | high | med–high | low (`git checkout <file>`) | typecheck, test, build — **and nothing catches a dynamically/framework-routed file**: a green gate proves static death, never runtime death ⇒ quarantine or verify in a preview deployment |
| 3 barrels | high | low | low (`git diff`) | typecheck |
| 9 cycles | high | med | med (structural) | test, build |
| 4 test leaks | med | zero | low | test |
| 5 internal exports | low | zero | lowest | typecheck |
| 7 locals/imports | low | zero | lowest | typecheck |
| 6 unused types | lowest | zero (erased) | lowest | typecheck + declaration-emit |
| 8 type safety | low | zero | lowest | declaration-emit, coverage delta |
| 1 dependencies | med | low–med | low (`git checkout package.json <lockfile>` + install) | build |

## 5. Wave policy, rollback, and what the gate may never be bent by

(The legs per wave are in doc 05 §9.) Rollback table kept from WAV §12: last wave bad & unpushed → `git reset --hard <wave-start tag>`; pushed → `git revert` the finding commits; one wrong finding → `ts-opt revert F-…`; wave 5 → also reinstall; unknown culprit → `ts-opt bisect --wave`; abandon → `run abort` (restores the branch; leaves artifacts). **Never** bypass a red gate by loosening `tsconfig`, skipping a test, or adding `@ts-expect-error`; restore and re-triage. Gate failure triage table (WAV §1.7) ships as `skills/fix/references/gate-triage.md`: `TS2307` after wave 1 → restore file, false positive; `TS6133` after wave 3 → run the bridge; `TS2305` after wave 2/3 → restore export or fix consumer in the same wave; `TS4023/4060/2742` → declaration-emit skill; test import error → test-only leak, not dead code; assertion failure → static analysis was wrong, revert the wave; build-only failure → bundler-only edge (asset, glob, dynamic `import()`) ⇒ restore and declare the entry.

## 6. Extra commit checks for semantics-preserving rules

For rules flagged `semantic_invariance: true` (struct-03…08, reach-02, reach-03, slop-04, slop-05) `ts-opt commit` additionally checks the staged diff: (a) no test assertion lines changed (a changed expectation means redesign, not refactor); (b) added lines containing `\b(if|for|while|catch)\b|\?\?|&&` are listed and require the finding to say `allows_new_control_flow: true`; (c) at most 5 files per refactor unit (STR "Plan-First Rule"); (d) symbol crossing a package boundary ⇒ requires the `exports` map check. Abort conditions from STR: test failures not fixable by import-path edits alone ⇒ revert; plan > 5 files ⇒ split into sequential findings.

## 7. `ts-architect` (deep mode) — contract

Input: churn window (`git log --since=6.months --name-only -- <scope>` counts; cold modules are excluded — YAGNI hot-spot scoping; shallow clones fall back to the last 100 commits), the Knip graph, `struct-09` ranking. It applies, in order: Deletion Test (delete the module in your head: complexity vanishes ⇒ shallow ⇒ inline; reappears in N callers ⇒ deep ⇒ keep and deepen), Seam Test (≥ 2 adapters to justify an interface), Interface-as-Test-Surface (tests cross the same seam as callers; never export for tests), Locality (1-to-1 rule, Rule of Three, depth ≤ 4, feature pods). Output via `ts-opt proposal add`: `{rule, location, recommendation: STRONG|WORTH_EXPLORING|SPECULATIVE, deletion_test, seam_test, files≤5, before_after_mermaid?, plan_steps[]}`. Badge meaning: `STRONG` — clear win with concrete precedent and immediate payoff (inline a single-use passthrough, remove a cyclic barrel); `WORTH_EXPLORING` — real trade-offs benefitting from team alignment (grouping micro-files into pods); `SPECULATIVE` — high risk or only valuable at scale (hexagonal ports/adapters). Only `STRONG` proposals are schedulable by default; the others are `flag`. `codebase-health.md` (doc 04 §10) carries the Mermaid before/after for each `STRONG`.

## 8. Rule file format (`catalog/rules/<id>-<slug>.md`)

Front matter is the YAML subset of doc 04; regexes are single-quoted. Body sections are copied verbatim into findings.

```markdown
---
schema: ts-optimize/rule@1
id: type-01
version: 1
name: Type laundering
domain: types
batch: 8
wave: "4"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol                  # symbol | file | package | cycle | project
triage: agent                  # agent | deterministic (deterministic: candidates ingest as `confirmed` with engine evidence, no ts-triager)
semantic_invariance: false
modes: [standard, deep]
engines: [R, A]
requires: {}                   # e.g. {strictNullChecks: true}
tells:
  - {id: t1, regex: '\bas\s+any\b',                glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '\bas\s+unknown\s+as\s+[A-Z]\w*', glob: ['**/*.{ts,tsx,mts,cts}']}
  - {id: t3, regex: '<\s*any\s*>',                 glob: ['**/*.{ts,mts,cts}']}
astgrep: ['astgrep/type-01-as-any.yml']   # optional; paths relative to catalog/
downgrade_in: {tests: advisory}
primary_over: []               # seams: rules this one wins against on the same location
sources: ['CAT Pattern 1', 'STM §2']
---
## What
## Triage
Keep when: …
## Proposed change
…recipe, diffs…
## Verification
…
## Pitfalls
…
```
Rules whose detection is Knip/tsc/lint-derived carry `engines` and an `adapter:` key naming the code path instead of `tells`.

`triage: deterministic` rules (no `ts-triager` needed because the evidence is the engine output itself): tc-01, tc-02, tc-05, tc-06, tc-07, tc-08, tc-10, tc-11, reach-06, reach-08, reach-09, type-06, type-07, type-09. Everything else is `triage: agent`; tc-03, tc-04, tc-09 are `deterministic` for detection but their `fix_mode: asst` proposals are specialised by the agent at fix time.

## 9. Triage protocol (`ts-triager`)

### 9.1 Three-Question Verification Test (applied to every candidate; any "yes" ⇒ do not delete — reconfigure the engine to document the entry point)
1. **Framework lifecycle?** invoked by convention without an import (Next/Remix/SvelteKit/Nuxt/Astro routes and special exports, Worker `fetch/scheduled/queue/email/tail`, decorators in Nest/TypeORM, Storybook, test runners)?
2. **Dynamic invocation?** `import()` with variables/templates, string-keyed registries (`obj[key]`), reflection, RPC bindings declared in `wrangler`, scripts referenced in `package.json`/CI?
3. **Public contract?** exported to external consumers (package `exports`/`main`/`types` targets, entry exports with `includeEntryExports`), or an ambient declaration table?

Evidence ladder: **Tier 1** `rg -w SYMBOL` (excluding `dist`, `node_modules`, the defining file), `rg "\['SYMBOL'\]"`, template-string references — zero hits only clears Question 2. **Tier 2** engine cross-check: does declaring the entry point/config make the finding disappear (then it was a false positive; codify config, do not delete code)? The triager cannot re-run engines, so it records the intended fix as `--codify`; after triage the `audit` skill runs `ts-opt knip-overlay --from-verdicts --write` and `ts-opt scan --rescan-engine knip`, and `findings ingest` treats candidates that vanished as confirmed false positives and candidates that remain as still-open (their `false-positive` verdict is downgraded to `deferred` with the note "codification did not remove the finding"). **Tier 3** (at fix time, not in triage): apply on a scratch commit and read the wave gate as evidence (typecheck red ⇒ static consumer; test red ⇒ test consumer ⇒ test-only leak; build-only red ⇒ bundler-only edge; green but framework-routed ⇒ quarantine, never delete).

### 9.2 Where a false positive is codified (in this order; recorded in `suppressions.json.codified_in`)
Knip: `entry` / `project` negation / `ignoreDependencies` / `ignoreBinaries` / `ignoreExportsUsedInFile` / plugin enablement → project lint engine `_` convention → `tsconfig` → `type-coverage --ignore-files`. **Never** a broad top-level `ignore` (it severs graph edges: files the ignored code imports then report as dead, and dependencies it uses as unused). The only permitted `ignore` entries are single import-less ambient files. A trailing `!` on an entry means "production" for `--production`, not "public API". The source's two contradictory canonical Worker configs (`entry` vs `ignore` for `worker-configuration.d.ts`) are resolved by this rule.

### 9.3 Decision table (condensed from FPT §10, shipped as `skills/audit/references/triage-protocol.md`)
| Candidate | Check | Verdict |
|---|---|---|
| export in `app/**/route.ts`, `page/layout/loading/error…` | Next plugin/pack | false positive |
| `ExportedHandler` default export; RPC class bound in wrangler | pack reads wrangler | false positive (protected) |
| `worker-configuration.d.ts` / ambient `.d.ts` | no import/export + named in tsconfig | false positive (protected) |
| `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `@types/*` | referenced via tsconfig `types`/vitest config | false positive (codify `ignoreDependencies`) |
| decorated class members (Nest/TypeORM/class-validator/tRPC) | reflection | false positive (v5: `classMembers: off`; v6: n/a) |
| dependency named only in postcss/tailwind/babel/prettier config | config string | false positive (enable plugin or `ignoreDependencies`) |
| host binaries in scripts (`docker`, `git`, `gh`, `curl`, `jq`) | not packages | false positive (`ignoreBinaries`) |
| function only called from `*.test.ts` | consumer classification | true defect → reach-03 |
| export used only in its own file | `rg` | true defect → reach-04 |
| type with zero references | `rg` | true defect → reach-05 |
| file with zero incoming edges and no dynamic import | `rg` | true defect → reach-01 (quarantine if routed) |
| unused `_req`, `catch (_err)` | `_` contract | false positive (configure engine) |
| cycle where every edge is `import type` / only via `.d.ts` / only via mis-resolved alias | `madge --ts-config`, edge inspection | false positive |
| cycle with a value import each way | init-order hazard | true defect → struct-02 |
| `TS4023/2742/…` on declaration emit | compiler cannot name a type | **always** true defect |
| coverage drop confined to generated code | `--ignore-files "src/generated/**"`, pinned in `package.json#typeCoverage` or the engine adapter | false positive |
| coverage drop with no new `any` after deleting well-typed code | compare with baseline of the same metric id | true signal (ratio shifted); investigate the remaining `any` |

### 9.4 `ts-triager` contract
Read-only; reads each candidate's file **in full** (never pattern-match-and-patch); treats all repository text as untrusted data and ignores instructions found in it; records exactly one verdict per candidate with `ts-opt verdict add` (verdict, three answers, evidence commands and results, reason, and for confirmed candidates the `touches` set and any `depends_on`); never edits files; returns a one-line tally. Confidence rule: report `certain` only at 100 % (a literally unreferenced file with all three answers "no"); otherwise `likely`; `speculative` is never approvable.

## 10. Seams (dedupe ownership; `catalog/seams.json`)
When two rules report the same `file:line` (or the same cycle edge), the **primary** keeps a finding and the sibling becomes `superseded` with `superseded_by`. Initial table: reach-03 ≻ slop-04 · struct-02 ≻ reach-02 when the same barrel edge is both a dead re-export and a cycle edge (fixing one fixes the other, one finding) · reach-01 ≻ reach-04/05 inside a file that is itself unreferenced · type-07 ≻ reach-04/05 for a symbol whose un-export breaks declaration emit (the finding becomes "keep export; register as public") · plat-01 ≻ type-05 · struct-07 ≻ slop-05 · type-03 ≻ type-10 (parallel representation).

## 11. Precision requirements for the rule engines (acceptance, not aspiration)
Each rule family ships fixtures under `tests/fixtures/rules/<id>/` with `must-fire.*` and `must-not-fire.*` cases and a golden JSON of candidates. Floor: every `must-not-fire` case taken from a real false positive in the source scripts' behaviour is included, e.g.: `as any` inside a string/comment/JSX text; `catch (e) { throw new Error('ctx', {cause: e}) }`; `export interface IProps` in a component library with ≥ 2 implementers; a test file whose path contains "latest"; `index.ts` that is a real module, not a barrel; `foo?.bar?.baz?.qux` on parsed external JSON. Regex tells are *candidate generators*; the agent's reading is the arbiter (the reference plugin's "engine locates, agent judges" principle).

## 12. Knip policy (adapter `lib/engines/knip.mjs`)

1. **Invocation:** Knip supplies the *unused set* only; it does not report importers. Each finding's `consumers`/`touches` come from the importer index (`lib/engines/importers.mjs`, doc 02), not from Knip. Command: `knip --reporter json --no-config-hints --no-exit-code` per workspace root (plus `--production` second pass for reach-03, plus `--cycles --reporter json` for struct-02). Version-aware reader for v5 and v6 JSON (v6: root `files` removed, every issue type an array); record `version` in `run.json`. Never pass `--include-libs`, `--isolate-workspaces`, `--experimental-tags` (removed in v6).
2. **Config policy (non-mutating):** use the user's config if present, untouched. If none: zero-config pass first (Knip auto-detects workspaces and enables plugins from `package.json` dependencies; the source's generated workspace maps and per-framework `entry` lists duplicated what plugins already do and are **not** ported). **Noise gate:** if the pass reports > 25 % of project files as unused, or zero entry points were found, or framework/RPC/ambient candidates exist that no config covers, emit one `reach-12` finding and suppress the noisy batch-2/3/5 candidates from the plan until an overlay is accepted. The overlay is written at two moments: (1) **bootstrap** — `knip-overlay --write` right after the noise gate trips, from detection alone (framework-pack route globs and entries, the wrangler-registered RPC classes, config-referenced dependencies found by scanning config files, import-less ambient `.d.ts` files); (2) **refinement** — `knip-overlay --from-verdicts --write` after triage, adding what the triagers' `--codify` entries proved. It writes `.ts-optimize/knip.config.jsonc` (minimal: only what is proven needed — `entry` for RPC classes/route globs, `ignoreDependencies` for config-referenced packages, single-file `ignore` for import-less ambient `.d.ts`, `ignoreBinaries`, `ignoreExportsUsedInFile: {interface: true, type: true}` only if the user's policy says so) and the next scan runs with `--config` pointing at it. The user promotes it (copy to `knip.jsonc`) via an ordinary finding.
3. **Fix policy:** Knip's fixer is used only as a *scoped bulk optimisation*: `--fix --fix-type <exports|types|dependencies> --format` (and `files` + `--allow-remove-files` only for wave 1 after quarantine decisions) only when `commit.granularity` is `batched`, **every** finding of that fix type in scope is approved, and a dry re-scan shows Knip's report equals the approved set; the resulting single commit lists all finding ids and, if reverted, all members are re-offered as individual `deferred` findings. With the default `finding` granularity the agent applies each edit itself. Otherwise the agent applies edits per finding. Never the unscoped `--fix`.
4. **Node/Engine matrix:** v6 needs Node ≥ 20.19; on older Node the adapter looks for a project v5 install or the toolbox is refused with a clear reason.

## 13. Lint bridge denylist (`catalog/lint-denylist.json`; never autofixed during a run)
`import/no-default-export`, `import/prefer-default-export` (breaks framework routers/Knip entries), `@typescript-eslint/no-explicit-any` (replaces with `unknown`/casts), `@typescript-eslint/no-non-null-assertion`, `@typescript-eslint/no-floating-promises` (prefixes `void`), `prefer-const` (only when scope is provably local), `no-param-reassign`, `react-hooks/exhaustive-deps`, Biome `--unsafe` and Oxlint `--fix-dangerously` (only with an explicit per-finding approval and a diff-shape review). Bridge scope: files changed in this run only; linter and formatter in one commit; never let autofix remove an export.

## 14. Detector implementation notes (how the non-Knip rules are produced; builder starting points)

All patterns start from the source catalog (`CAT` = `references/detection/code-slop-catalog.md`; the pinned blobs are in `source-pin.txt`) and must pass the fixtures of §11 before shipping; where the source regex is weak, the fixture decides.

| Rule(s) | Technique | Module | Source pointer |
|---|---|---|---|
| type-01, type-02, type-11 | tier-1 regex + ast-grep to exclude comments/strings/JSX text | `engines/tells`, `engines/astgrep` | CAT Pattern 1, `STM` §2 Pattern 3 |
| type-03 | `symbols` index: schema constants named `*Schema` built by `z.object`/`v.object`/`object(`/`yup.object`/`type(` + declarations `interface X`/`type X = {` with the same base name in the same package; flag when no `z.infer<typeof XSchema>` references exist | `engines/symbols` | CAT Pattern 2 |
| type-04 | regex for `x is T` predicates + body analysis: body is a single `typeof … === 'object' && … !== null` conjunction | `engines/tells` + `astgrep` | CAT Pattern 7 |
| type-05 | regex candidates, gated on `strictNullChecks`; keep-when list in the finding | `engines/tells` | CAT Pattern 3 |
| type-06 | `type-coverage --detail --strict` output parse, else `escape-hatch@1` counters | `engines/coverage` | `analysis-engines.md` §1 |
| type-07, reach-06 (tsc part) | diagnostic parse of the declaration-emit leg / `TS6133` | `engines/tsc` | `DEC` §3 |
| type-08 | regex (`enum`, `namespace`, constructor parameter properties) + project-signal severity | `engines/tells` | CAT Pattern 10 |
| type-09 | tsconfig signals vs ladder (no score) | `engines/tsconfig-health` | `STM` §3; `audit-ts-health.py` `TsConfigAuditor` (kept: extends walk) |
| type-10 | regex/ast-grep for identity aliases, empty `extends`, `Record<string, any>`; parallel names `XDTO`/`IX`/`XData` via `symbols` | `tells`, `astgrep`, `symbols` | `STM` §4 |
| struct-01, struct-02 | regex `export * from`; importers index for "imports its own directory barrel"; cycles via Knip `--cycles` → project madge/dpdm → Tarjan SCC over the importer index | `tells`, `importers`, `cycles` | CAT Pattern 4; `analysis-engines.md` §2; `audit-ts-health.py` `_tarjan_scc` |
| struct-03, struct-05 | ast-grep: exported arrow/function whose body is one call forwarding all params; generic params with defaults never referenced | `astgrep` | CAT Pattern 8, 6; `STR` §3 |
| struct-04 | regex + implementer count from `symbols` (`implements X`) | `tells`, `symbols` | CAT Pattern 6; `STR` Tenet 3 |
| struct-06 | `symbols` LOC (< 25) + importers count == 1 + path under `utils|helpers|shared|lib` | `symbols`, `importers` | CAT Pattern 9; `STR` §6 |
| struct-07 | declared names from the CAT list + normalised-token body hash (strip comments/whitespace, rename locals positionally) so identical bodies match | `symbols` | CAT §2.1 D |
| struct-08 | filesystem metrics: depth below `src/`, single-child directories, files < 30 LOC with one importer | `fs` | `STR` §6 |
| struct-09 | engine rules read-only (Biome/ESLint) else keyword density | `engines/lint` | `CX` §1 |
| slop-01, slop-03 | regex + lint rule mapping (`noUselessCatch`, `noUselessTernary`, `noExtraBooleanCast`, `no-useless-catch`, `no-unneeded-ternary`) | `tells`, `lint` | CAT §2.1 A, C; `LNT` |
| slop-02 | comment-line ratio per file + tautology regex | `tells` | CAT §2.1 B |
| slop-04, slop-05 | regex | `tells` | CAT Pattern 5, §2.1 D |
| reach-10 | regex for flag-guarded sole-caller branches + human confirmation | `tells` | CAT Origin A |
| reach-11 | `package.json` dependency-set pairs (axios+ky, lodash+lodash-es, date-fns+dayjs+moment, redux+zustand, …), directory-name pairs (`v1`/`v2`), `rg -c` ranking | `fs` | CAT Origin D |
| plat-01 | regex under worker packages + pack flags | `tells` + `packs` | `CFW` §4 |
| plat-02 | tsgolint `no-floating-promises` if available, else ast-grep expression-statement rule | `tsgolint`, `astgrep` | `CFW` §5 (invariant only; detector is NEW) |
| tc-01…tc-11 | `catalog/removed-options.json`, `defaults-changes.json`, `ecosystem-compat.json`, fit probe | `tsgo/*` | `UG` references; TS 7.0 announcement |

ast-grep rule files required in `catalog/astgrep/` (all `language: TypeScript` or `Tsx`): `type-01-as-any.yml`, `type-01-double-cast.yml`, `type-04-anemic-guard.yml`, `type-08-enum-namespace-param-props.yml`, `type-10-record-any-extends.yml`, `struct-03-passthrough-wrapper.yml`, `struct-05-unused-generic-default.yml`, `slop-01-catch-passthrough.yml`, `plat-02-unawaited-binding-call.yml`.

