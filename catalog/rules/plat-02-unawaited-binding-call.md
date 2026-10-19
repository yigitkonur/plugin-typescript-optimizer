---
schema: ts-optimize/rule@1
id: plat-02
version: 1
name: Un-awaited binding call in a handler
domain: platform
batch: null
wave: "R"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [sweep, standard, deep]
engines: [A, L, X]
requires: {pack: workerd}
adapter: astgrep
astgrep: ['astgrep/plat-02-unawaited-binding-call.yml']
downgrade_in: {astgrep_only_no_type_info: advisory}
primary_over: []
sources: ['SK Priority Section §4', 'CFW §5', 'FPT §5.4', 'doc 03 §4 (ctx.waitUntil is protected)']
---
## What
A call such as `env.AUDIT_QUEUE.send(...)`, `env.KV.put(...)`, `env.DB.prepare(...).run()` used as a bare statement in a function that receives the `ExecutionContext`. When the response settles workerd may suspend the isolate and the dropped promise is aborted mid-flight. Detection prefers tsgolint `no-floating-promises` (type-aware, `warn`); without it the ast-grep statement-level rule runs and findings are `advisory` because no type information confirms the call returns a promise.

## Triage
Keep (false positive) when:
- The call is already awaited, returned, assigned and later passed to `ctx.waitUntil(...)`, or wrapped in `ctx.waitUntil(...)`. Those are protected edit patterns; never touch them.
- The code is inside a Durable Object class: its lifetime is not tied to the response, so the rule does not apply.
- The method is synchronous (for example an analytics `writeDataPoint`) or the receiver is not a binding (`env.logger.send`). Read the binding type in `worker-configuration.d.ts`.
- The author wrote `void call()` on purpose and the work really may be dropped. Confirm with the owner; `void` does not keep the isolate alive.
- A helper without a `ctx` parameter: the tell cannot see the handler. Follow the helper's callers before concluding.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}` choose one, after reading the handler:
```diff
-    env.AUDIT_QUEUE.send({ path: request.url });
+    ctx.waitUntil(env.AUDIT_QUEUE.send({ path: request.url }));
```
Use `await` instead when the response depends on the result or ordering matters. If errors must not fail the request, attach `.catch(...)` **inside** the `waitUntil` argument. Thread `ctx` into helper functions that make the call (`{{consumers}}`); do not stash `ctx` at module scope.

## Verification
Legs: typecheck, test (the workers pool exercises `createExecutionContext` / `waitOnExecutionContext`), build. Extra proof: the number of `ctx.waitUntil(` occurrences in the file increased by the number of calls wrapped and none decreased (commit-guard pattern (a)). Re-run tsgolint or the ast-grep rule: zero remaining matches at the finding's lines.

## Pitfalls
- Never auto-apply: wrapping changes when the work finishes, `await` changes latency, and deleting the call changes behaviour.
- `ctx.waitUntil(...)` is a runtime lifecycle contract. Never unwrap it as a "redundant wrapper", even when it looks like a shallow passthrough (struct-03).
- `waitUntil` work is limited by the platform; a long loop of binding calls belongs in a queue or a Workflow, which is a design finding, not this fix.
- Class-based entrypoints use `this.ctx.waitUntil`; the ast-grep tier does not model them, so absence of a finding there proves nothing.
