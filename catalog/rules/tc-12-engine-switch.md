---
schema: ts-optimize/rule@1
id: tc-12
version: 1
name: Switch the project to the native compiler
domain: toolchain
batch: null
wave: "T3"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:engine-switch"
primary_over: []
sources: ['doc 05 §8.4 T3', 'UG migration-playbook', 'doc 08 §3']
---
## What
The package still resolves `typescript` to a JavaScript-compiler release (5.x or 6.x) and nothing in it needs the JavaScript compiler API, so `tsc` can simply become the native compiler (TypeScript 7). This is wave T3 of the adoption plan; T1 (configuration) has already made the configuration valid for the native compiler, and T2 (tooling bridge) is not needed here. When a tool does need the JavaScript API, the alias scheme of tc-04 performs this switch and tc-12 is not reported.

## Triage
Deterministic: the fit probe found no blocker for this package (verdict `ready` or `needs-config` with the T1 findings approved). Keep (no finding) when the project deliberately pins an older compiler for a framework that type-checks through the resolved `typescript` (`next build`, `vue-tsc`): say so in the plan instead.

## Proposed change
In `package.json` ({{package}}), move the `typescript` dependency to the native major and refresh the lockfile with the repository's own package manager (`ts-opt pm install`):
```diff
 "devDependencies": {
-  "typescript": "^5.9.3"
+  "typescript": "^7.0.2"
 }
```
`tsc --noEmit` stays `tsc --noEmit`; no `tsgo` script names are introduced. Do not change anything else in this commit.

## Verification
Gate (six tiers): typecheck on the new compiler (against the baseline multiset; classified divergences are listed by `ts-opt fit`), build-refs and declaration-emit when the package has them, lint, test, build. A new diagnostic that only the native compiler reports is a T1 or tc-11 matter, never fixed by loosening the configuration.

## Pitfalls
- Do this after T1 and T2, never before: a TS 7 install with removed options or a JavaScript-API tool fails at startup.
- Pin by the package manager's range syntax already used in the file (`^`, `~`, exact).
- Declaration output is compared by diagnostics, never byte-for-byte (tc-10).
