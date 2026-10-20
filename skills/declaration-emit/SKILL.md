---
name: declaration-emit
description: "Use for declaration-emit (.d.ts) failures: TS4023, TS4058, TS4060, TS4081, TS4082, TS2742, TS2883, \"has or is using private name\", \"cannot be named\", isolatedDeclarations errors; and before removing or un-exporting a type from a library that emits .d.ts (declaration, composite or a types field). Not for ordinary type errors."
allowed-tools: Read Grep Glob Bash(ts-opt gate *) Bash(ts-opt detect *)
---

# Declaration emit

1. **The invariant.** Every type reachable from an exported signature is part of the public API, whether or not any file imports it by name. `tsc --noEmit` never builds the declaration graph, so unused-export analysis and typecheck can both be green while emit fails.
2. **Read the code first.** The matrix in `${CLAUDE_SKILL_DIR}/references/matrix.md` names the owner of each diagnostic:
   - TS4060, TS4081, TS4082: an `export` was stripped. Restore it (or inline the structure); this is a mistake in the current run.
   - TS4023, TS4058, TS2742: an annotation is missing. Name the type (`type User = z.infer<typeof schema>`) and annotate the exported symbol. Do not "fix" it by exporting more.
   - TS2883: a type leaks through an alias, usually under `isolatedDeclarations`. Export the constituent or flatten the alias.
3. **Before removing an export** from a package with a declaration signal (`ts-opt detect --json` reports `declaration_signal`; the brief shows `declaration-emit: <dirs>` on its `gate:` line):
   - grep for the symbol in every exported signature of the package, including default exports and alias constituents;
   - emit to a temp directory and grep the emitted `.d.ts` for the name, using the exact commands in `${CLAUDE_SKILL_DIR}/references/matrix.md` §4 (emit, grep and cleanup in one Bash call);
   - strip the `export`, emit again, and compare. A new TS40xx means the export stays, and the finding becomes "keep export".
4. **Never suppress.** `@ts-ignore` and `@ts-expect-error` cannot silence declaration-emit errors, and `skipLibCheck` hides them from consumers rather than from you.
5. **Inside a ts-optimize run**, probe with `ts-opt gate --wave 3 --legs declaration-emit` (wave 4 or `P` as appropriate: a leg only runs when the wave lists it). It is a probe; the wave's own `ts-opt gate --wave <W>` is the record. A failure is a finding to restore, not a leg to disable.
