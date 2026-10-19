# Lint bridge (wave B)

Wave `B` runs the project's own lint engine's autofix, under the project's own config, to clear residue created by earlier waves. It sits after wave 3 because un-export residue (`TS6133`) does not exist before then and would pollute wave 4's diff if cleaned later. Backs reach-06, slop-01, slop-03. The edit is made by the user's tool, never by plugin code.

## 1. What wave B does

- `ts-opt run wave begin B` runs the lint engine in report mode plus `tsc`'s `TS6133`/`TS6192`/`TS6196`, then writes one `reach-06` finding whose `touches` are the files changed since the run base that have residue. That finding is part of the approved wave-3 set, not a new approval.
- Sub-kinds of residue: un-export residue (a now-private helper nothing calls), dangling import specifier left by a removed export, pre-existing unused locals, and intentional `_` bindings.
- A dangling specifier whose export was removed (`TS2305`) is a consumer fix, not an autofix: restore the export or edit the consumer in the same wave.
- Get the autofix command from `ts-opt detect` (`lint.autofix`); do not compose it yourself.

## 2. Engine priority (exactly one wins)

Ultracite, then Biome, then Oxlint, then ESLint flat config, then ESLint legacy. Never install an engine, and never rewrite the project's engine configuration. If no engine is found, wave B is skipped and the residue is fixed by `assisted` edits driven by `TS6133`.

| Engine | Unused-only autofix shape | Notes |
|---|---|---|
| Ultracite | wrapper over Biome/ESLint; no unused-only mode | confine to the run's files (its `--staged` mode) |
| Biome | `check --write --only=correctness/noUnusedVariables,correctness/noUnusedImports <files>` | formats and sorts imports; `--unsafe` is separate |
| Oxlint | `--fix -D no-unused-vars <files>` | does not format; `--fix-dangerously` is separate |
| ESLint | `--fix --rule 'unused-imports/no-unused-imports: error'` only if that plugin is installed | otherwise `@typescript-eslint/no-unused-vars` has no autofix for variables |

Formatter and linter changes land in one commit. In monorepos, pass explicit file lists or filter to the packages touched, not the whole workspace.

## 3. Scope

- Only files changed in this run (`git diff --name-only <run-base>...HEAD`). Never run autofix repo-wide: it rewrites code you were never approved to touch, and the commit scope check will reject it.
- Never let autofix remove an export.
- `_`-prefixed bindings are the contract for deliberate non-use. Configure the engine to honour it (`argsIgnorePattern`, `varsIgnorePattern`, `caughtErrorsIgnorePattern`, `destructuredArrayIgnorePattern`; `noUnusedFunctionParameters` in Biome), or propose that as a finding. Never disable `noUnusedVariables` repo-wide: it hides the very residue this wave detects.

## 4. Denylist (never autofixed during a run)

Source of truth: `catalog/lint-denylist.json`. Each rule rewrites behaviour, exports or types, not just style.

| Rule | Why it is excluded |
|---|---|
| `import/no-default-export`, `import/prefer-default-export` | flips export style; breaks framework routers (Next, Remix, Astro) and Knip entries |
| `@typescript-eslint/no-explicit-any` | replaces `any` with `unknown` or casts; breaks generic constraints and consumers |
| `@typescript-eslint/no-non-null-assertion` | removes `!`, changing compile errors and runtime paths |
| `@typescript-eslint/no-floating-promises` | prefixes `void`, silencing unhandled rejections instead of awaiting; fatal for Workers `ctx.waitUntil` patterns |
| `prefer-const` | allowed only when the scope is provably local; closures and async callbacks can reassign |
| `no-param-reassign` | rewrites mutation contracts in libraries and state managers |
| `react-hooks/exhaustive-deps` | adds dependencies, causing re-render loops |
| Biome `--unsafe`, Oxlint `--fix-dangerously` | may remove code with side effects (imports with initialisers); only with explicit per-finding approval and a diff-shape review |

Safe: import sorting and deduplication, trailing commas, quote and semicolon normalisation, whitespace and EOF normalisation, unused import/variable removal.

## 5. Verify the bridge stayed behaviour-invariant

- `git diff --stat` shows only files in the finding's `touches`.
- A safe pass changes whitespace, imports and punctuation. A hunk that changes an identifier, signature or control flow is a red flag: revert that file and mark the residue `assisted`.
- Then run `ts-opt gate --wave B`. Required legs: see `gate-spec.md`. Never commit an autofix diff that has not passed it.
- If the engine itself cannot run on the project's TypeScript (typescript-eslint on TS 7), the lint leg is `untrusted`; do not substitute another engine. Use `assisted` edits.
- anti-slop (Oxlint JS plugin): never vendored or installed by the plugin. If `tools/oxlint/anti-slop/` already exists its diagnostics may be consumed read-only as high-precision candidates for type-01-family rules.

## 6. Failure handling

- Gate red after the bridge: `ts-opt bisect --wave B`, revert the culprit with `ts-opt revert`, re-gate. The residue it touched becomes an `assisted` edit.
- Engine exits non-zero because of pre-existing violations unrelated to residue: that is not a bridge failure. Read the output, restrict to the unused-only form above, and do not widen the rule set.
- Hooks (husky, lint-staged, commitlint) may reformat or reject the commit: `ts-opt commit` surfaces the hook output. Fix the cause; never bypass the hook.
- After the bridge, re-run `ts-opt rescan --wave B` so the later type and dependency waves see the current graph.
