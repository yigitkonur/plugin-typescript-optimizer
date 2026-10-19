---
schema: ts-optimize/rule@1
id: type-09
version: 1
name: Strictness ladder gaps
domain: types
batch: null
wave: null
severity: advisory
fix_risk: low
fix_mode: flag-only
grain: package
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [G]
requires: {}
adapter: tsconfig-health
primary_over: []
sources: ['STM §3 (Model A and Model B)', 'audit-ts-health.py TsConfigAuditor (extends walk kept)', 'doc 05 §2.6 (signals)']
---
## What
Gaps in a package's resolved tsconfig strictness, read per package from the `extends` chain (depth <= 8, array form, bare specifiers): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `useUnknownInCatchVariables`, and `isolatedDeclarations` (libraries only). A key absent from the chain is `null`, not `false`. There is **no score**: the source's single percentage (which weighted `isolatedDeclarations` at 25 % for every project, and read only the leaf config) misleads for apps and is dropped. TS 7 default flips (`strict`, `types`, `module`, `rootDir`) belong to the fit probe, not to this rule.

## Triage
Deterministic from the config. Keep when the gap is not a gap for this package (accepted, recorded, not repeated):
- `isolatedDeclarations` only matters for packages that publish declarations; for an app it is not a gap.
- A package with no root `tsconfig` is reported per package, not as a repo failure; `tooling` and `solution` configs are classified apart from `project` configs.
- A deliberately loose legacy package may be an accepted gap (record it, do not nag).
- `verbatimModuleSyntax` interacts with CommonJS output and the bundler; check `module`/`moduleResolution` first.

## Proposed change
Suggested only; nothing is applied. Offer one of two migration models per package, never both:
- **Model A, file-by-file ratchet**: a `tsconfig.strict.json` that `extends` the base, enables the full strict family, and lists a growing `include` whitelist (directory globs once a directory is clean; each move in its own commit). CI runs both configs and requires new files to join the whitelist.
- **Model B, flag-by-flag**: `noImplicitAny`, then `strictNullChecks`, then the core strict family, then `noUncheckedIndexedAccess`, then `exactOptionalPropertyTypes`, then `"strict": true`, one flag per commit. Over 100 errors: baseline with tagged suppressions and a shrinking ceiling.
```ts
// @ts-expect-error [MIGRATION-STRICT-NULL]: burn-down tracked in #1042
const user = users.find(u => u.id === id);
```
Affected package: `{{package}}`.

## Verification
None by the plugin. If adopted: both tsconfig projects typecheck, the suppression count only goes down, and the coverage metric (type-06) for the same id does not drop.

## Pitfalls
- Never mix Model A and Model B in one package.
- Untagged `@ts-expect-error` is indistinguishable from ordinary debt; every baseline suppression carries a migration tag and an issue link.
- Enabling `strictNullChecks` is the largest error volume; do not start there on a codebase with no tests.
- A shrinking ceiling must be lowered in the same commit that removes suppressions.
