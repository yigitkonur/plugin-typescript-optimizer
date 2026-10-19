---
schema: ts-optimize/rule@1
id: slop-03
version: 1
name: Boolean theater
domain: slop
batch: null
wave: "R0"
severity: advisory
fix_risk: low
fix_mode: auto
grain: symbol
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [R, L]
requires: {}
tells:
  - {id: t1, regex: '\?(?<!\bextends\b(?:[^;?{}]|\{[^{}]*\})*\?)\s*(?:true\s*:\s*false|false\s*:\s*true)\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '(?<![\w$.])[\w$]+(?:\.[\w$]+)*[ \t]*[!=]==?[ \t]*(?:true|false)\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t3, regex: '\b(?:if|while)\s*\(\s*!!', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t4, regex: '\breturn\s+!!\s*[\w$.]+\s*;', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t5, regex: '(?<!\belse\s+)\bif\s*\((?:[^()]|\([^()]*\))*\)\s*\{?\s*return\s+(true|false)\s*;?\s*\}?\s*(?:else\s*\{?\s*)?return\s+(?!\1\b)(?:true|false)\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT §2.1 C', 'CAT §3 step 1.8', 'LNT (noUselessTernary, noExtraBooleanCast, no-unneeded-ternary)']
---
## What
Code that spells out a boolean it already has. t1 `cond ? true : false` and `cond ? false : true`; t2 comparison of a plain identifier or member chain against a boolean literal (`flag === true`, `done !== false`; operands containing `?.` are skipped because an optional boolean makes the comparison meaningful); t3 redundant cast in a test position (`if (!!x)`, `while (!!x)`); t4 `return !!isReady`; t5 `if (c) { return true; } else { return false; }` and the fall-through form `if (c) return false; return true;` (an `else if` link in a longer chain is not matched). Conditional *types* (`T extends string ? true : false`) are type-level logic and are never matched: the t1 lookbehind recognises a preceding `extends` in the same statement.

## Triage
Keep (false positive) when:
- The operand is not already a boolean: `x === true` on `boolean | undefined` or `unknown` narrows; `x !== false` treats `undefined` as true; `return !!user` converts to `boolean` for a function declared to return `boolean`. Check the type before changing t2 and t4.
- The ternary is in a `.d.ts`/type position or builds a discriminated literal (`as const`).
- The `if/return` pair has a side effect between the statements (not matched) or the literals are the same (not matched).
Only t1, t3 and t5 are usually mechanical; t2 and t4 depend on types, so the agent reads the expression.

## Proposed change
Use the project's lint engine for the mechanical cases (`auto`): Biome `noUselessTernary`, `noExtraBooleanCast`; ESLint `no-unneeded-ternary`, `no-extra-boolean-cast`. Scope the autofix to files changed in this run and to those rules only. Manual forms in `{{file}}` for `{{symbol}}`:
```diff
-const ok = a > 1 ? true : false;
+const ok = a > 1;
-if (flag === true) { run(); }
+if (flag) { run(); }          // only when flag is already boolean
-if (a > 1) { return true; } else { return false; }
+return a > 1;
-return !!isReady;
+return isReady;               // only when isReady is already boolean
```
Never rewrite a comparison whose operand can be `undefined` or `null`.

## Verification
Wave R0 legs: typecheck, test, build. Type checking is the proof for t2/t4: the simplified expression must keep the same static type; a changed inferred type at an exported boundary also needs the declaration-emit leg. No test assertion edits.

## Pitfalls
- `!x === true` and double negations in `&&`/`||` chains may be deliberate coercions (`!!a && !!b` returning a boolean from a longer expression); only test positions are redundant.
- Lint `--fix` unsafe passes (Biome `--unsafe`, Oxlint `--fix-dangerously`) are denied (`catalog/lint-denylist.json`).
- Do not run a repository-wide fix: it buries the semantic diff; keep to changed files.
- `x == true` with loose equality coerces; removing it changes behavior for non-boolean operands.
