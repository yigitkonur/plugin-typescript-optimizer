---
schema: ts-optimize/rule@1
id: reach-01
version: 1
name: Unreferenced file
domain: reachability
batch: 2
wave: "1"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: file
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [K]
requires: {}
adapter: knip:files
primary_over: [reach-04, reach-05]
sources: ['CLS Batch 2', 'FPT §1-§3, §5, §9', 'WAV §5 (wave 1)', 'SK Safety rails 5-6']
---
## What
A source file with no incoming import edge from any configured entry point (Knip `files`). `fix_risk` is path-class dependent: **high** for route-like files (pack route names), **low** for test, story and fixture files, otherwise **medium**. This is the only batch where a green gate does not prove safety: a framework-routed or dynamically loaded file passes typecheck, test and build and then 404s in production.

## Triage
The Three-Question Test is mandatory for every candidate; any "yes" means reconfigure the engine, do not delete.
Keep when:
- Framework lifecycle: Next `page|layout|route|loading|error|not-found|default|template`, `middleware`, `instrumentation`; Remix/React Router route modules; SvelteKit `+page*`/`hooks.*`; Astro pages and content config; Nuxt `composables/`/`plugins/`; Storybook stories; test setup files; Nest/TypeORM entities and migrations.
- Dynamic invocation: `import()` with variables or templates (`./locales/${lang}.json`), string-keyed registries, scripts named in `package.json` or CI, wrangler-registered classes.
- Public contract: targets of `package.json` `main|module|types|bin|exports` (map `dist` back to `src`).
- An ambient `.d.ts` (no import/export) named by `tsconfig` `files|include|types`: `worker-configuration.d.ts`, `env.d.ts`, `next-env.d.ts`. Reject outright.
Evidence ladder: `rg -w <name>` outside `dist`/`node_modules` and the file, `rg "\['<name>'\]"`, template-string references. Zero hits clears only Q2. Codify false positives as `entry`/`project`/plugin enablement; never a broad top-level `ignore`.

## Proposed change
For `{{file}}` ({{package}}), after the three answers are "no":
- Certain and not route-like: `git rm {{file}}`.
- Any plausible dynamic consumer: quarantine, keeping history: `git mv {{file}} .quarantine/<same relative path>` (exclude `.quarantine/` from `tsconfig` include and from the test glob in the same commit).
Delete in the same commit the files only this one used (tests, fixtures, mocks, MSW handlers): {{touches}}. When the file belongs to a dead feature, escalate to reach-10 and delete the feature directory as one unit.

## Verification
Legs: typecheck (TS2307 means a static consumer), test (a failing import means a test consumer; this is reach-03, restore), build (build-only red means a bundler edge: asset, glob, `import()`). For routed or quarantined files a preview deployment, not the gate, is the proof. After the wave, rescan: files orphaned by this deletion appear as `cascade:` findings in the same wave.

## Pitfalls
- A green gate proves static death, never runtime death.
- Do not delete ambient `.d.ts` or protected paths; commit-guard refuses and the finding is a false positive.
- Files reported only because Knip lacks an entry (monorepo workspace without config, noise over 25%) mean reach-12 comes first.
- Inside an unreferenced file, reach-04/05 findings are superseded by this one.
