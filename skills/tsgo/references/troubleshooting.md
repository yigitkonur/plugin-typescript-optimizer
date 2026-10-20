# Troubleshooting a TypeScript 7 Migration

Loaded by the `tsgo` skill when type-checking fails or behaves differently after switching a project to the native compiler.

First rule: compare diagnostics by file and TS code against the authoritative compiler (`ts-opt fit`); a difference that appears only on the native side points at config or defaults, not at code.

## Config and resolution

- Deprecation error plus unresolved root imports with `baseUrl` and wildcard `paths`: remove `baseUrl`, prefix every `paths` value with `./`, add explicit aliases for bare imports (`config-migration.md`).
- Types not resolving across pnpm workspace symlinks (`packages/a` via `node_modules/@org/a`): keep `preserveSymlinks` false or unset, and add `paths` aliases for internal packages in the root tsconfig. Reported by the source skill; confirm with a failing import before changing anything.
- Output in `dist/src/...` or TS5011/TS6059: `rootDir` default changed; set it explicitly.
- Local build passes, CI fails, or errors cite deleted files: stale `.tsbuildinfo`. Delete `*.tsbuildinfo` and the `tsBuildInfoFile` cache directory, then rerun. Do not delete anything else.

## Scripts importing `typescript`

Symptom: `TypeError: ts.createSourceFile is not a function`, or `Cannot find module 'typescript'`. TS 7.0 has no JS API.
1. If the script only needs code generation, rewrite it with template literals.
2. Otherwise use the alias scheme (`ts7-compat`); scripts then need no edit. Without it, import `@typescript/typescript6` instead.

## DOM versus worker types

Symptom: `Duplicate identifier 'ImageData'`, `Cannot redeclare block-scoped variable 'self'`. Give worker scripts their own tsconfig with a worker `lib` and no DOM; `skipLibCheck: true` is a fallback, not a fix.

## Error recipes

| Code | Cause | Fix |
|---|---|---|
| TS2532 / TS18048 "possibly undefined" | strict default, `noUncheckedIndexedAccess`, unnarrowed optional fields | narrow, or `message?.tools?.[0]?.name`; use `!` only in tests |
| TS2322 `null` not assignable to `string \| undefined` | strict null checks now on | `topicId ?? undefined` at the boundary |
| TS2304 / TS2552 / TS2591 "Cannot find name" (`process`, `describe`, `console`) | `types` now defaults to `[]` | `"types": ["node", "vitest/globals"]`; `["*"]` restores the old behaviour |
| TS7016 no declaration file | untyped dependency | install `@types/<pkg>`, or `declare module "pkg";` in `src/types/ambient.d.ts` |
| TS7006 implicit any | strict default | set `strict` explicitly, then fix or relax individual flags |
| TS1202 / TS1203 | `module` default is `esnext` | set `module` explicitly |
| TS2882 on `import "./x.css"` | `noUncheckedSideEffectImports` now true | declare `*.css` or set `false` |

Declaration-emit errors (TS4023, TS4058, `isolatedDeclarations`): see the `declaration-emit` skill.

## Memory

The native compiler does not use the V8 heap, so `--max-old-space-size` no longer affects it. Remaining Node tools (Next.js, Vitest, ESLint) still do; see `ci-ide.md` for `NODE_OPTIONS`. Cap test workers (`vitest run --maxWorkers=16`) on large machines. Do not quote memory figures from the source skill; measure.
