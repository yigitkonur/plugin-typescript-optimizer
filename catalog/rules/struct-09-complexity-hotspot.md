---
schema: ts-optimize/rule@1
id: struct-09
version: 1
name: Complexity hotspot
domain: structure
batch: null
wave: null
severity: advisory
fix_risk: medium
fix_mode: flag-only
grain: symbol
triage: agent
semantic_invariance: false
modes: [deep]
engines: [L, G]
requires: {}
adapter: "lint:complexity"
primary_over: []
sources: ['CX §1 thresholds', 'CX §2 smells', 'LNT']
---
## What
A function whose branching or nesting makes it a refactor target. The finding ranks targets; it is never applied by the plugin. Thresholds (configurable under `config.thresholds`): cyclomatic complexity above 10 is a warning, 16 and up is high risk, above 25 is critical; cognitive complexity above 15; more than 60 lines; nesting deeper than 3; four or more positional parameters; boolean flag arguments that fork the body. Breaching either bound qualifies; breaching both makes it a priority. Dead code concentrates here: unreachable branches, ghost parameters, orphaned helpers and unused types hide inside the functions that breach these bounds, so the ranking tells the other waves where to look first.

## Triage
Detection runs the project's own lint engine read-only, never editing its configuration: Biome `complexity/noExcessiveCognitiveComplexity` (`maxAllowedComplexity` 15); ESLint core `complexity`, `max-depth`, `max-params`, `max-lines-per-function` passed as CLI rule overrides. With no engine it falls back to ranking files by decision-keyword density (`if|else if|case|catch|while|for` counts). Keep (false positive) when:
- The function is a flat `switch` or table-driven dispatch whose cyclomatic count is high but whose cognitive load is low.
- It is generated or a parser/state-machine kernel where the shape is the point.
- The engine counted a long declarative config object as branching.
Note the divergence between the two measures: low cyclomatic with high cognitive means deep nesting rather than broad branching.

## Proposed change
Flag-only. Suggested diff shape for `{{symbol}}` in `{{file}}` (not applied by the plugin; if the user wants it, it becomes an explicit `ts-architect` proposal with its own plan):
```diff
-export async function processOrder(order: RawOrder) {
-  // 30 lines validation, 40 lines pricing, 35 lines persistence, 20 lines notification
-}
+export async function processOrder(order: RawOrder) {
+  const validated = validateOrder(order);
+  const finalized = calculatePricing(validated);
+  const saved = await persistOrder(finalized);
+  await notifyCustomer(saved);
+  return saved;
+}
```
Related shapes: invert nested ifs into guard clauses, replace a boolean flag argument by two functions after counting call sites per branch (one branch often has none: delete it), replace 4+ positional parameters by an options object and drop ghost parameters instead of migrating them. Keep extracted sub-functions unexported unless an external caller exists; exporting them turns one smell into four dead exports.

## Verification
None is run by the plugin because nothing is applied. If the user later applies a refactor: typecheck, test, build per the wave of the follow-up finding, a `ts-opt rescan` to refresh the ranking, and the extra care complexity refactors need because they change control flow (more regression risk than deletion).

## Pitfalls
- Absolute thresholds are heuristics: judge a function's complexity against its tests and churn, not the number alone.
- Never add a linter mid-run to get these numbers; use the project's existing engine or the density fallback.
- Boolean-flag detection by regex is noisy; trust the engine's rule output.
- Do not fix complexity by moving code into a new exported helper file (struct-06/08 would flag it next).
