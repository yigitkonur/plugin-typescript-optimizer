---
schema: ts-optimize/rule@1
id: tc-11
version: 1
name: Diagnostic parity drift between authority and native
domain: toolchain
batch: null
wave: null
severity: advisory
fix_risk: low
fix_mode: flag-only
grain: project
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X, T]
requires: {}
adapter: "fit:diagnostic-parity"
primary_over: []
sources: ['doc 05 §8.2 (authority rule)', 'doc 05 §8.3 steps 2, 3 and 5', 'doc 05 §9.1 (diagnostic fingerprint)', 'TS 7.0 announcement']
---
## What
The authoritative compiler (the `tsc` the project's own scripts run) and the native compiler disagree on the same configuration. Both are run on the same tsconfig (the native one also once with `--singleThreaded` so the parallel speed-up is reported honestly; `--checkers`, `--builders` and `--singleThreaded` are documented as experimental). Diagnostics are compared as **multisets** of `(file, TS code, normalised message)` where the normalised message has repo-relative paths, no line/column numbers and collapsed whitespace. A fingerprint is `sha1(relative_file | "TS" + code | normalised_message)`; counts matter, so a new error is any fingerprint above its baseline count. Items present on one side only are classified with the known-divergence table: conflicting declarations under `skipLibCheck`; JSDoc and JavaScript differences (tc-09); strict-default changes (tc-03).

## Triage
Deterministic: the multiset difference is the evidence. The authority decides every gate: a fast-compiler failure the authority reproduces is a real failure, a divergence is advisory. Divergences are written to the apply log as `{"ev":"divergence","fast":"pass","auth":"fail"}`; when the fast compiler fails where the authority passes three times in a run, the fast check disables itself and the summary records `tsgo-divergence`. Verdict mapping for `fit`: all differences classified → `ready` or `needs-config`; **unexplained divergence → `blocked`**. Keep (no finding) when the only difference is an expected, classified one already covered by tc-03 or tc-09 findings.

## Proposed change
Flag-only report entry with a suggested next action per class, for `{{package}}`:
```text
unexplained: only on native  TS2322  src/a.ts  "Type 'X' is not assignable to type 'Y'"
  -> reproduce with a minimal tsconfig on both compilers; do not edit source to appease either compiler
  -> check tc-03 (flipped defaults) and tc-09 (JS/JSDoc) first; if neither applies, report upstream
```
The plugin never changes source or tsconfig to hide a divergence: no loosening options, no `@ts-expect-error`, no skipped tests.

## Verification
Re-running `ts-opt fit` on the same HEAD must reproduce the same multiset difference (results older than one hour or from another HEAD are re-run). Declaration-emit output is compared by diagnostics only (tc-10), never byte-for-byte.

## Pitfalls
- Message wording can change between compiler versions with the same code; the normalised message keeps quoted identifiers and types, so reword differences appear as one extra and one missing item: compare by code first.
- A different set of files being checked (different `include`, symlink resolution, `types` default) produces drift that is configuration, not compiler behaviour.
- Timing is reported measured on this project; vendor multipliers ("8-12x") may be quoted only with attribution.
- A red baseline on the authority makes the comparison meaningless: use the baseline-allowed fingerprints from `run begin`.
