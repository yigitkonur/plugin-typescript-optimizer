# Type rigor: laundering ladder, strictness ladder, erasable syntax

Backs rules type-01, 02, 04, 06, 08, 09, 10, 11. Wave 4 (types) runs the declaration-emit leg when the package has a declaration signal; clear `declaration-emit` before stripping any `export`.

## 1. Any contagion

- `any` disables checking across every downstream call site: it infects variables assigned from it, permits arbitrary member access and silently bypasses signature contracts. Dead-code analysis also cannot follow reachability through it.
- Cleanup passes manufacture `any`: internalising an export tempts a model to degrade a parameter to `any` to silence a local mismatch. That turns static dead code into a runtime defect, which is worse than leaving the export.
- Measure with the ratchet metric recorded in `baseline.json` (`type-coverage@<v>`, or the proxy `escape-hatch@1` when type-coverage cannot run on the project's TypeScript). The gate fails only if the count of untyped identifiers of the same metric id rises above the baseline; the percentage is reported. Judge the delta, not an absolute number. Deleting well-typed code while `any`-heavy code remains lowers the ratio without adding an `any`: not a failure, but look at what remains.
- Exclude code nobody owns from the metric (generated clients, vendored code, route type artefacts, fixtures, `catch` bindings via the engine's ignore flags), pinned in the project's own config so local and CI score the same file set.

## 2. Replacement ladder (type-01)

Never accept `any` as a parameter, return or annotation in private or newly internalised code. Take the first row that matches.

| # | Condition | Replacement |
|---|---|---|
| 1 | Type is inferable from the assignment or literal | delete the annotation; let inference narrow it |
| 2 | Dynamic, untrusted external input (HTTP, JSON, DOM, storage) | `unknown` plus a narrowing guard before every use; at a real boundary prefer schema `safeParse` |
| 3 | Generic dictionary / property bag | `Record<string, unknown>`, never `Record<string, any>` |
| 4 | Callback or function reference | explicit call signature, or `(...args: unknown[]) => unknown` |
| 5 | None of the above | explicit alias or discriminated union |

Related replacements:

- Internal literal forced through `as any as T`: use `satisfies T`.
- `JSON.parse(raw) as any`: validate with the project's schema library; derive the type with `z.infer` (or equivalent) so schema and type cannot drift (type-03).
- Anemic guard (`val is User` checking only `typeof === 'object' && !== null`, type-04): delegate to the schema, or check every mandatory field before asserting the predicate.
- `a!.b!.c!` (type-02): add a real guard or fix the type upstream; `!` is acceptable only directly after an explicit invariant check.
- Tests: `as any` in test files is advisory, not a warning.

## 3. Catch variables (type-11)

- `useUnknownInCatchVariables` (implied by `strict`) types the caught value `unknown`. Never widen back with `catch (e: any)` or `(e as any).message`.
- Narrow: `const message = e instanceof Error ? e.message : String(e)`.
- If `strict` is not on, setting `useUnknownInCatchVariables` alone is a cheap first step (strictness ladder, section 4).

## 4. Strictness ladder (type-09 is advisory and flag-only)

Report gaps; do not auto-enable. Signals come from the resolved `extends` chain; a key absent from the chain is `null`, not `false`. Do not compute a single "health percentage": which flags matter depends on the project (`isolatedDeclarations` is irrelevant to an application).

Ladder, in the order that minimises churn:

1. `noImplicitAny`
2. `strictNullChecks` (by far the largest error volume)
3. `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`, `useUnknownInCatchVariables`
4. `noUncheckedIndexedAccess` (`record[key]` and `items[0]` become `T | undefined`)
5. `exactOptionalPropertyTypes`, then `"strict": true`
6. `verbatimModuleSyntax` (makes type-only imports enforced, which keeps cycles fixed); `isolatedDeclarations` for libraries only.

On a TS 7 target `strict` defaults to true; a project that relied on the old default is a tc-03 finding, not a type-09 one.

## 5. Migration models (choose one per package, never mix)

| | Model A: file-by-file ratchet | Model B: flag-by-flag |
|---|---|---|
| Axis | vertical: all strict flags, on whitelisted files only | horizontal: one flag at a time, all files |
| Config | `tsconfig.json` plus `tsconfig.strict.json` (`extends` base, `strict` true plus the extra flags, `include` = growing whitelist) | one `tsconfig.json` plus a suppression baseline |
| Regression defence | whitelist only grows; new files must be added to it; both configs typecheck in CI | count of tagged suppressions has a ceiling that only shrinks |
| Best for | monorepos, large apps with active teams | small codebases, shared libraries |

Model A: move whole directories into the whitelist, one directory per commit so a revert is surgical.

Model B: land each flag as its own commit. When a flag produces more than about 100 errors, baseline them with tagged suppressions rather than abandoning the flag:

- Format: `// @ts-expect-error [MIGRATION-STRICT-NULL]: burn-down tracked in #1042`.
- Every suppression carries a migration tag and a tracking link; untagged ones are indistinguishable from ordinary debt and never get removed.
- CI counts `@ts-expect-error [MIGRATION-` occurrences and fails above the ceiling; lower the ceiling in the commit that removes suppressions. `@ts-expect-error` fails once the error is fixed, so stale ones self-report.
- This tagged use is the only sanctioned `@ts-expect-error`. During a cleanup run, never use one to get a gate green.

## 6. Erasable syntax (type-08)

`erasableSyntaxOnly` (TypeScript 5.8+) forbids syntax that cannot be erased by simply deleting type annotations: `enum`, `namespace` with runtime content, constructor parameter properties (`constructor(public name: string)`), and import-assignment (`import x = require()`).

- Severity: hard if the project already enables `erasableSyntaxOnly` and it fails; warn if the pipeline strips types (Vite/esbuild/SWC/Bun/Deno/Node `--experimental-strip-types`), because those runtimes either reject or slowly transform it; otherwise advisory.
- Replace `enum` with a string-literal union or an `as const` object plus a derived union type; replace `namespace` with ES modules; declare class fields explicitly and assign them in the constructor.
- `const enum` and enums consumed across packages are public API: check `package.json#exports` consumers before touching.

## 7. Type tidying (type-10)

- Overlapping optional-property bags (`{ status; data?; error? }`): convert to a discriminated union with a literal tag; keep an exhaustiveness `never` check in the `switch` default.
- Identity aliases (`type StringId = string`): delete. Keep true brands (`string & { readonly __brand: unique symbol }`).
- Aliases that only rename a third-party type: delete, import the upstream type.
- Parallel representations (`UserDTO` / `IUser` / `UserData`): compare field sets; at 90% or more overlap pick one canonical type and use `Pick`/`Omit` for variations (type-03 wins when one of them is the schema).
- Empty `interface X extends Y {}`: delete and repoint, or collapse to `type X = Y` when the name carries meaning.
- `interface X extends Record<string, any>`: drop the index signature; isolate dynamic keys in a `metadata?: Record<string, unknown>` field.
- Dead `extends` of a parent whose members are never read: unwire the chain, then delete the parent once nothing uses it.
