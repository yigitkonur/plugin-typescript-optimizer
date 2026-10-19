---
schema: ts-optimize/rule@1
id: slop-01
version: 1
name: Useless try/catch
domain: slop
batch: null
wave: "R0"
severity: warn
fix_risk: low
fix_mode: auto
grain: symbol
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [R, L, A]
requires: {}
tells:
  - {id: t1, regex: '\}\s*catch\s*\(\s*([\w$]+)\s*(?::[^)]*)?\)\s*\{\s*throw\s+\1\s*;?\s*\}', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '\}\s*catch\s*\(\s*([\w$]+)\s*(?::[^)]*)?\)\s*\{\s*console\s*\.\s*\w+\s*\(\s*\1(?:\s*\.\s*(?:message|stack))?\s*\)\s*;?\s*return\s+(?:null|undefined|false)\s*;?\s*\}', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t3, regex: '(?<!\/\/[^\n]*)\}\s*catch\s*(?:\([^)]*\)\s*)?\{\s*\}', scan: raw, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
astgrep: ['astgrep/slop-01-catch-passthrough.yml']
fix_mode_by_tell: {t2: assisted, t3: assisted, slop-01-catch-swallow: assisted, slop-01-catch-empty: assisted}
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT §2.1 A', 'CAT §3 step 1.7', 'LNT (noUselessCatch, no-useless-catch)', 'doc 06 §14']
---
## What
A `try/catch` that adds nothing, in three sub-kinds identified by tell: t1 rethrow-only, `catch (e) { throw e; }` (zero recovery, wasted stack frames, truncated async traces); t2 blind swallow, `catch (e) { console.error(e); return null; }` (logs the bare error, then destroys the root cause by returning a sentinel); t3 empty catch, `catch (e) {}` with no body and no comment. The tells match across lines and with arbitrary catch-variable names (a backreference ties the thrown or logged name to the binding) because the source regex missed nested braces and fixed names. ast-grep covers the same three shapes structurally, comments ignored.

## Triage
Keep (false positive) when the catch:
- enriches: `catch (e) { throw new Error('ctx', { cause: e }); }` or wraps in a domain error; not a rethrow.
- logs **with context** (`console.error('load failed for user', e)`, a logger call with fields) and then rethrows or returns an intentional boundary fallback.
- does other work first (`cleanup(); throw e;`), or sits at a deliberate boundary (request handler, `JSON.parse` fallback with no log).
- carries a comment stating why the error is ignored (best-effort telemetry): documented swallow, not matched by t3.
`Promise.prototype.catch(...)` is a different construct and is never matched. Test files downgrade to advisory.

## Proposed change
In `{{file}}` ({{package}}), `{{symbol}}`, by sub-kind:
- **t1 rethrow-only** (`auto` when the project's lint engine can do it: Biome `noUselessCatch`, ESLint `no-useless-catch`; otherwise the agent deletes the clause): remove the catch; if a `finally` exists keep `try { … } finally { … }`, otherwise unwrap the `try` body.
```diff
-try {
-  await work();
-} catch (e) {
-  throw e;
-}
+await work();
```
- **t2 blind swallow** (`assisted`): decide with the user what the failure should do: let it propagate (delete the catch), or keep a boundary fallback with a real message and `{ cause }` where it is rethrown.
- **t3 empty catch** (`assisted`): delete the try/catch if the failure is truly irrelevant, or add a comment stating why it is safe to ignore. Never leave it silent and undocumented.
Do not change what the function returns in the success path.

## Verification
Wave R0 legs: typecheck, test, build. Scope any lint autofix to files changed in this run and to the named rule only (never `--unsafe` / `--fix-dangerously`; see `catalog/lint-denylist.json`). Removing a t2/t3 swallow changes runtime behavior on failure: run the tests that cover the failing path or state in the commit body why none exists.

## Pitfalls
- Removing a rethrow-only catch is safe; removing a swallow is not. A swallow that "worked" for years may be masking a failure callers have learned to ignore.
- `catch (e) {}` inside a string or template literal can match t3, which reads raw text so the comment-aware lookbehind works; confirm by reading the file.
- Do not add `{ cause: e }` rewrites to a catch whose only problem is that it should not exist.
- Async stack traces: an `await` inside the try keeps them; wrapping the call in a new `Error` without `cause` loses them.
