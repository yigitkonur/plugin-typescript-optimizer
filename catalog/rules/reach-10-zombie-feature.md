---
schema: ts-optimize/rule@1
id: reach-10
version: 1
name: Zombie feature behind a permanently disabled flag
domain: reachability
batch: null
wave: null
severity: advisory
fix_risk: high
fix_mode: flag-only
grain: symbol
triage: agent
semantic_invariance: false
modes: [deep]
engines: [R, H]
requires: {}
tells:
  - {id: t1, regex: '\b(?:ENABLE|ENABLED|USE|SHOW|ALLOW|IS|FEATURE|FF|FLAG)_[A-Z0-9_]*[A-Z0-9]\s*[:=]\s*false\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**', '**/test/**', '**/tests/**', '**/fixtures/**']}
  - {id: t2, regex: '\bif\s*\(\s*(?:false|0|!true|!1)\s*\)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**']}
  - {id: t3, regex: '\bif\s*\(\s*!?\s*(?:FLAGS|FEATURES|FEATURE_FLAGS|featureFlags|flags|features)\s*\.\s*[A-Z][A-Z0-9_]*\s*\)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**']}
primary_over: []
sources: ['CAT Origin A', 'SK Priority (pillar 2)']
---
## What
Code that survives only because a feature flag was switched off in a dashboard: a constant such as `ENABLE_X: false`, an `if (false)` branch, or an `if (FLAGS.ENABLE_X)` whose sole caller is the branch itself. The build never proves the branch dead, so the whole feature (directory, fixtures, mocks, MSW handlers, schemas, migrations) stays. Tier-1 tells only list candidates; the proof is a human check of the flag in the dashboard.

## Triage
Keep when:
- The flag is a kill switch, an operational toggle, a per-tenant or percentage rollout, or driven by remote config / environment (the code constant is only the default).
- Tests or staging set the flag to `true`; look for `FLAGS.X = true`, `.env*` overrides, wrangler `vars`.
- The "disabled" value is a build-time constant for platform branches (`IS_SERVER = false` in a client bundle) rather than a feature flag.
Treat a flag as dead only after the owner confirms it has been disabled for more than one release cycle. Question 2: search for string-keyed flag reads (`flags[name]`, `getFlag('x')`) before concluding the constant is the only reader.

## Proposed change
Suggested diff shape (flag-only; nothing is applied). For `{{symbol}}` in `{{file}}` ({{package}}), after the owner's confirmation:
1. Delete the conditional branch and the flag constant.
2. `git rm -r` the feature directory and the paired test fixtures, mocks, MSW handlers and schema/models only that feature used (`{{touches}}`).
3. Re-run the Knip engine: sub-dependencies and files the feature last consumed appear as cascade findings (reach-01, reach-07).
```diff
-  if (FLAGS.ENABLE_EXPERIMENTAL_DISCOUNT_ENGINE_V2) {
-    return calculateExperimentalDiscount(cart);
-  }
```

## Verification
Not scheduled by the plugin. After a human applies it: typecheck, test, build; the feature directory has zero references (`rg -w`), migrations are untouched unless the owner agrees, and no other flag read refers to the deleted constant.

## Pitfalls
- Deleting pieces one export at a time leaves the corpse in the tree; the unit of deletion is the feature.
- Database migrations and generated clients tied to the feature are history; leave them unless the data owner decides.
- `if (false)` can be a deliberate temporary disable with a comment explaining why; read the surrounding comment and blame.
- Candidates cluster in generated or vendored code; those paths are excluded by the tells.
