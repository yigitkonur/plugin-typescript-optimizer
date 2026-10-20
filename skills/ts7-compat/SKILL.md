---
name: ts7-compat
description: TypeScript 7 / tsgo compatibility knowledge - what breaks (the JavaScript compiler API is absent until 7.1, removed options, new defaults), which tools fail (typescript-eslint, ts-morph, ts-node, ts-jest, type-coverage, Knip v5) and the alias scheme with @typescript/typescript6 and tsc6. Use for "does not support TS 7", "TypeScript 7", "tsgo", "native-preview", ERESOLVE typescript, "Cannot find module 'typescript'" after an upgrade.
allowed-tools: Read Grep Glob
---

# TypeScript 7 compatibility

Knowledge only: this skill never edits files. For a guided migration, point the user to `/ts-optimize:tsgo`; for the data behind the tables, `ts-opt fit` reads the repository.

1. **What changed.** `tsc` in `typescript@7` is the native (Go) compiler. It has **no JavaScript compiler API until 7.1**: anything that does `require('typescript')` or `import ts from 'typescript'` — directly or inside a tool — breaks. Options removed or changed in 7 (`target es5`, `downlevelIteration`, `moduleResolution node|node10|classic`, `baseUrl`, `module amd|umd|systemjs|none`, `alwaysStrict: false`) are hard errors; defaults changed (`strict` true, `types` `[]`, `module` esnext, `rootDir` `./`). Detail and symptoms: `${CLAUDE_SKILL_DIR}/references/breaks.md`.
2. **Which tools break.** typescript-eslint and `eslint-config-next` throw at startup; ts-morph breaks; ts-node crashes (replace with `tsx`); ts-jest breaks; type-coverage and madge/dpdm break or crash; Knip v5 breaks (Knip v6 is fine); template checkers (`vue-tsc`, Svelte/Astro/Angular, MDX) need TypeScript 6. Biome, Oxlint, Prettier, Vite, esbuild, SWC, Rolldown, tsx, Bun and Deno are unaffected. The repo-specific list comes from `ts-opt fit`, not from this table.
3. **The alias scheme** (Microsoft's documented side-by-side setup) in `package.json`:
   ```json
   "typescript": "npm:@typescript/typescript6@^6",
   "@typescript/native": "npm:typescript@^7"
   ```
   `tsc` is then native; `tsc6` and every `require('typescript')` are TypeScript 6. Caveat: frameworks that type-check through the resolved `typescript` (`next build`, `vite-plugin-checker`) use TypeScript 6 until their 7.1 support lands. Details: `${CLAUDE_SKILL_DIR}/references/alias-scheme.md`.
4. **Order matters.** Attach the bridge before TypeScript 6 is removed; modernise the config before switching the compiler.

For a full guided migration run `/ts-optimize:tsgo` (`check` first: it changes nothing).
