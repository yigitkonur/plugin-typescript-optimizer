---
name: declaration-emit
description: Fix or prevent declaration-emit failures - TS4023, TS4058, TS4060, TS4081, TS4082, TS2742, TS2883, "cannot be named", "inferred type of ... cannot be named without a reference", "has or is using private name". Also use before removing an export from a package that publishes .d.ts files.
allowed-tools: Read Grep Glob Edit Bash(ts-opt *)
---

# Declaration emit

1. **The invariant.** Every type reachable from an exported signature is part of the public API, whether or not any file imports it by name. `tsc --noEmit` never builds the declaration graph, so unused-export analysis and typecheck can both be green while emit fails.
2. **Read the code first.** The matrix in `${CLAUDE_SKILL_DIR}/references/matrix.md` names the owner of each diagnostic:
   - TS4060, TS4081, TS4082: an `export` was stripped. Restore it (or inline the structure); this is a mistake in the current run.
   - TS4023, TS4058, TS2742: an annotation is missing. Name the type (`type User = z.infer<typeof schema>`) and annotate the exported symbol. Do not "fix" it by exporting more.
   - TS2883: a type leaks through an alias, usually under `isolatedDeclarations`. Export the constituent or flatten the alias.
3. **Before removing an export** from a package with a declaration signal (`ts-opt detect` reports `declaration_signal`):
   - grep for the symbol in every exported signature of the package, including default exports and alias constituents;
   - emit to a temp directory (`tsc --declaration --emitDeclarationOnly --outDir <tmp>` with the package's own tsconfig) and grep the emitted `.d.ts` for the name;
   - strip the `export`, emit again, and compare. A new TS40xx means the export stays, and the finding becomes "keep export".
4. **Never suppress.** `@ts-ignore` and `@ts-expect-error` cannot silence declaration-emit errors, and `skipLibCheck` hides them from consumers rather than from you.
5. **Inside a ts-optimize run**, check with `ts-opt gate --legs declaration-emit`. A failure there is a finding to restore, not a leg to disable.
