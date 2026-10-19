---
schema: ts-optimize/rule@1
id: type-01
version: 1
name: Type laundering
domain: types
batch: 8
wave: "4"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R, A]
requires: {}
tells:
  - {id: t1, regex: '\bas\s+any\b', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.gen.ts', '**/*.generated.ts', '**/__generated__/**']}
  - {id: t2, regex: '\bas\s+unknown\s+as\s+[A-Za-z_$({\[]', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**', '**/*.gen.ts', '**/*.generated.ts', '**/__generated__/**']}
  - {id: t3, regex: '(?<![\w$])<\s*any\s*>(?=\s*[\w$(\[{''"`!+-])', scan: code, glob: ['**/*.{ts,mts,cts}'], exclude: ['**/*.d.{ts,mts,cts}', '**/generated/**']}
astgrep: ['astgrep/type-01-as-any.yml', 'astgrep/type-01-double-cast.yml']
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT Pattern 1', 'STM §2 (replacement ladder, patterns 1-3)', 'SK Sin 1']
---
## What
`as any`, `as unknown as T` and the angle-bracket `<any>x` switch the compiler off for every downstream use of the value and hide upstream breaking changes. Dead-code engines also cannot follow reachability through `any`. The ast-grep tier removes the matches the regex tier cannot exclude: `as any` written in JSX text is not a string literal, so only the structural rules are silent there.

## Triage
Keep when:
- Test code that builds a deliberately partial mock (`{} as unknown as Service`): severity drops to advisory by `downgrade_in`, and the finding is rarely worth a fix.
- A cast at a documented FFI/untyped-library boundary that carries a comment explaining why and cannot be typed (missing `@types`).
- Generated files and `.d.ts` are excluded already; do not re-add them.
Question 3 (public contract): if the cast sits in an exported signature, the change alters the declaration emit surface; run the declaration-emit leg.
Reading rule: decide by what the value really is, not by the cast. `JSON.parse(raw) as any` is a boundary (use a schema); `(x as any).id` on an internal model is a missing type.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`, apply the first rung of the ladder that fits and stop:
1. Inference: delete the annotation or cast; let TypeScript infer the narrow type.
2. External input (HTTP, JSON, storage): `unknown` plus a guard, or `Schema.safeParse(value)` and use the parsed type.
3. Dictionary: `Record<string, unknown>`, never `Record<string, any>`.
4. Callback: an explicit call signature or `(...args: unknown[]) => unknown`.
5. Otherwise a named alias or discriminated union.
For internal literals use `satisfies`: `const theme = {...} satisfies ThemeConfig` instead of `as any as ThemeConfig`. Members touched: {{members}}; importers to re-check: {{consumers}}.

## Verification
Legs: typecheck, test, build, declaration-emit when the package has a declaration signal, and the coverage leg: the type-coverage ratio for the same metric id must not drop (`type-06`). Extra proof: `rg -n '\bas any\b' {{file}}` no longer lists the lines of this finding, and no new `as any`, `@ts-ignore` or `@ts-expect-error` appeared in the diff.

## Pitfalls
- Replacing `any` with `unknown` without a guard moves the error to every consumer; the ladder says guard first.
- Never fix by loosening `tsconfig` or adding `@ts-expect-error`.
- `as unknown as T` after `Object.entries`/`reduce` is often a missing generic on the helper, not a boundary.
- `<any>x` is invalid in `.tsx` (it parses as JSX), so that tell only runs on `.ts/.mts/.cts`.
- `Array<any>` and `Promise<any>` are type positions, not assertions; they belong to the `no-explicit-any` lint rule and to type-10/type-06, not to this rule.
- A cast removed here can resurface as `TS4023`/`TS2742` on exported symbols (type-07 wins that location).
