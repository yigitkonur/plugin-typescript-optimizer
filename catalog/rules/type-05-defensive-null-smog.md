---
schema: ts-optimize/rule@1
id: type-05
version: 1
name: Defensive null paranoia and optional-chain smog
domain: types
batch: null
wave: "R"
severity: advisory
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [deep]
engines: [R, T]
requires: {strictNullChecks: true}
tells:
  - {id: t1, regex: '\bif\s*\(\s*([A-Za-z_$][\w$]*)\s*&&\s*\1\.[A-Za-z_$](?<!(?:JSON\.parse\s*\(|\.json\s*\(\s*\)|\bdocument\s*\.|\.querySelector|\bWebSocket\b|\.onmessage\b|\.rows\b)[\s\S]*)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**']}
  - {id: t2, regex: '(?:\?\.[A-Za-z0-9_$]+){3,}(?<!(?:JSON\.parse\s*\(|\.json\s*\(\s*\)|\bdocument\s*\.|\.querySelector|\bWebSocket\b|\.onmessage\b|\.rows\b)[\s\S]*)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**']}
  - {id: t3, regex: '\?\?\s*null\b(?<!(?:JSON\.parse\s*\(|\.json\s*\(\s*\)|\bdocument\s*\.|\.querySelector|\bWebSocket\b|\.onmessage\b|\.rows\b)[\s\S]*)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.{test,spec}.*', '**/__tests__/**']}
primary_over: []
sources: ['CAT Pattern 3', 'SK Sin 3', 'STM §3 phase 2 (optional chaining and `??` only where nullable)']
---
## What
Without whole-program context, generated code decorates every read with `?.`, `?? null` and `if (x && x.y && x.y.z)` even where the type is non-nullable. Under `strictNullChecks` those branches are unreachable, they hide the domain invariant ("a customer always has a profile") and make real optionality indistinguishable from fear. The rule needs `strictNullChecks` in the file's resolved config (without it every access is legitimately unchecked). The tells carry a file-level boundary exemption: a file that parses external data (`JSON.parse`, `.json()`, WebSocket, DOM queries, SQL `.rows`) before the match is not a candidate, which keeps a chain on parsed JSON silent.

## Triage
Keep when:
- The value crossed an external boundary and has not been validated: `fetch`/`res.json()`, WebSocket messages, raw SQL rows, `localStorage`, `postMessage`, `process.env`.
- The schema field is genuinely optional (`email?: string`), or the type is `T | null | undefined` at that point; check the declared type, not the name.
- DOM traversal (`document.querySelector('button')?.focus()`), where absence is normal.
- `x ?? null` that deliberately normalises `undefined` to `null` for an API or database contract.
Seam: `plat-01` wins when the same expression is a `process.env` read in a worker.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`:
```diff
-if (customer && customer.profile && customer.profile.billing && customer.profile.billing.tier) {
-  return customer.profile.billing.tier.toUpperCase();
-}
-return 'Unknown';
+return customer.profile.billing.tier.toUpperCase();
```
Delete the guard only after reading the declared type of every link and confirming it is non-nullable. If a link is nullable at a real boundary, move the validation to that boundary (schema parse) and keep the body trusting the parsed type. Collapse repeated chains (`a?.b ? a?.b : d`) to `a?.b ?? d`. Members: {{members}}; callers checked: {{consumers}}.

## Verification
Legs: typecheck (removing a needed guard fails on the next line), test, build. Extra proof: for each removed branch state which type guarantees it and, when the code is reachable from outside, add or point to a test of the absent case. Coverage must not drop (`type-06`).

## Pitfalls
- Runtime data can violate the compiled type (bad JSON, older clients). The guard belongs at the boundary, not scattered through the model.
- `?? null` removal changes `undefined` vs `null` observable output (JSON serialisation, `=== null` checks elsewhere).
- Optional-chain calls (`fn?.()`) are not smog when the callback prop is optional.
- Never replace `?.` with `!`; that is type-02.
