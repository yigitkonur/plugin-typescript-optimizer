---
schema: ts-optimize/rule@1
id: tc-07
version: 1
name: Editor and language-server configuration
domain: toolchain
batch: null
wave: "T4"
severity: advisory
fix_risk: low
fix_mode: flag-only
grain: project
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [X]
requires: {}
adapter: "fit:editor-config"
primary_over: []
sources: ['UG ide-and-lsp-configuration.md', 'doc 08 §3 defect 9', 'typescript-go README', 'doc 05 §8.4 T4']
---
## What
`.vscode/settings.json` (and equivalent editor files) that make the editor disagree with the CLI after the compiler switch: a `typescript.tsdk` that points nowhere or at a different version than the workspace, no prompt to use the workspace version, or stale editor-specific compiler paths. The symptom is the IDE showing outdated type errors while `tsc --noEmit` passes. This rule is advisory and flag-only: the plugin shows a suggested diff and never edits editor settings. **Re-verify before relying on it:** the native language service and its settings are in preview and change; the source skill's `typescript.native.enabled` and `typescript.native.maxMemoryMB` have no source and are **dropped**. The documented preview setting is `js/ts.experimental.useTsgo` together with the native-preview extension.

## Triage
Deterministic from the settings file. Keep when the team uses an editor other than VS Code/Cursor (Neovim, Helix, Zed) and has its own LSP setup, or when the repo intentionally keeps TS 6 editor tooling because a framework (Vue, Svelte, Astro, Angular templates) needs the JS language service: with the alias scheme (tc-04) `node_modules/typescript` is TS 6, and that is the SDK the template tooling wants.

## Proposed change
Flag-only suggested diff for `{{file}}`:
```diff
 {
+  "typescript.tsdk": "node_modules/typescript/lib",
+  "typescript.enablePromptUseWorkspaceTsdk": true
 }
```
Add, only for users who opt into the preview native language service and have installed the extension (marked advisory + re-verify): `"js/ts.experimental.useTsgo": true`. Troubleshooting steps to quote in the report: Command Palette, `TypeScript: Restart TS Server`, then `TypeScript: Select TypeScript Version…`, then `Use Workspace Version`. For Neovim/Helix/Zed: point `vtsls` or `ts_ls` at the workspace binary, or run the native language server directly (see the editor's own docs).

## Verification
Nothing runs in the gate: editors are not part of it. The report states what to check by hand: open a file with a deliberate type error, confirm the editor and `tsc --noEmit` agree, and read the status bar version. The fit probe records the tsdk path and whether it exists on disk.

## Pitfalls
- The settings file is committed to the repo and affects every developer; a personal preference does not belong there.
- `typescript.tsdk` with the alias scheme points at TS 6 by design; do not "fix" it to the native binary.
- Editor extensions bundle their own TypeScript when `tsdk` is unset; an unset value is a finding only when the CLI version differs.
- Never invent `typescript.native.*` keys; if a setting cannot be sourced, leave it out.
