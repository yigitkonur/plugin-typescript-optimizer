---
schema: ts-optimize/rule@1
id: type-06
version: 1
name: Any-creep hotspot and ratchet regression
domain: types
batch: 8
wave: "4"
severity: hard
fix_risk: low
fix_mode: flag-only
grain: project
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [C]
requires: {}
adapter: coverage
downgrade_in: {hotspot: advisory}
primary_over: []
sources: ['analysis-engines §1 (type-coverage ratchet)', 'FPT §8.2 (counting code you do not own)', 'STM §2 (ratcheting the score)', 'doc 08 defects 13-14']
---
## What
Two signals from one measurement. **Hotspots** (`advisory`): the files with the most untyped identifiers, ranked from `type-coverage --detail --strict`. **Regression** (`hard`, wave 4 and post-flight): the ratio after a wave is lower than the baseline recorded for the **same metric id** (same flags, same ignore set). Judge the delta, not the absolute number: there is no universal floor; the old fixed `--at-least 95` is dropped. When `type-coverage` cannot run (it crashes on a TS 7 project; the toolbox TS 6 is the first fallback) the proxy `escape-hatch@1` counts `any` annotations, `as any`, `@ts-ignore`/`@ts-expect-error` and non-null assertions instead; baselines of different metric ids are never compared.

## Triage
Deterministic. Keep when (false positive) the drop is explained by files the repository does not own; read the remaining cases as real signals:
- A drop confined to generated code (Prisma, GraphQL codegen, OpenAPI, protobuf, `.next/types`) is a false positive: pin `--ignore-files "src/generated/**"` and `--ignore-catch` in `package.json#typeCoverage` or the engine adapter, so local and CI count the same files.
- Vendored third-party code and deliberately loose test fixtures: `--ignore-files "vendor/**"`, `"**/*.fixture.ts"`.
- A drop with **no new `any`** after deleting well-typed code is a real signal (the ratio shifted toward what remains); investigate the remaining `any`, do not reset the baseline.
- A drop with new `any` or casts in the diff is a defect of the wave: the removal was papered over (type-01, type-11 own the sites).
Generated-code exclusions come from doc 05 §6 generated-code detection.

## Proposed change
Flag-only; suggested output, never applied. Report the top files and the pinned configuration:
```diff
 "typeCoverage": {
-  "atLeast": 95,
+  "atLeast": <baseline for this metric id, e.g. 94.12>,
   "strict": true,
   "ignoreCatch": true,
   "ignoreFiles": ["src/generated/**"]
 }
```
Raise the floor only after a wave improves the number; never lower it to turn CI green. Each hotspot in `{{file}}` ({{members}}) points at the type-01/02/11 findings that remove it.

## Verification
Wave 4 and post-flight `coverage` leg: the count of untyped identifiers (total minus covered) does not rise above the baseline for the same metric id; the ratio is reported; the baseline is `type_soundness` in the run record. After a human raises the floor, re-run the same command.

## Pitfalls
- The percentage is a ratio; deleting typed code lowers it without adding any `any`.
- `--update`/`--update-if-higher` rewrite `package.json`; the plugin does not run them.
- `type-coverage` and TS 7: use the toolbox TS 6 or the proxy; do not report the crash as a regression.
- A metric computed with different `--strict` or ignore flags is a different metric id; start a new baseline instead of comparing.
