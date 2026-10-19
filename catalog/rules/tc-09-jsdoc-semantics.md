---
schema: ts-optimize/rule@1
id: tc-09
version: 1
name: JavaScript and JSDoc semantic differences
domain: toolchain
batch: null
wave: "T1"
severity: warn
fix_risk: medium
fix_mode: flag-only
grain: package
triage: deterministic
semantic_invariance: false
modes: [tsgo]
engines: [R, X]
requires: {allowJs: true}
tells:
  - {id: t1, regex: '@enum\b', scan: comments, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
  - {id: t2, regex: '@(?:constructor|class)\b', scan: comments, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
  - {id: t3, regex: '@\w+[ \t]+\{(?:\s*[?!][A-Za-z_$(\[{]|[^{}\n]*\bfunction\s*\(|\s*\*\s*\}|[^{}\n]*=\s*\}|\s*\.\.\.\s*[A-Za-z_$]|[^{}\n]*[A-Za-z]\.<)', scan: comments, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
  - {id: t4, regex: '\b[A-Z][\w$]*\.prototype\.[\w$]+\s*=(?!=)', scan: code, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
  - {id: t5, regex: '\bfunction\s+[A-Z][\w$]*\s*\([^)]*\)\s*\{(?:[^{}]|\{[^{}]*\})*?\bthis\.[\w$]+\s*=(?!=)', scan: code, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
  - {id: t6, regex: '^[ \t]*(?:module\.exports(?:\.[\w$]+)?|exports\.[\w$]+)[ \t]*=(?!=)(?:(?=[\s\S]*^[ \t]*(?:import\s+(?:[\w$*{]|[\x27"])|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)))|(?<=^[ \t]*(?:import\s+(?:[\w$*{]|[\x27"])|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*))[\s\S]*))', flags: 'm', scan: code, glob: ['**/*.{js,jsx,mjs,cjs}'], exclude: ['**/*.min.js', '**/dist/**', '**/generated/**']}
adapter: "fit:jsdoc-semantics"
primary_over: []
sources: ['TS 7.0 announcement and microsoft/typescript-go CHANGES.md (NEW rule, no source skill content)', 'doc 05 §8.3 step 3', 'doc 01 §6']
---
## What
In packages that type-check JavaScript (`allowJs` / `checkJs`), the native compiler's treatment of JSDoc and JavaScript patterns differs from the JS compiler's. This rule is new in the plan and has no source-skill content; the tells list the constructs to inspect, and the `fit:jsdoc-semantics` adapter confirms by comparing native and authoritative diagnostics on the JS files only. **Verify the construct list against the typescript-go CHANGES.md and the 7.0 announcement at run time**: a tell without a diagnostic delta stays a candidate, not a defect. Tells: t1 `@enum`; t2 `@class` / `@constructor`; t3 Closure-style types in JSDoc braces (`{?string}`, `{!Object}`, `{function(string): number}`, `{*}`, `{string=}`, `{...number}`, `{Array.<string>}`); t4 `Foo.prototype.bar = …`; t5 constructor functions (`function Person(name) { this.name = name }`); t6 `module.exports` / `exports.x =` in a file that also has ESM `import`/`export`.

## Triage
Deterministic for detection; flag-only because the right rewrite is a design choice. Keep (false positive) when:
- The JS file is excluded from the project (`include`/`exclude`, no `checkJs`) and nothing type-checks it.
- The JSDoc is valid TypeScript-flavoured JSDoc (`{string[]}`, `{Promise<string>}`, `@typedef`, `@template`, `{string | null}`): not matched.
- A pure CommonJS file (no ESM statements) with `module.exports`: not a mix.
Escalate when the adapter shows native errors in these files that the authoritative compiler does not report.

## Proposed change
Flag-only suggested diffs for `{{file}}` ({{package}}):
```diff
-/** @enum {string} */
-const Color = { RED: 'red' };
+const Color = /** @type {const} */ ({ RED: 'red' });
```
```diff
-/** @param {?string} name */
+/** @param {string | null} name */
```
```diff
-function Person(name) { this.name = name; }
-Person.prototype.greet = function () { return 'hi ' + this.name; };
+class Person {
+  /** @param {string} name */
+  constructor(name) { this.name = name; }
+  greet() { return 'hi ' + this.name; }
+}
```
For a CJS/ESM mix, choose one module system per file (`package.json#type`, `.cjs`/`.mjs`). Alternatively migrate the file to TypeScript. Plan the work as an explicit follow-up; the plugin does not rewrite JavaScript semantics.

## Verification
Re-run the fit probe: the native diagnostic multiset restricted to JS files equals the authoritative one, or every difference is classified in the known-divergence table. Authoritative typecheck, test and build stay green on any edited file.

## Pitfalls
- Rewriting `function Person` to a class changes `this`/`new`/hoisting behaviour and call-without-`new` semantics: check all call sites.
- Many of these constructs are legal and common in libraries published as plain JS; `checkJs: false` packages are unaffected.
- The t6 tell reads the whole file, so one line of ESM anywhere flags every `module.exports` assignment; read the file.
- Do not blanket-add `// @ts-nocheck` to silence the native compiler.
