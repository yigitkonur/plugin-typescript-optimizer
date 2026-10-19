---
schema: ts-optimize/finding@1
id: F-0007
fingerprint: sha1:9c1e5b0a4f77d2e8a1b3c4d5e6f708192a3b4c5d   # stable across runs
run: 2026-10-19T1432Z-a1b2
rule: reach-04                          # catalog id
rule_version: 1
domain: reachability
batch: 5
wave: "3"                               # always a string
severity: warn
fix_risk: low
confidence: certain
recommendation: null
verdict: confirmed
state: approved
fix_mode: auto
engines: ["knip@6.41.0:exports"]
package: apps/web
location: {file: src/a.ts, line: 12, symbol: formatTimestamp}
members: []
touches: ["src/a.ts", "src/b.ts"]
depends_on: []
origin: scan
pattern: 'export\s+(const|function)\s+\w+'
triage:
  framework_lifecycle: "no"             # quoted: YAML booleans are not used
  dynamic_invocation: "no"
  public_contract: "no"
  evidence:
    - "rg -w formatTimestamp --glob '!src/a.ts' → 0 hits"
    - "rg \"\\['formatTimestamp'\\]\" → 0 hits"
suppressed_by: null
applied: null
verified_on: 2026-10-19
---

## What

`formatTimestamp` is exported but never imported.

## Evidence

- knip: unused export
