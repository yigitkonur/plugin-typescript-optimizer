---
schema: ts-optimize/rule@1
id: type-11
version: 1
name: Catch-variable widening
domain: types
batch: 8
wave: "4"
severity: warn
fix_risk: low
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R]
requires: {}
tells:
  - {id: t1, regex: '\bcatch\s*\(\s*[A-Za-z_$][\w$]*\s*:\s*any\s*\)', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t2, regex: '\(\s*(?:e|err|error|ex|exc|exception|reason|caught|cause|[a-z]\w*(?:Err|Error|Exception))\s+as\s+any\s*\)\s*\??\.\s*[A-Za-z_$]', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
  - {id: t3, regex: '\.catch\s*\(\s*\(?\s*[A-Za-z_$][\w$]*\s*:\s*any\s*\)?\s*=>', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
downgrade_in: {tests: advisory}
primary_over: []
sources: ['STM §2 pattern 3 (catch variables)', 'FPT §8.2 (--ignore-catch)']
---
## What
`catch (e: any)`, `(e as any).message` and `.catch((e: any) => ...)` widen the caught value back to `any` even though `useUnknownInCatchVariables` (part of `strict` since TS 4.4) types it `unknown`. Every property read after that is unchecked and a thrown string or `null` becomes a `TypeError` inside the handler that was supposed to report the error. The `t2` name list (`e`, `err`, `error`, `ex`, `*Error`) is a heuristic; the agent confirms the variable is a caught value.

## Triage
Keep when:
- The code intentionally accepts a library's non-Error rejection shape and the next line narrows it (an `isAxiosError(e)`-style guard), so the `any` is momentary; prefer `unknown` plus that guard anyway.
- The variable named `e` is a DOM event or a generic parameter, not an error (`(e as any).target`): not this rule, drop it.
- `catch (e) { throw new Error('ctx', { cause: e }) }` is correct enrichment and does not match any tell (it is slop-01's keep-when, not a finding here).
Seam: `(err as any).message` also matches type-01; both describe one location, so the plan keeps one finding.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`:
```diff
-} catch (e: any) {
-  logger.error(e.message);
+} catch (e: unknown) {
+  const message = e instanceof Error ? e.message : String(e);
+  logger.error(message, { stack: e instanceof Error ? e.stack : undefined });
```
When the handler needs a field other than `message` (`code`, `status`), narrow it: `if (typeof e === 'object' && e !== null && 'code' in e)`, or use the library's guard. When rethrowing, wrap with `new Error('context', { cause: e })`. Repeated narrowing belongs in one `toErrorMessage(e)` helper in an existing cohesive module (struct-07 applies if three copies already exist).

## Verification
Legs: typecheck (under `strict`, an `unknown` catch variable proves the narrowing), test, build. Extra proof: the type-coverage `--strict` ratio for the same metric id does not drop; `--ignore-catch` is a baseline decision, not a fix.

## Pitfalls
- Without `useUnknownInCatchVariables` the unannotated catch variable is already `any`; consider enabling the flag (type-09) after the sites are fixed.
- `instanceof Error` is false for errors from another realm (vm, iframe, some test runners); use a duck-typed check there.
- Do not "fix" by `catch (e) {}` (blind swallow); that is slop-01.
