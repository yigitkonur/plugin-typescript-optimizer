---
schema: ts-optimize/rule@1
id: struct-01
version: 1
name: Barrel smog
domain: structure
batch: null
wave: "2"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: file
triage: agent
semantic_invariance: false
modes: [standard, deep]
engines: [R, K]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*export\s+(?:type\s+)?\*\s*from\b', flags: 'm', scan: code, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '^[ \t]*(?:(?:import|export)\b[^\x27"\n;]*?|\})[ \t]*\bfrom\s*[\x27"](?:\.{1,2}/index(?:\.[cm]?[jt]sx?)?|\.{1,2}/?)[\x27"]', flags: 'm', scan: raw, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
primary_over: []
sources: ['CAT Pattern 4', 'CAT Origin C', 'STR §5', 'doc 06 §14']
---
## What
A directory `index.ts` that re-exports everything with `export * from './x'` (t1), or a module that reaches one of its own siblings through its own directory barrel, `import { Avatar } from '../index'` / `from '.'` (t2). Wildcards defeat tree-shaking, make the real public surface unreadable, and manufacture import cycles: `Button -> index -> Button` initialises as `undefined`. A barrel is decided by content (most statements are re-exports), never by the file name `index.ts`; an `index.ts` holding real code is not a barrel.

## Triage
Keep when:
- The barrel is the declared public entry of a package (`package.json#exports|main|module|types` points at it). Then keep the file and replace wildcards with explicit named exports (`export { Button, type ButtonProps } from './Button'`) so the surface is a decision, not an accident.
- `export * as ns from './x'` (namespace re-export): not matched, not a finding.
- Framework conventions that require an `index` re-export (Storybook indexes, generated route tables).
Reading rule: confirm with the importer index (`{{consumers}}`) which symbols outside the directory actually use the barrel. Consumers that import through it from elsewhere in the same directory are the cycle risk (t2); consumers elsewhere are the public surface.

## Proposed change
In `{{file}}` ({{package}}):
1. For t2 hits: replace the barrel import with the direct sibling path, no behavior change.
```diff
-import { Avatar } from '../index';
+import { Avatar } from '../avatar/Avatar';
```
2. For t1 hits: replace each wildcard with explicit named re-exports of the symbols that have consumers outside the directory (`{{members}}`); drop symbols with none (they become reach findings, wave 2 re-scan).
```diff
-export * from './Button';
-export * from './Charts';
+export { Button, type ButtonProps } from './Button';
```
3. Heavy subsystems (tables, charts, editors): point consumers at the leaf module directly; the barrel entry may then be deleted when nothing else uses it.
4. Shared types that caused the barrel round-trip move to a leaf module (`types.ts`) with zero imports. Touch at most 5 files per unit; split larger barrels into sequential findings. Files: {{touches}}.

## Verification
Wave 2 legs: typecheck, test, build, `cycles` no-new fingerprints. Run `ts-opt rescan --wave 2`: orphaned modules cascade to wave 1 as `origin: cascade`. Public-package barrels also need the declaration-emit check when a declaration signal exists. A pure import-path edit must not touch test assertions.

## Pitfalls
- `export *` also re-exports types and values you cannot see; deleting a wildcard can break external consumers of a published package. Check `exports`/`types` first.
- Do not turn a barrel into a single giant explicit list that repeats the same smog; prefer fewer, smaller entry points.
- A string or comment that contains `export * from` is not a match (tier-1 blanks them); t2 reads raw text, so a template literal that spells an import can match: judge by reading the file.
- `from '@/components'` style alias barrels are not visible to regex; the importer index reports them.
