# Architecture tenets (Pocock / Ousterhout model)

Four tests used by `ts-architect` and by the fixer to decide whether a module deserves to exist. A cleanup must not merely delete dead lines; it must leave modules deeper. They back rules struct-03, struct-04, struct-06, struct-10, struct-11 and reach-03.

Apply in this order: Deletion Test, Seam Test, Interface-as-Test-Surface, Locality. Everything here is semantics-preserving. If a change requires editing a test assertion it is a redesign, not a refactor: stop and escalate.

## Depth

- A module is deep when a small interface hides a lot of behaviour (caching, retry, validation, persistence, a state machine).
- A module is shallow when its interface is as wide and as complicated as its implementation (15 exported functions of 2 lines each).
- Depth is leverage at the interface: capability per unit of API a caller must learn. It is not the ratio of implementation lines to interface lines.
- Agents produce four kinds of shallow structure: pass-through wrappers, test-only export leaks, single-implementation interfaces ("ghost seams"), and micro-file sprawl.

## 1. Deletion Test (struct-03, struct-11)

Imagine deleting the module.

- Its complexity vanishes and callers call the underlying thing directly: it was shallow. Inline it.
- Its complexity reappears, duplicated across N callers (caching, retry, schema parsing): it is deep. Keep it and consider deepening it.

Worked example:

- `fetchUserById(id) { return apiClient.get('/users/' + id) }` fails the test. Callers already understand `apiClient.get`.
- The same function that also checks a cache, retries and parses the response with a schema passes it, with the same one-argument interface.

Inline only when ALL hold:

- One consumer (the engine reports one file; confirm with `rg -w <symbol>`).
- Zero transformation: no validation, logging, telemetry, memoisation, retry or error handling.
- The body is one forwarded call, one property read or one expression.
- The symbol is not an architectural seam.

Do NOT inline:

- An anti-corruption layer isolating third-party SDK types from domain types.
- A mock seam used by tests through injection or module mocking.
- A function satisfying an interface contract enforced by a framework or schema.

Subsystem form (struct-10):

- Question: can you `git rm -r src/features/x/` and have the rest compile, apart from explicit navigation links?
- If deleting it breaks `billing/` and `utils/` because x exported private calculators or DTOs into global directories, x violates locality.
- Fix: move those symbols back into x.

## 2. Seam Test (struct-04)

One adapter is a hypothetical seam. Two adapters is a real seam. Do not introduce an interface, abstract class or port unless at least two concrete adapters exist in the repo (production plus an in-memory fake counts).

- TypeScript is structural: `implements IUserService` is not needed to mock or substitute `UserService`. Any object of the right shape satisfies callers.
- Two signatures to maintain (`IUserService.ts` and `UserService.ts`) buy nothing with one implementer.
- The I-prefix is not the signal; the implementer count is. An `IProps` in a component library with 2+ implementers is fine.

Procedure for a suspected ghost interface:

1. List candidates: `rg 'export\s+interface\s+I[A-Z]\w*'` and `rg 'implements\s+\w+'`.
2. Confirm no second implementer exists (mock, fake, second vendor).
3. Delete the interface, drop `implements`, export the concrete type.
4. Retarget `import type { IUserService }` to the concrete type, or infer it.

If a real seam exists:

- Internal seam (an embedded database standing in for Postgres): keep the interface private to the module.
- External seam (Stripe vs a mock gateway): expose a port at the boundary and take the dependency as an argument.

## 3. Interface as test surface (reach-03)

Callers and tests cross the same seam. If you must test past the public interface, the module has the wrong shape or lacks an internal seam. Never export a private production symbol only so a unit test can reach it.

- Symptom: `_calculateItemDiscount` exported "for tests"; Knip reports it only in the default-vs-`--production` comparison (reach-03).
- Cost: refactoring internals breaks tests although behaviour is identical; autocomplete exposes the helper to production code.

Protocol "Replace, don't layer", all in one commit:

1. Remove `export` from the helper.
2. Retarget the tests at the public function's observable inputs and outputs.
3. If the internal logic is independently complex, extract a separate deep module with its own small interface and its own tests.

Never un-export alone and leave tests failing. Never keep both the leak and the new test.

## 4. Locality (struct-06, struct-08, struct-10)

Code that changes together lives together. Horizontal layers (`components/`, `hooks/`, `types/`, `utils/`, `styles/`) scatter one feature across five directories. Deleting the component then strands four zombie files and costs every reader five round trips.

- 1-to-1 rule: a helper, type or hook with exactly one consumer moves into the consumer file as a non-exported declaration if under about 25 lines and purely computational; otherwise it becomes a sibling file in the same directory.
- Rule of Three: promote to a shared `lib/` or `utils/` only if ALL of: consumed by at least 3 distinct domain features (not 3 call sites in one), domain-agnostic, has its own tests.
- Directory depth at most 4 below `src/`; no single-child folders; a component rendered only by its parent belongs inside the parent file.
- Target shape: a feature pod, e.g. `src/features/user-profile/` holding the component, its test, and a hook only if complex enough to warrant extraction.

## Output

- Procedures and verification: `structure-playbook.md`.
- Proposal badges (`STRONG`, `WORTH_EXPLORING`, `SPECULATIVE`) and the `ts-opt proposal add` contract belong to the `ts-architect` agent prompt; do not restate them here.
