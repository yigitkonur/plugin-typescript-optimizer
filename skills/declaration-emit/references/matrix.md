# Declaration-emit diagnostic matrix

Loaded by the `declaration-emit` skill. Backs type-07 (declaration-emit failure) and the mandatory pre-check of reach-04 and reach-05.

## 1. The invariant

`tsc --noEmit` checks the implementation graph. It never builds the declaration graph. A type can be legal inside a module body and illegal in that module's emitted `.d.ts`; the compiler finds out only when it emits.

Every type reachable from an exported signature (parameters, return type, inferred type, default export, alias constituents) is part of the public API, whether or not any file imports it by name. Unused-export analysis counts name-level imports; declaration emit counts signature reachability. When they disagree the compiler wins.

Typical crash: `interface Opts {}` loses its `export` because nothing imports it, while `export function f(o?: Opts)` stays. Typecheck passes; emit fails; in a project-reference graph every downstream package fails too.

## 2. When it applies

The gate's `declaration-emit` leg exists only when the package has a declaration signal: `declaration`, `composite`, `isolatedDeclarations` or `emitDeclarationOnly` true in the resolved tsconfig; or `package.json` has `types`, `typings` or `exports[*].types`; or `main`/`module`/`exports` point into `dist/`. With a signal, the check is mandatory for every export-pruning commit. With none, `tsc --noEmit` is enough. `ts-opt detect --json` reports `declaration_signal` per package (the brief shows `declaration-emit: <dirs>` on its `gate:` line); do not re-derive it by grep.

## 3. Matrix

Message text is paraphrased; the compiler's own message is authoritative. All codes below come only from declaration emit, so they are always true defects, never false positives.

| Code | Meaning | Owner (what caused it) | Remedy |
|---|---|---|---|
| TS4023 | exported variable uses a name from another module that cannot be named | missing annotation | annotate the exported variable with an exported type; do not re-export to appease it |
| TS4058 | return type of exported function uses a name from another module that cannot be named | missing annotation | add an explicit return type that is nameable (import the type) |
| TS4060 | return type of exported function uses a private name | stripped `export` (wave 3 or 4 regression) | restore `export` on the type, or return a public type or an inlined structure |
| TS4081 | exported type alias uses a private name | stripped `export` | restore `export`, or inline the structure into the alias |
| TS4082 | default export uses a private name | stripped `export` | export every constituent type and annotate the default export |
| TS2742 | inferred type cannot be named without a reference to another package path (not portable); common under pnpm and monorepos with zod, Prisma, Drizzle, tRPC | missing annotation | explicit type annotation on the public symbol (name it first, for example `type User = z.infer<typeof schema>`); structural fallback: a single hoisted copy of the dependency or a nameable path |
| TS2883 | an alias exposes a type that is not exported (the source ties it to `isolatedDeclarations`) | leak through an alias | export the constituent, or flatten the alias; with `isolatedDeclarations` every exported symbol needs an explicit locally resolvable annotation |

Ownership summary:

- Stripped `export` (TS4060, TS4081, TS4082): revert the strip or re-export. This is a mistake in this run.
- Missing annotation (TS4023, TS4058, TS2742): annotate. Do not "fix" by exporting more.
- Alias leak (TS2883): export or flatten.
- Violations of `isolatedDeclarations` itself are reported as their own errors demanding explicit annotations; add explicit return and variable annotations to every exported symbol before enabling the flag, not after.

Fix choice for stripped exports:

- Fix A, restore the export and register the symbol as an intentional public export (the finding becomes "keep export", per the type-07 over reach-04/05 seam).
- Fix B, inline the structure: only when the shape is 3 members or fewer and referenced by one signature; otherwise it duplicates.
- Default exports are the riskiest: no name to fall back on, so parameters and return type must resolve to exported symbols.

## 4. Verification commands

`<tsc>` is the project's own compiler resolved by the package manager (for example `pnpm exec tsc`, `yarn run tsc`, `bun x tsc`, `npm exec -- tsc`) or `node_modules/.bin/tsc`. Never bare `npx tsc`. On TypeScript 7 `tsc` is the native compiler and the commands are identical. Inside a run, prefer `ts-opt gate --wave 3 --legs declaration-emit` (wave 4 or `P` as appropriate); it does all of this as a probe: it is logged but never stands in for the wave's own gate record. Outside a run:

Single project, emitting into a disposable directory (never into the source tree). Run emit, search and cleanup in one Bash call: a shell variable does not survive into the next call.

```
D=$(mktemp -d); <tsc> -p tsconfig.json --declaration --emitDeclarationOnly --outDir "$D" --tsBuildInfoFile "$D/x" --pretty false; rg -n "\bSYMBOL\b" "$D"; rm -rf "$D"
```

- Add `--noEmit false` only if that tsconfig sets `noEmit: true`.
- `TS5053` (`--emitDeclarationOnly` with `--noEmit`) means the config forces `noEmit`; add `--noEmit false` and retry.
- `--isolatedDeclarations` requires `--declaration` (`TS5069` otherwise).

Composite or solution (`tsc -b` rejects `--outDir`, `TS5065`, so it writes beside the sources and must be cleaned):

```
<tsc> -b --clean
<tsc> -b --emitDeclarationOnly
<tsc> -b --clean
git status --porcelain
```

`--clean` is mandatory: stale `.tsbuildinfo` hides fresh emit failures and emitted `.d.ts` files otherwise litter the tree. The final `git status --porcelain` must match what it was before you started.

Is `tsc -b --noEmit` allowed here? Do not guess from the version. If `<tsc> -b --noEmit` exits with `TS5094`, use the emit-then-clean form above; the gate records this once per run as the leg variant.

List only the relevant diagnostics (same single call, same cleanup):

```
D=$(mktemp -d); <tsc> -p tsconfig.json --declaration --emitDeclarationOnly --outDir "$D" --tsBuildInfoFile "$D/x" --pretty false 2>&1 | rg 'TS(4023|4058|4060|4081|4082|2742|2883)' | sort -u; rm -rf "$D"
```

## 5. Pre-un-export checklist (run for every type symbol before removing `export`)

1. Exported signature in the same module names it? `rg -n --multiline "export[^\n]*\bSYMBOL\b" <file>` as a cheap pre-filter; the compiler is the authority.
2. An exported symbol infers it? Un-annotated `export const` and `export function` leak inferred types grep cannot see. Annotate those first, then continue.
3. Does it appear in the emitted declarations? Emit once into a temp directory (section 4: the search is part of the same call). Any hit means it is part of the published surface: do not un-export; keep the export and register it as intentional public API.
4. Strip the `export`.
5. Re-run the full section 4 verification (or the probe `ts-opt gate --wave 3 --legs declaration-emit`, which is logged but never stands in for the wave's gate record), plus the normal typecheck.
6. On failure choose one remediation: restore the `export`, inline the structure, or add an explicit annotation. Do not commit while any step fails: a green `tsc --noEmit` beside a red `-b` means the regression is in the tree and will surface in consumer packages.

## 6. Never suppress

`// @ts-ignore` and `// @ts-expect-error` cannot silence declaration-emit errors: the declaration emitter raises them, not the checker. Do not turn off `declaration`, `composite` or `isolatedDeclarations`, loosen the tsconfig, or delete the leg to get green. A declaration-emit diagnostic is never a false positive in triage.
