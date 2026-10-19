---
schema: ts-optimize/rule@1
id: slop-02
version: 1
name: Narrating and obvious comments
domain: slop
batch: null
wave: "R"
severity: advisory
fix_risk: low
fix_mode: assisted
grain: file
triage: agent
semantic_invariance: false
modes: [deep]
engines: [R, G]
requires: {}
tells:
  - {id: t1, regex: '^[ \t]*\/\/[ \t]*(?:sets?|gets?|returns?|calls?|updates?|deletes?|fetches?|creates?|increments?|initiali[sz]es?|defines?|declares?|loops?[ \t]+(?:through|over))\b(?:[ \t]+(?:the|a|an)\b)?(?:[ \t]+[\w$.]+){0,2}[ \t]*\.?[ \t\r]*$', flags: 'im', scan: comments, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '^[ \t]*\/\/[ \t]*(?:imports?|requires?|exports?|end[ \t]+(?:of[ \t]+)?(?:if|else|for|while|switch|function|loop|class|try|block|method|constructor))[ \t]*:?[ \t\r]*$', flags: 'im', scan: comments, glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
adapter: "fs:comment-ratio"
downgrade_in: {tests: advisory}
primary_over: []
sources: ['CAT §2.1 B', 'CAT Origin B', 'doc 06 §14']
---
## What
Comments that restate the next line instead of explaining why it exists: `// Set the user id`, `// Return result`, `// Imports`, `// end function`, `// loop through items`. The tells match only short line comments (a leading verb of the narrating family, an optional article, and at most two identifier-like words); a longer comment is assumed to carry reasoning and never matches. The `fs:comment-ratio` adapter adds the file-level signal: a comment-to-code line ratio above 1:3 marks a file for review even without a tell. JSDoc blocks (`/** … */`) are API documentation and are not matched.

## Triage
Delete comments that describe *what* the code does; keep the ones that record *why*: a constraint, a workaround with an issue link, an invariant, a non-obvious ordering requirement, a license or `@ts-expect-error`/`eslint-disable` reason. Keep (false positive) when:
- The comment is a marker consumed by tooling or people (`// @ts-check`, `// eslint-disable-next-line … -- reason`, `// prettier-ignore`, region folds).
- It documents a public contract in a language that has no JSDoc form (rare in TypeScript).
- In a ratio-only finding, the density comes from a license header, a long algorithm explanation, or a doc-heavy public API.
Reading rule: would a competent reader miss this sentence if it were gone? If not, remove it.

## Proposed change
Delete the narrating lines in `{{file}}` (members {{members}}); never reword them.
```diff
-  // Set the user id
   const userId = user.id;
-  // Return result
   return { userId, name };
-} // end function
+}
```
Where a comment hides a real *why* behind a narrating verb, rewrite it to state the reason in one sentence instead of deleting it. Do not touch code, and do not reflow or reformat unrelated lines; the diff must be comment-only.

## Verification
Wave R legs: typecheck, test, build. The staged diff must contain only removed or rewritten comment lines (no code token changed); `git diff -U0` lines starting with `+` must be comments. No behavior can change, but declaration emit keeps JSDoc, so confirm no `/** */` block was removed when the package ships `.d.ts` files.

## Pitfalls
- Removing a `// @ts-expect-error` or `// eslint-disable` explanation is not slop removal: those comments are matched by directive, not by this rule.
- Block comments without a leading `*` on each line may be matched line by line; read the block before deleting.
- A narrating comment over generated or vendored code is not yours to edit (generated paths are excluded).
- A license header inflates the comment ratio; the `fs:comment-ratio` adapter must skip a leading header block before counting.
