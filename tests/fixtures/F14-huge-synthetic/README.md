# F14 huge-synthetic

Generator only. Output is never committed.

    node generate.mjs <outdir> [fileCount=20000]

- `<outdir>` must not exist or must be empty.
- Writes `fileCount` `.ts` files under `packages/pkg-NNN/src/mod-NN/` (500 files per package, 20 per module),
  plus `package.json` (typescript 5.9.3 pinned), `tsconfig.json`, and `generated.json` (the actual counts).
- Mix: barrels (`index.ts`), live files importing earlier files, dead files (imported by nothing),
  one entry file per package, and unused exports. Acyclic, typechecks with `tsc --noEmit` once typescript is installed.
- Deterministic and dependency-free (Node >= 18.17). 20000 files take a few seconds.
- Guaranteed counts for the default size are in `SEEDS.json`.

Example:

    node generate.mjs ~/.cache/ts-optimize-dev/huge/F14 20000
