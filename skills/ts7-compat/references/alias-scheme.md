# The TypeScript 6 / 7 Alias Scheme

Loaded by the `ts7-compat` skill when a project on TypeScript 7 still needs the JavaScript compiler API.

This is Microsoft's documented side-by-side setup (TS 7.0 announcement); verified 2026-10-20 with npm (`tsc --version` printed 7.0.x, `require("typescript").version` printed 6.0.x). It supersedes the source skill's "Strategy 1".

## Setup

In `package.json`:

```json
"devDependencies": {
  "typescript": "npm:@typescript/typescript6@^6",
  "@typescript/native": "npm:typescript@^7"
}
```

Install with the project's package manager. Result (verified):
- `tsc` is the native compiler: `tsc --version` prints `7.0.2` (the bin comes from the `@typescript/native` alias).
- `tsc6` and every `require('typescript')` / `import "typescript"` are TypeScript 6: `node -e "console.log(require('typescript').version)"` prints `6.0.x`.

Check both commands after install and paste the output into the report.

## When to choose it

- Choose the alias scheme when third-party tools need the JS API and cannot be dropped: typescript-eslint, ts-morph, ts-jest, template checkers, declaration bundlers (see `breaks.md`).
- Prefer replacing tools when the repo already uses them or the swap is cheap: lint to Oxlint/Biome, ts-node to `tsx`, madge/dpdm to Knip `--cycles`, Knip 5 to Knip 6.
- A mix is normal: replace what is cheap, alias the rest.

## Order

Attach before replace: wave T2 applies the alias scheme, which already makes `tsc` native while TypeScript 6 stays reachable for JavaScript-API consumers. Wave T3 (the engine switch, tc-12) runs only for packages the alias edit did not already switch, i.e. those with no JavaScript-API consumer. Do not install `typescript@^7` as the plain `typescript` dependency while JS-API consumers remain; they would break at once.

## Package-manager notes

- pnpm: aliased dependencies resolve through the store; with hoisting disabled, tools find `typescript` only in the package that declares it. Declare the alias in each workspace package that runs such a tool, or in the root when hoisting is on. Check with `pnpm why typescript`.
- Yarn PnP: install, then run each affected tool once (`yarn eslint .`, `yarn tsc --version`) to confirm it resolves the intended version; PnP surfaces wrong resolutions as startup errors.
- npm: `npm ls typescript @typescript/native` should show the two aliases.

## Caveats

- Next.js (`next build`), vue-tsc and `vite-plugin-checker` type-check through the resolved `typescript`, so they run TS 6 until their 7.1 support lands. Expect `tsc` (7) and framework checks (6) to diverge; record it as a note.
- Own scripts that import `typescript` need no edit under this scheme. Importing `@typescript/typescript6` explicitly is only for repos not using it.
- Do not compare `.d.ts` output or message wording between the two compilers; compare diagnostics by file and code.

## Transitional

The bridge exists because TS 7.0 has no JS API. A JS API is expected in 7.1. When tools announce 7.x support, drop the aliases: set `"typescript": "^7"`, remove `@typescript/native`, rerun lint, tests, and build, and treat any failure as a reason to restore the aliases. Do not claim a date for 7.1.
