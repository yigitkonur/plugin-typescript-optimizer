---
schema: ts-optimize/rule@1
id: tc-02
version: 1
name: baseUrl removal and paths rewrite
domain: toolchain
batch: null
wave: "T1"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: file
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:paths-baseurl"
primary_over: []
sources: ['UG baseurl-and-paths-migration.md', 'UG common-migration-pitfalls.md (Pitfall 1)', 'doc 05 §8.4 T1']
---
## What
`baseUrl` is removed in TypeScript 7, and `paths` entries are resolved relative to the tsconfig that declares them. Two things break: the `baseUrl` key itself, and imports that resolved *only* through it (`import { fmt } from "utils/format"` with `baseUrl: "./src"`), which also let `src/` folders hijack npm package names. Detection combines the resolved tsconfig chain (`baseUrl` set; `paths` values not starting with `./` or `../`) with an import-resolution scan: `git grep` for non-relative specifiers that match a top-level directory under the old `baseUrl` and no package in `node_modules`.

## Triage
Deterministic for the option; the bare-import list is the part to read. Keep (no change) only when:
- `baseUrl` is set solely to anchor `paths`, and every `paths` target is rewritable (the common case: pure rewrite, no import edits).
- The specifier is a real npm package that merely shares a name with a folder: not a baseUrl import.
Bundler aliases (Vite `resolve.alias`/`vite-tsconfig-paths`, Jest `moduleNameMapper`, webpack `resolve.alias`) must keep matching whatever the new `paths` say: read them before editing.

## Proposed change
In `{{file}}` ({{package}}); imports listed in {{consumers}}, edited files {{touches}}:
1. Root-relative aliases: delete `baseUrl`, prefix every `paths` target with `./`.
```diff
-"baseUrl": ".",
 "paths": {
-  "@/*": ["src/*"],
-  "@/components/*": ["src/components/*"]
+  "@/*": ["./src/*"],
+  "@/components/*": ["./src/components/*"]
 }
```
2. Monorepo package mappings: one exact entry and one wildcard per package (`"@myorg/core": ["./packages/core/src/index.ts"]`, `"@myorg/core/*": ["./packages/core/src/*"]`).
3. Bare imports that relied on `baseUrl`: either rewrite each to an explicit alias import (`from "@/utils/format"`) or add a wildcard path (`"utils/*": ["./src/utils/*"]`). Prefer the rewrite; the wildcard keeps the hijack risk.
Do both in one commit per config so the tree never has a half-resolved state.

## Verification
T1 legs: authoritative typecheck, test and build (the bundler resolves aliases too, so a green typecheck alone proves nothing). The fit probe must report no `TS2307` that the old config did not have, and zero `baseUrl` candidates.

## Pitfalls
- An inherited `paths` is relative to the config that *declares* it, not the one extending it; moving `baseUrl` out of a shared base changes meaning for every extender.
- `paths` does not move files at runtime: a Node runtime or a test runner needs its own alias mapping.
- Do not add a catch-all `"*": ["./src/*"]` to make errors go away; it recreates baseUrl.
- Monorepo packages resolved through pnpm symlinks do not need `preserveSymlinks`; leave it unset.
