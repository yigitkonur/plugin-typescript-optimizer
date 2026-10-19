---
schema: ts-optimize/rule@1
id: reach-07
version: 1
name: Unused dependency, devDependency, optionalPeer or catalog entry
domain: reachability
batch: 1
wave: "5"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: package
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [K]
requires: {}
adapter: knip:dependencies
primary_over: []
sources: ['CLS Batch 1', 'FPT §7, §10', 'WAV §10 (wave 5)', 'knip-configuration §8 (targeted ignores)']
---
## What
A package declared in `package.json` (or a workspace `catalog` entry) that no source file, script or configuration consumes (Knip `dependencies`, `devDependencies`, `optionalPeerDependencies`, `catalog*`). Wave 5 runs last on purpose: deleting dead files first removes the only importers, so pruning never produces `TS2307` for code that was already dead. `fix_risk` is `medium`; **high** for a production `dependencies` entry (runtime impact).

## Triage
Config-string consumers first. Keep (codify `ignoreDependencies`, or enable the Knip plugin) when the package is named only in:
- PostCSS/Tailwind/Babel/Prettier/ESLint/Stylelint config files (plugins, presets, shareable configs), `jest`/`vitest` setup or pool options.
- Node flags and scripts: `-r`, `--loader`, `--import`, `dotenv/config`, `source-map-support/register`, binaries invoked by `package.json` scripts or CI.
- `tsconfig` `types`/`typeRoots` (`@types/*`, `@cloudflare/workers-types`, `vitest/globals`) or `@cloudflare/vitest-pool-workers` in the vitest config.
- A peer dependency of another used library, a runtime-only native module, a Docker/CI-only tool, or `require(name)` with a computed name.
Evidence: `rg -g '!node_modules' -g '!dist' '<name>'` across config files, scripts and CI. Production-mode Knip reporting a dependency used only by tests means move it to `devDependencies`, not delete it.

## Proposed change
For `{{symbol}}` in `{{package}}`, uninstall with the detected package manager so the lockfile is refreshed by the tool, never by hand:
- pnpm: `pnpm remove <name>` (workspace: `--filter {{package}}`) then `pnpm install`
- yarn: `yarn remove <name>`; bun: `bun remove <name>`; npm: `npm uninstall <name>` (workspace: `-w {{package}}`)
- A `catalog` entry is removed from the workspace file only when no package references `catalog:` for it.
`touches` = the manifest and lockfile of that package only.

## Verification
Legs: typecheck, test, **build** (leg 3 carries the weight: a dependency used only by the bundler or a config file fails at build, not at typecheck), and the install-frozen sanity check (`pnpm install --frozen-lockfile`, `yarn install --immutable`, `npm ci`, `bun install --frozen-lockfile`). Rollback is `git checkout package.json <lockfile>` plus install.

## Pitfalls
- A broad top-level Knip `ignore` makes dependencies look unused; fix the config (reach-12), not the manifest.
- Removing a package that is a transitive requirement of an installed plugin breaks at install time on strict peer resolution.
- `bun run test`/`npm run build` style invocation applies to the gate, not to this edit.
- Never remove `@types/*` or worker type packages without checking `tsconfig` `types`.
