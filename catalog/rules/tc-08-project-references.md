---
schema: ts-optimize/rule@1
id: tc-08
version: 1
name: Project references and composite readiness
domain: toolchain
batch: null
wave: "T4"
severity: advisory
fix_risk: medium
fix_mode: assisted
grain: project
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:project-references"
primary_over: []
sources: ['UG monorepos-and-project-references.md', 'UG post-migration-verification-gate.md (Tier 2)', 'doc 05 §5 and §9', 'doc 08 §3 defect 6']
---
## What
The workspace's TypeScript graph is not ready for fast incremental builds with the native compiler: no solution `tsconfig` (`files: []` plus `references`), packages without `composite`, `declaration` and an `outDir`/`rootDir` pair, no cache location for `*.tsbuildinfo`, or a task graph (Turborepo, Nx) that does not cache the build info. Two valid patterns exist; the rule reports which one the repo uses and what is missing:
- **Pattern A, `paths`**: unified application repos where everything builds together; internal packages resolve through `paths` to `./packages/<name>/src/index.ts` (no build step between packages).
- **Pattern B, project references (`tsc -b`)**: publishing libraries or strict boundaries between packages.
The native `--builders` flag (parallel project builders) is documented as experimental; the finding proposes it only when the fit timing shows a gain. Speed multipliers in marketing material are not repeated.

## Triage
Deterministic from the tsconfig graph. Keep when the repo is a single package with no `references` (nothing to do) or when Pattern A is deliberate and fast already (fit shows the time). The `tsc -b --noEmit` question is **probed, never assumed**: the first composite typecheck at baseline tries `<tsc> -b --noEmit`; `TS5094` marks the variant `emit-and-clean` (`tsc -b --emitDeclarationOnly`, then `tsc -b --clean`), recorded in `run.json.gate.legs[].variant`. The source's two contradictory statements about this flag are resolved by the probe.

## Proposed change
In `{{file}}` ({{package}}) for Pattern B:
```json
// root tsconfig.json: solution file
{ "files": [], "references": [{ "path": "./packages/database" }, { "path": "./packages/ui" }, { "path": "./apps/web" }] }
```
```json
// packages/database/tsconfig.json
{ "compilerOptions": { "composite": true, "declaration": true, "declarationMap": true,
    "outDir": "./dist", "rootDir": "./src", "tsBuildInfoFile": ".cache/tsc/database.tsbuildinfo" },
  "include": ["src/**/*"] }
```
Put `.cache/` in `.gitignore` and list the same directory in the task runner's cache outputs (for Turborepo: the `type-check` task `outputs` and `dependsOn: ["^type-check"]`; keep the `tsBuildInfoFile` directory and the declared outputs identical, the source mixed `.cache/tsc` and `.cache/tsbuildinfo`). For Pattern A, keep `paths` entries `./`-relative with an exact and a wildcard entry per package. Touches: {{touches}}.

## Verification
T4 legs include `build-refs`: `tsc -b --verbose` builds the whole graph cleanly (using the probed variant), then the declaration-emit leg, test and build. After `-b` runs, `git status --porcelain` must be unchanged: emitted `dist/` and build info are ignored or cleaned.

## Pitfalls
- `tsc -b` rejects `--outDir` on the command line (`TS5065`); put it in the config.
- A package missing `composite` inside a referenced project fails the whole build with a confusing error on the referrer.
- `rootDir` must contain every included file or declaration paths shift; tc-03 and tc-10 interact.
- Do not claim speed-ups without the fit measurements; report both timings.
