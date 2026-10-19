---
schema: ts-optimize/rule@1
id: type-07
version: 1
name: Declaration-emit failure
domain: types
batch: 8
wave: "4"
severity: hard
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [T]
requires: {declaration_signal: true}
adapter: tsc:declaration-emit
primary_over: [reach-04, reach-05]
sources: ['DEC §2-§6', 'FPT §8.4 (declaration emit is not a false positive)', 'declaration-emit-failures (isolated declarations)', 'doc 05 §9 (declaration-emit leg)']
---
## What
A diagnostic from the declaration-emit leg: `TS4023`, `TS4058`, `TS4060`, `TS4081`, `TS4082`, `TS2742`, `TS2883`. `tsc --noEmit` checks the implementation graph and never builds the declaration graph, so a type can be legal in a module body and unnameable in its emitted `.d.ts`. Invariant: every type reachable from an exported signature is public API, whether or not any file imports it by name. These findings are always true defects.

## Triage
Deterministic: the compiler has proven it cannot name a type, so no keep-when dismisses the finding; keeping an `export` is the fix, not an exemption. Decide the owner by code:
- `TS4060`, `TS4081`, `TS4082`, `TS4058` after a wave edit: an `export` was stripped (reach-04/05) from a type used in a public signature. Revert or re-export.
- `TS4023`, `TS2742`: a missing explicit annotation on an exported symbol whose inferred type comes from a dependency or an unexported local (common with Prisma, Drizzle, zod, tRPC under pnpm). Annotate; do not re-export.
- `TS2883`: a private leak through an alias under `isolatedDeclarations`.
Seam: this rule is primary over reach-04/05 for the same symbol; the finding becomes "keep the export; register as public".

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`, choose one and never a suppression:
1. Restore `export` on the constituent type and record it as an intentional public export (Knip `@public` tag or entry).
2. Inline the structural type when it is at most three members and referenced by exactly one signature.
3. Name the inferred type and annotate the public symbol:
```diff
-export const parseUser = (input: unknown) => userSchema.parse(input);
+export type User = z.infer<typeof userSchema>;
+export const parseUser = (input: unknown): User => userSchema.parse(input);
```
For `TS2742` when annotation is impractical: hoist the offending dependency so one copy resolves (`pnpm.overrides`, `resolutions`) or add a `paths` entry. Consumers to re-check: {{consumers}}.

## Verification
Leg: `declaration-emit`. Single project: `<tsc> -p <cfg> --declaration --emitDeclarationOnly --outDir <os-tmp> --tsBuildInfoFile <os-tmp>/x` (add `--noEmit false` only when probing shows it is needed). Composite: `-b --emitDeclarationOnly`, then `-b --clean`, then assert `git status --porcelain` is unchanged. Probe `TS5053`, `TS5094`, `TS5065` once at baseline and record the variant. Also typecheck, test, build.

## Pitfalls
- `@ts-ignore` and `@ts-expect-error` cannot suppress these: the declaration emitter, not the checker, raises them. Never disable `declaration` either.
- Do not write emitted `.d.ts` into the source tree; always a temp `--outDir`.
- Under `isolatedDeclarations`, add explicit annotations to every exported function before enabling the flag, not after.
- Stale `.tsbuildinfo` can mask a failure: clean before re-running composite builds.
