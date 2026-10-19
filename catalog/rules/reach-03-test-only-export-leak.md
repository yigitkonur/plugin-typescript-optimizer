---
schema: ts-optimize/rule@1
id: reach-03
version: 1
name: Test-only export leak
domain: reachability
batch: 4
wave: "3"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: true
modes: [standard, deep]
engines: [K]
requires: {}
adapter: knip:production-diff
primary_over: [slop-04]
sources: ['CLS Batch 4', 'FPT §10 (function only called from *.test.ts)', 'WAV §7 step 4', 'STR Tenet 4 (interface as test surface)']
---
## What
A production symbol that carries `export` only so a test can reach internal state. Detection runs Knip twice: the default run and a `--production` run; an export reported in the production run but not in the default run is used only by non-production files. Consumer classification (importer index) names the test files; it is not a substring search.

## Triage
Keep when:
- The symbol is also part of the public API (entry export, package `exports`), so external consumers exist; Q3 decides, not the test.
- The "test" consumer is shipped code in disguise: a Storybook story that is built, an e2e harness referenced from CI, a dev-only route.
- A deliberate, documented `/** @internal */` test seam already exists as repository policy.
Question 2: rule out string-keyed or dynamic imports of the symbol before calling it test-only. The one situation this rule must never produce is a plain un-export, because the suite then turns red inside the wave.

## Proposed change
"Replace, don't layer": decide with the tests in view, in one commit that touches `{{file}}` and the consumers in `{{consumers}}`:
1. Preferred: retarget the test at the public function that calls `{{symbol}}` and assert observable behaviour; then strip `export`.
2. If the helper is only ever used by tests: move it to the test harness (`test/helpers/<name>.ts`) and delete it from `{{file}}`.
3. Only when exposure is unavoidable: mark intent with `/** @internal */` and record the exception in the finding (this keeps the symbol out of reach-04 and the public contract).
Test assertions are never rewritten to fit; if an expectation must change the finding is a redesign and is rejected here.

## Verification
Legs: test (this is the leg that catches a mistake), typecheck, build. Extra proof: the staged diff shows no changed assertion lines, at most five files, and added lines contain no new `if/for/while/catch`, `??` or `&&` unless the finding declares `allows_new_control_flow`. Rerun the production Knip pass: the symbol no longer appears.

## Pitfalls
- Un-exporting alone is the classic failure; relocate or retarget first.
- A helper with both production and test callers is not a leak (the default run reports it as used).
- A test that mocks the internal by import path breaks when the file moves; update the mock path in the same commit.
- Seam: when `slop-04` flags the same `mock*`/`fixture*` export, this finding is primary and the slop finding is superseded.
