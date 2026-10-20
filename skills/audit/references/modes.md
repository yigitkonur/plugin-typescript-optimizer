# Audit modes

Pick the mode with `ts-opt scan --mode sweep|standard|deep|tsgo`. The mode fixes which rules are scanned and which waves can be scheduled. A rule whose wave is not schedulable in the chosen mode still appears in the report with `wave: null` and the note "not scheduled in this mode; run deep". Default: `standard`.

## 1. Mode matrix

| Mode | Rules scanned | Waves schedulable |
|---|---|---|
| `sweep` | reach-01, slop-01, slop-03; plat-* report-only if a worker pack is active | R0, 1 |
| `standard` (default) | platform (report-only); reachability all except reach-10 and reach-11; type-01, 02, 04, 06, 07, 08, 10, 11; struct-01, 02; slop-01, 03, 04 | R0, 1, 2, 3, B, 4, 5 |
| `deep` | everything in standard plus type-03, type-05, reach-10, reach-11, all structure rules (struct-10 and struct-11 via `ts-architect`), all slop rules, platform rules actionable | R0, R, 1, 2, 3, B, 4, 5 |
| `tsgo` (the `tsgo` command, not `audit`) | toolchain rules tc-01 to tc-12 only | T1-T4 |

When to use which:

- `sweep`: quick, low-risk. Unreferenced files and mechanical lint slop; suitable for a first look or a large repo with a thin test suite.
- `standard`: the normal full cleanup.
- `deep`: only when the user wants structure work (shallow wrappers, ghost interfaces, duplicate utilities, zombie features, dual abstractions). Needs `ts-architect` and more triage.
- A repo with no test script or zero collected tests can only schedule waves `B` and `4`, whatever the mode (see `${CLAUDE_PLUGIN_ROOT}/references/gate-spec.md`).

## 2. Wave order and meaning

Order is causal, not stylistic:

`R0` mechanical lint autofix, then `R` root cause (deep only), then 1 files, 2 barrels and cycles, 3 encapsulation, `B` lint bridge, 4 types, 5 dependencies, `P` post-flight.

| Wave | Content | Rules |
|---|---|---|
| R0 | mechanical lint autofix of rethrow-only catches, boolean theater | slop-01 (rethrow), slop-03 |
| R | root-cause work: dual abstractions, schema/type duplication, shallow wrappers, duplicate utilities, null paranoia, narrating comments | reach-11, type-03, type-05, struct-03 to 08, struct-10, 11, slop-02, 04, 05, plat-01, 02 |
| 1 | unreferenced files | reach-01 |
| 2 | dead barrel re-exports, duplicate exports, cycles | reach-02, reach-09, struct-01, struct-02 |
| 3 | test-only leaks, internal-only exports | reach-03, reach-04 |
| B | unused locals and dangling imports left by wave 3 | reach-06 (created at wave start) |
| 4 | unused types/enums, type safety, declaration-emit failures | reach-05, type-01, 02, 04, 06, 07, 08, 10, 11 |
| 5 | unused dependencies | reach-07 |
| P | post-flight: all legs, Knip zero, diff accounting | type-06 (any-creep ratchet; also scheduled in wave 4) |

Why that order:

- Dead files first removes dead import branches, so later dependency pruning never causes `TS2307`.
- Barrels and cycles before un-export prevents initialisation-order hazards.
- The bridge sits after wave 3 because un-export residue does not exist earlier and would pollute wave 4's diff.
- Slop and root-cause work precede pruning: they often remove the only consumer of a symbol.

## 3. Three axes that never substitute for each other

- Phase: workflow step (`audit`'s detect, survey, triage, deepen).
- Wave: remediation layer (above).
- Batch: kind of finding, with a pointer to a wave. Reports name the batch and its `wave:`; they never emit a phase number.

| Batch | Kind | Producer | Wave |
|---|---|---|---|
| 2 | unused files | Knip | 1 |
| 3 | dead barrel re-exports, duplicate exports | Knip | 2 |
| 9 | import cycles | Knip / graph | 2 |
| 4 | test-only leaks | Knip x2 | 3 |
| 5 | internal-only exports | Knip | 3 |
| 7 | unused locals, dangling imports | lint, tsc | B |
| 6 | unused types, enums | Knip | 4 |
| 8 | type-safety findings | tsc, coverage, tells | 4 |
| 1 | unused dependencies | Knip | 5 |

Same structural layer, one commit group and one gate: batches 3+9 are wave 2; 4+5 are wave 3; 6+8 are wave 4.

## 4. Cascade

After `R0`, after `R`, and after waves 1 to 3, `ts-opt rescan --wave <id>` re-runs the producing engines. Pending findings whose evidence vanished become `stale` or `superseded`. New findings caused by the previous wave (for example a file orphaned by barrel pruning) are created with `origin: cascade:F-xxxx` and need approval; ask for one grouped approval per wave and apply it with `ts-opt plan amend --cascade` only after the user has said yes. After wave 5 and before post-flight, waves holding approved cascade findings run again (`pass: 2`, at most `pass: 3`); whatever still cascades is reported as residual.

## 5. Risk per batch (what the gate can and cannot catch)

| Batch | Blast radius | Rollback | Leg that catches a mistake |
|---|---|---|---|
| 2 files | high | `ts-opt revert F-…` | typecheck, test, build; but NOT a dynamically or framework-routed file: a green gate proves static death, never runtime death, so quarantine or verify in a preview deployment |
| 3 barrels | high | `ts-opt revert F-…` | typecheck |
| 9 cycles | high | structural | test, build |
| 4 test leaks | medium | easy | test |
| 5 internal exports | low | easiest | typecheck |
| 7 locals | low | easiest | typecheck |
| 6 unused types | lowest | easiest | typecheck, declaration-emit |
| 8 type safety | low | easiest | declaration-emit, coverage delta |
| 1 dependencies | medium | `ts-opt revert F-…`, then `ts-opt pm install` | build |
