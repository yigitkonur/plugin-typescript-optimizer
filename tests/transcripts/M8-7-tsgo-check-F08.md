# Transcript row M8-7-tsgo-check-F08 — F08

prompt: `/ts-optimize:tsgo check`
exit: 0 · 13s

## Tool calls

- **Bash** {"command":"ts-opt fit --json","description":"Run tsgo fit analysis"}
  ← {"ok":true,"schema":"ts-optimize/envelope@1","result":{"schema":"ts-optimize/fit@1","generated":"2026-10-20T07:05:20.764Z","root":"~/.cache/ts-optimize-dev/work/F08@frtsgo1","head":"8545fd3","dirty":false,"verdict":"needs-config","packages":[{"path":".","name":"f08-ts5-legacy-config","autho…[+13146]

## Edit/Write paths (0)

## Agent dispatches (0)

## Final (turns=2 cost=$0.09227080000000001)

## tsgo fit: `needs-config`

The native compiler is 4.5× faster here. Both compilers were measured on this machine, and the 7.0.2 run used a temporary tsconfig with the removed options unset.

| | tsc 5.9.3 (authoritative) | native 7.0.2 |
|---|---|---|
| wall time | 382 ms | 85 ms (128 ms single-threaded) |

With the removed options unset, the only other native diagnostic is `src/cli.ts:1` (TS2307, `utils/format`). The project itself currently typechecks clean under tsc 5.9.3.

**Blockers**

| Rule | Where | Problem and fix |
|---|---|---|
| tc-01 | `tsconfig.json:3` | `target: es5` was removed (TS5108). Set `ES2022` for an app, or `ES2020` for a library. |
| tc-01 | `tsconfig.json:5` | `moduleResolution: node10` was removed (TS5108). Use `bundler` for a bundled app, or `nodenext` for Node. |
| tc-01/02 | `tsconfig.json:6` | `baseUrl: src` was removed (TS5102). Drop it and make `paths` values relative (`./src/*`). |
| tc-01 | `tsconfig.json:7` | `downlevelIteration` was removed (TS5102). Delete the key (auto-fix). |
| tc-02 | `src/cli.ts:1` | `utils/format` only resolved through `baseUrl`. It needs an explicit `paths` alias. |

**Tooling hits**

- **tc-04, ts-morph 28.0.0** (`package.json:17`, used in `scripts/rename.ts`): it breaks because it wraps the JS compiler API. The fix is the alias scheme.
- **tc-04, typescript-eslint 8.72.0** (`package.json:20`): it throws at startup on TS 7, and there is no JS API until 7.1. The fix is the alias scheme, or moving lint to Oxlint/Biome.
- **tc-05, ts-node 10.9.2** (`package.json:6-7`, the `dev` and `rename` scripts): it crashes on TS 7. Replace it with `tsx`, or with `node --experimental-strip-types` for erasable-syntax-only code.

**Default changes that become effective** (no error today):

- **`rootDir`:** the default changes, so set it explicitly (likely `./src`).
- **`noUncheckedSideEffectImports`:** it now defaults to true, so side-effect imports like CSS need a module shim.
- **`stableTypeOrdering`:** it only changes the order of union members in diagnostics and `.d.ts` output, so don't diff `.d.ts` files byte for byte.

**CI**

- **tc-06, `.github/workflows/ci.yml:5`** (advisory, unverified): `NODE_OPTIONS` contains `--v8-pool-size=4`, a worker flag that you should check in your CI.

**Next step:** `ts-opt scan --mode tsgo` turns this into reviewable findings. After that, `/ts-optimize:tsgo adopt` runs the migration on `chore/upgrade-typescript-go`. Nothing in the project was changed by this check.

Full report: `.ts-optimize/fit/latest/tsgo-fit.md`
