# CI, Containers, and IDE Alignment

Loaded by the `tsgo` skill when adjusting CI files, Dockerfiles, or editor settings for the native compiler (findings tc-06, tc-07).

Everything IDE-related below is advisory: re-verify against current editor documentation before changing a user's settings.

## Binary names

- `typescript@7` provides the native `tsc`. Keep scripts as `tsc --noEmit`; do not introduce `tsgo` script names.
- `tsgo` exists only in `@typescript/native-preview` (nightlies on the `next` tag); use it only when the project deliberately tracks previews.
- `--build`, `--watch`, `--project` work as in classic tsc.
- Speed: never quote vendor figures; measure with `ts-opt fit` and quote only measured numbers.

## NODE_OPTIONS sanitation (tc-06)

Reported by the source skill; verify in your CI: flags such as `--v8-pool-size` and `--max-semi-space-size` in `NODE_OPTIONS` make Node worker threads (Next.js, Vitest) abort with `ERR_WORKER_INVALID_EXEC_ARGV`.

- Search CI files (`.github/workflows/*`, `.gitlab-ci.yml`, `Dockerfile*`, wrangler build settings) for these flags.
- Keep `--max-old-space-size=<n>` for the remaining Node tools; remove the worker-incompatible flags.
- Fix proposal: `export NODE_OPTIONS="--max-old-space-size=3584"` (value from the source skill's 3.5 GB container example; size it to the runner).

## GOMAXPROCS

Go detects host CPUs. Set `GOMAXPROCS` only when a CPU quota is detected (cgroup limit lower than host cores) and set it to the quota. Otherwise leave it unset. Example: quota of 4 vCPUs gives `export GOMAXPROCS=4`.

## Parallelism flags (experimental)

`--checkers`, `--builders`, `--singleThreaded` are documented as experimental. Use `--singleThreaded` once to measure the parallel speed-up honestly; consider `--checkers`/`--builders` for monorepos only after measuring. Do not hard-wire them into CI by default.

## Stale build info

Delete stale `*.tsbuildinfo` (and the `tsBuildInfoFile` cache directory) when CI and local results disagree. Cache `tsBuildInfoFile` outputs keyed on lockfile and tsconfig, not across TS versions.

## CI shape

Keep separate steps for typecheck, lint, build (`pnpm run type-check`, `lint`, `build`) so a failing leg is attributable. For Cloudflare Workers Builds the source skill lists: `CF_SHARDS=1`, `tsc --noEmit`, Vite SPA plus Next.js Turbopack build (reported by the source skill).

## IDE (tc-07, advisory - re-verify)

- VS Code / Cursor: in `.vscode/settings.json` set `"typescript.tsdk": "node_modules/typescript/lib"` and `"typescript.enablePromptUseWorkspaceTsdk": true` to use the workspace version.
- Native preview in the editor: the documented setting is `js/ts.experimental.useTsgo` together with the native-preview extension. Treat as experimental.
- Stale editor errors while the CLI passes: run `TypeScript: Restart TS Server`, then `TypeScript: Select TypeScript Version...` and choose `Use Workspace Version`.
- Neovim/Helix/Zed: point the TypeScript language server at the workspace binary. Reported by the source skill; no settings keys are given here.
- Do not write `typescript.native.enabled` or `typescript.native.maxMemoryMB`; no source supports them. If found in a user's settings, flag them rather than copy them.
