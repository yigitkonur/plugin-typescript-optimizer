---
schema: ts-optimize/rule@1
id: reach-11
version: 1
name: Dual abstraction or half-finished refactor
domain: reachability
batch: null
wave: "R"
severity: advisory
fix_risk: high
fix_mode: assisted
grain: project
triage: agent
semantic_invariance: false
modes: [deep]
engines: [G]
requires: {}
adapter: fs:dual-abstraction
primary_over: []
sources: ['CAT Origin D', 'SK Sin 4-6 (cause before symptom)']
---
## What
A migration that stalled: two libraries or two patterns doing one job, each keeping the other's adapter alive. Signals from `package.json` and the filesystem: competing library sets (`axios` + `ky`, `lodash` + `lodash-es`, `date-fns` + `dayjs` + `moment`, `redux` + `zustand`), shadow directories (`components/v1/` beside `components/v2/`), and compat or adapter modules whose only purpose is translating between the two. `rg -c "from '<pkg>'"` per package ranks the survivor by call-site volume. One finding per cluster.

## Triage
Keep when:
- The two libraries serve different runtimes or layers on purpose (a Node HTTP client and a browser one), or one is required by a framework or a peer dependency of another package (`moment` pulled in by a UI kit).
- `v1/` and `v2/` are both live API versions served at the same time (public contract), not a refactor remnant.
- A written migration plan or ADR with an owner exists and the minority count is still falling.
- Different workspace packages use different libraries and have separate release trains; treat each package separately.
Question 3 decides: published packages and versioned APIs cannot drop the minority side silently.

## Proposed change
This is root-cause work and runs in wave `R` (deep mode), before pruning. For the cluster in `{{package}}`:
1. Choose the survivor by call-site volume and the repository's conventions; state the evidence (`rg -c` counts) in the finding.
2. Convert the minority library's call sites ({{consumers}}) to the survivor, one reviewed file group at a time (at most five files per refactor unit).
3. Delete the compat adapter and the superseded package (reach-07 then removes the dependency in wave 5; this finding does not edit `package.json`).
4. Re-run the engine for stranded types and orphaned wrappers (cascade findings).
Behavioural differences between the libraries (defaults, error shapes, locale handling) are part of the conversion and must be covered by tests.

## Verification
Legs: typecheck, test, build for every converted group; the test suite is the real proof here. Extra proof: a repository-wide `rg -c "from '<minority>'"` reaches zero before the package is removed; no assertion lines are edited to make tests pass.

## Pitfalls
- Never remove the minority package first: it breaks every remaining call site at once.
- Converting by search-and-replace misses semantic differences (`moment` mutability, `axios` throwing on non-2xx where `ky` also throws but with a different error type).
- Large clusters exceed the five-file limit; split into sequential findings with `depends_on`.
- Dedupe with struct-07: shared helpers wrapping either library are consolidated there.
