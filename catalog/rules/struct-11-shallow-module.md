---
schema: ts-optimize/rule@1
id: struct-11
version: 1
name: Shallow module (deepening opportunity)
domain: structure
batch: null
wave: "R"
severity: advisory
fix_risk: high
fix_mode: flag-only
grain: file
triage: agent
semantic_invariance: false
modes: [deep]
engines: [H]
requires: {}
adapter: architect
primary_over: []
sources: ['STR §8 (Architectural Deepening)', 'STR Tenet 1', 'STR Tenet 2 (Interface as Test Surface)', 'STR Tenet 3 (Seam Test)']
---
## What
A module whose interface is wide and whose implementation is thin: 15 exported functions of two lines each, a class that only forwards, a service that exists as a name. The Deletion Test decides: imagine deleting the module. If its complexity vanishes completely it was shallow, inline it (struct-03 handles the mechanical one-call cases). If the complexity reappears and duplicates across N callers it is a deep module that must be preserved and deepened: depth is leverage at the interface, capability per unit of API surface a caller has to learn, not a lines ratio. This is a `ts-architect` finding in deep mode and carries a mandatory `recommendation` badge.

## Triage
The architect applies, in order: Deletion Test; Seam Test (an interface or port needs at least two adapters in the repository, e.g. production plus an in-memory fake; one adapter is a hypothetical seam); Interface as Test Surface (tests cross the same seam as callers, never export a private helper for a test: reach-03); Locality (1-to-1 rule, Rule of Three, depth ≤ 4). Output fields: `deletion_test`, `seam_test`, `files ≤ 5`, optional before/after Mermaid, `plan_steps[]`. Badges: `STRONG` (inline a single-use passthrough, remove a cyclic barrel), `WORTH_EXPLORING`, `SPECULATIVE` (hexagonal ports and adapters). Only `STRONG` is schedulable by default. Reject when the module is cold, the interface is a published contract, or the thinness is the point of a deliberate anti-corruption layer.

## Proposed change
Flag-only. Two directions, chosen by the Deletion Test, for `{{symbol}}` in `{{file}}`:
```diff
 // shallow: inline (callers already understand the target)
-const user = await fetchUserById(userId);
+const user = await apiClient.get<User>(`/users/${userId}`);
```
```diff
 // deep-in-waiting: deepen behind the same small interface
 export async function fetchUserById(id: string): Promise<User> {
+  const cached = userCache.get(id);
+  if (cached && !cached.isStale()) return cached.data;
+  const raw = await apiClient.get(`/users/${id}`, { retry: 2 });
+  const validated = UserSchema.parse(raw);
+  userCache.set(id, validated);
+  return validated;
 }
```
Deepening adds behavior and is therefore never an automatic edit; it is a design change for the user to approve, with its own tests. Consumers: {{consumers}}.

## Verification
Not applied here. A follow-up inlining runs the struct-03 gate (typecheck, test, build; zero assertion edits); a follow-up deepening needs new tests that cross the public interface only, plus the full gate. Both are separate findings with their own approval.

## Pitfalls
- Do not call a module shallow because it is short; call it shallow when deleting it makes the complexity disappear.
- Deepening by adding generic options to a thin wrapper recreates speculative generality (struct-05).
- A mock seam that tests rely on is real even with one production adapter if the second adapter is the test fake: count it.
- `SPECULATIVE` proposals appear in the report but are never scheduled.
