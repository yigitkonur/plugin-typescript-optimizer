# Where AI slop comes from

Dead-code engines report symptoms (unused file, unused export, unused dependency). The origin of the symptom decides the correct deletion unit. Pruning one flagged export out of a zombie feature leaves the corpse in the tree; deleting the feature removes dozens of findings at once. Read this before grouping or fixing findings in the `reachability`, `slop`, `struct` and `type` domains.

Five pillars organise the rule catalog: platform invariants, reachability and dead code, encapsulation, type rigor, architectural deepening. Ten "sins" (the pattern families in section 3) are the code-level signatures. Rule ids below are the catalog ids; run `ts-opt rule <id>` for the recipe.

## 1. Origins

| Origin | What the engine reports | Correct deletion unit | Rules |
|---|---|---|---|
| A. Zombie feature / dead experiment | unreferenced files, unused exports, orphaned deps | the whole feature directory plus its flag, fixtures, mocks, MSW handlers, schemas | reach-10 |
| B. Generation without cross-file memory | duplicate exports, single-file exports, type laundering | the duplicate implementation and the anti-patterns (section 3) | struct-07, type-*, slop-* |
| C. Barrel inflation and circular webs | often nothing (transitive masking); cycles via graph tools | the `export *` statement, not the module behind it | struct-01, struct-02, reach-02 |
| D. Half-finished refactor / dual abstraction | unused dependency, unreferenced adapter files | the minority library and every call site that reaches it | reach-11 |

### A. Zombie features
Features shipped behind an A/B test or remote flag (LaunchDarkly, Statsig, Unleash, PostHog) get switched off in the dashboard; the code stays because nothing in the build proves the branch dead.
- Signal: code guarded by a permanently disabled flag whose only caller is the branch itself; a feature directory that becomes unreferenced once the flag is removed; models or migrations referenced only inside the migration folder.
- A flag is dead only if the flag system says so. You cannot verify that from the repo: reach-10 is `flag-only` and needs a human to confirm against the dashboard ("disabled for more than one release cycle" is the usual bar).
- When confirmed: delete the conditional branch, then the feature directory (`git rm -r`), then paired fixtures/mocks/handlers/schemas, then re-run the engine (`ts-opt rescan --wave <id>`) to sweep sub-dependencies whose last consumer was the feature.

### B. Generation without cross-file memory
A model writing a component cannot see the rest of the repo. It re-derives helpers locally, wraps calls defensively and narrates in comments. Origin B has no remediation of its own: its signature is the whole pattern list. Suspect it when a diff shows several `formatDate` definitions in unrelated directories, `try/catch` that only rethrows, `as any` at internal boundaries, or a comment-to-code ratio above 1:3. Highest-volume manifestation: duplicate utilities (struct-07).

### C. Barrels and cycles
An `index.ts` in every directory, each `export *`-ing its siblings, and siblings importing each other back through the barrel.
- Defeats tree-shaking once CommonJS interop or side effects are involved.
- Manufactures cycles: `Button -> index -> Button`, and an export reads as `undefined` during initialisation.
- Transitive masking: dead exports behind `export *` look consumed to a graph scanner.
Remediation lives in `structure-playbook.md`.

### D. Dual abstractions
A migration (axios to ky, redux to zustand, moment to date-fns) stalls at 60%; both coexist and each keeps the other's adapter alive.
- Signal: competing libraries in one `package.json` (axios + ky, lodash + lodash-es, date-fns + dayjs + moment, redux + zustand); shadow directories (`v1/` beside `v2/`); compat adapters translating between them.
- Pick the survivor by call-site volume (`rg -c "from 'axios'"` vs `rg -c "from 'ky'"`), convert the minority's call sites, remove the package (wave 5, with the detected package manager), delete the adapter, re-run the engine for stranded types and orphaned wrappers. High risk, `assisted`.

## 2. Why the compiler does not stop it
Agents optimise for "make the compiler green". Bounded context windows plus that pressure produce code that sits in the seam between syntax checking and reachability analysis: it compiles, it is reachable by import, and it is still useless or unsound. `any` also blinds dead-code analysis, which cannot follow reachability through `any`.

## 3. Pattern families and their rules

| Family | Signature | Rule |
|---|---|---|
| Type laundering | `as any`, `as unknown as T`, `<any>x`, chained `a!.b!.c!` | type-01, type-02 |
| Schema/type dual declaration | `XSchema` (zod/valibot/yup/arktype) beside a hand-written `interface X` | type-03 |
| Defensive null paranoia | `if (x && x.y)`, optional chains 3+ deep, `?? null`, under `strictNullChecks` | type-05 |
| Barrel smog | `export *`; sibling imported through its own directory barrel | struct-01, struct-02 |
| Mock/test bleed | `mock*`, `fixture*`, `createMock*` exported from production files | slop-04, reach-03 |
| Phantom interfaces, speculative generics | single-implementer `IFoo`; unused type params and enum variants | struct-04, struct-05 |
| Anemic type guards | `val is T` whose body only checks `typeof === 'object' && !== null` | type-04 |
| Shallow passthrough wrappers | one-expression function forwarding its params unchanged | struct-03 |
| Utility dumping ground | tiny single-consumer helpers in `utils/`/`shared/`; micro-file sprawl | struct-06, struct-08 |
| Non-erasable syntax | `enum`, `namespace`, constructor parameter properties | type-08 |
| Useless try/catch | rethrow-only, blind swallow (`console.error(e); return null`), empty | slop-01 |
| Narrating comments | `// Set the user id` | slop-02 |
| Boolean theater | `? true : false`, `=== true`, redundant `!!` | slop-03 |
| Inline micro-helpers | `new Promise(r => setTimeout(r, ms))`, local `capitalize` | slop-05 |
| Duplicate utilities | `cn`, `clsx`, `formatDate`, `slugify`, `sleep`, `truncate`, `clamp`, `safeJsonParse`, `isEmpty`... defined in 2+ files | struct-07 |

## 4. Rules for using this

- Regex tells are candidate generators. The reading of the code is the arbiter ("engine locates, agent judges").
- Mechanical slop (slop-01 rethrow, slop-03) is cleared first, by the project's own lint engine, in wave `R0`, because it often removes the only consumer of a symbol. Fixing slop after pruning wastes a wave.
- Keep-when exceptions are part of the rule, not an afterthought: a `catch` that logs with context or enriches with `new Error(msg, { cause })`; optional chains over unvalidated external data (`fetch`, WebSocket, raw SQL rows, DOM traversal); an interface with two or more implementers.
- When two rules fire on the same location the primary wins and the sibling becomes `superseded` (catalog seams): reach-03 over slop-04, struct-02 over reach-02, reach-01 over reach-04/05, type-07 over reach-04/05, plat-01 over type-05, struct-07 over slop-05, type-03 over type-10.
