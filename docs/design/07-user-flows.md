# 07 — User flows, start to finish

Transcripts are abbreviated; `▸` = what the agent runs, `←` = what comes back. Every flow starts from the real
primitives (slash command → skill → `ts-opt` → artifacts); nothing is conversational magic.

## Flow A — First audit of an AI-heavy TypeScript monorepo (`/ts-optimize:audit`)

```
user: /ts-optimize:audit --mode standard
```
1. **Skill loads.** The `!ts-opt detect --brief` injection has already put this in the prompt:
   ```
   typescript: yes   root: /work/shop   git: clean on main (ab12cd3)
   pm: pnpm 9.12 (packageManager)   packages: 14 (3 apps, 11 libs)   workspaces: pnpm-workspace.yaml
   compilers: tsc 5.9.3 (js) · fast: none · api: 5.9.3
   engines: knip 6.41 (project) · biome 2.1 (lint) · type-coverage 2.30 (works) · ast-grep absent · rg present
   packs: workerd (apps/edge) · frameworks: next, vitest
   gate: typecheck ✓ (14 configs) · test ✓ pnpm run test · build ✓ pnpm run build · declaration-emit: libs/*
   ```
2. The agent **announces the mode** ("Standard: waves R0, 1–5, B; deep-only rules will be listed but not scheduled") and the **coverage it will have** ("ast-grep absent ⇒ 4 structural rules run at tier-1 only").
3. ▸ `ts-opt scan --mode standard --json` ← run `2026-10-19T1432Z-a1b2` created; 41 s; `candidates.jsonl`: 1 930 candidates (reachability 1 412 · types 311 · slop 140 · structure 38 · platform 29); Knip noise gate **passed** (6 % of files reported).
4. ▸ `ts-opt triage plan --chunk-size 40` ← 49 chunks (domain × package). The agent dispatches `ts-triager` subagents **in batches of 4 in parallel** (each given one chunk path and nothing else). Each reads the code, runs the Tier-1/2 checks, and calls `ts-opt verdict add …` per candidate. Subagents return only a tally: `C07: 38 confirmed · 2 false-positive`.
5. ▸ `ts-opt verdict status` ← 1 930/1 930 judged. ▸ `ts-opt findings ingest` ← 212 finding files (4 hard · 130 warn · 78 adv); 22 candidates were dropped before triage because their fingerprints are in `suppressions.json`, and 1 340 triaged false positives are listed in `findings/index.json` under `dismissed` (17 of them became agent-made suppressions for review) — neither group gets a finding file; `SUMMARY.md` + `plan.md` written, `ts-opt validate` ✓.
6. The agent reports: verdict line, coverage table, "needs your decision: 31", the three highest-risk items, the gate estimate (the previous baseline's measured legs if one exists, otherwise "unknown until `run begin` measures it" — an audit does not run tests or builds), and the next step: **review `.ts-optimize/runs/…/plan.md`, tick boxes, then `/ts-optimize:fix`**. No source file was touched; `git status` shows only `.ts-optimize/`.

Variants: `audit --diff=origin/main` (AI-written PR review: scope = files changed vs base, domains slop/types/structure, no Knip, finishes in seconds, same artifacts); `audit --domains types` (one domain); `audit packages/api` (path scope).

## Flow B — Human review and approval

The reviewer opens `SUMMARY.md`, then `plan.md`, ticks `[x]` on the findings they accept (or tells the agent "approve all low-risk auto findings" ⇒ the agent runs `ts-opt plan check --risk low --mode auto` which edits the same checkboxes). They may edit any finding's front matter `confidence`/`fix_mode`, add a suppression (`ts-opt suppress F-0031 --reason …`), or run `ts-opt findings show F-0044`. Committing `.ts-optimize/` to a branch and opening a PR for the plan is a supported way to get team sign-off; the files are small, one per finding, with stable ids.

## Flow C — Controlled fix with a failure and a revert (`/ts-optimize:fix`)

1. **Pre-flight = `ts-opt run begin` (planned ⇒ `ready`; every exit-5 condition is explained, never worked around):** git repo ✓; clean tree ignoring `.ts-optimize/` ✓ (else: "commit or stash; findings stay on disk"); on the default branch ⇒ it creates `chore/ts-cleanup` (already on a work branch ⇒ it uses it); audit head vs current head ⇒ `ts-opt findings stale-check` (run inside `run begin`): 3 findings touch files changed since the audit ⇒ marked `stale` and removed from the plan; baseline **green** ⇒ `ts-opt baseline` runs typecheck/test/build, records fingerprints and timings (fast-check enabled: tsc 7.0.2 baseline 2.1 s). Lock acquired.
2. **Review and approval lock** (`ready` ⇒ `locked`). After the stale findings were removed, the agent shows the wave table; `ts-opt plan lock` ← 118 approved, 62 skipped, 32 not eligible (flag-only/speculative). The agent shows the wave table and asks (AskUserQuestion) only about decisions the plan cannot make: quarantine vs delete for 2 high-risk route-like files.
3. **Wave loop** (R0 → 1 → 2 → 3 → B → 4 → 5), for each wave:
   - `ts-opt run wave begin 3` tags `ts-optimize/<run>/wave-3-start`.
   - For each finding in dependency order: read the finding; edit with `Edit`; the **fast-check hook** reports `1 NEW error src/b.ts(8,1) TS2305` after the batch (the un-export broke a consumer); the agent fixes the consumer *within the same finding's `touches`* (the finding listed it as a consumer at audit time) or, if it was not listed, records it as a new candidate with `ts-opt proposal add --origin fixer --parent F-0007` and asks the user to approve it with `ts-opt plan amend` (a finding's `touches` is never widened silently); `ts-opt check` ← 0 new errors; `ts-opt commit F-0007` ← commit `ab12cd3` with trailers; a raw `git commit` attempt would have been denied by `commit-guard` with the pointer to `ts-opt commit`.
   - End of wave: `ts-opt gate --wave 3` runs typecheck → declaration-emit → test → build with `CI=1`. ← **build failed**. The agent does not touch config. `ts-opt bisect --wave 3` ← culprit `F-0011` (un-exported symbol read by a generated bundler glob). `ts-opt revert F-0011` ← reverted; finding becomes `reverted` with the build output tail attached; gate re-run ← green.
   - `ts-opt rescan --wave 3` ← 2 cascade candidates (`origin: cascade:F-0008`): newly dead files. The agent asks once: "approve both cascade deletions (low risk)?"; the user says yes; `ts-opt plan amend --cascade` approves them. Their wave (1) has already run, so they are queued for a **repeat pass** that runs after wave 5 and before post-flight (`pass: 2`; at most a third pass; anything left is reported as residual).
4. **Post-flight (`P`).** Knip zero in scope (or the remaining items listed), declaration-emit ✓, coverage ≥ baseline (same metric id), diff accounting (`git diff --stat <base>...HEAD`: one commit per finding — or per opted-in batch, per `R0` rule, or the single `B` bridge commit — and no untraced commits). `ts-opt run finish` writes `apply/ledger.md` and the "Outcome" section of `SUMMARY.md`; offers `ts-opt baseline --save` to raise floors. Final message: counts, ledger link, the reverted finding and why, residual `deferred`/`flag-only` items, and the PR-ready branch name.

## Flow D — tsgo: fit probe, then adoption (`/ts-optimize:tsgo`)

1. `/ts-optimize:tsgo` (no args = `check`). The `!` injection shows `compilers: tsc 5.9.3 (js) · fast: none`. The agent explains the three modes (doc 05 §8.1) and that no repo change happens during `check`.
2. No native compiler is available. The agent asks (AskUserQuestion): "Install the isolated toolbox (typescript 7 + Knip 6 + type-coverage + ast-grep) into `~/.claude/plugins/data/…`? It never touches your `package.json`." Yes ⇒ `ts-opt toolbox install --yes` (≈ 40 s, `--ignore-scripts`, lockfile-pinned, consent recorded in `consent.json`).
3. ▸ `ts-opt fit` ← per package: authority 38.4 s · native 3.9 s (`--singleThreaded` 14.7 s; 4 checkers) · diagnostics equal ✓ for 13 packages; `apps/legacy`: 6 only-native errors (`TS5107 baseUrl` removed option, 2× `TS2307` from lost `baseUrl` resolution, 3× `TS2688 types`); ecosystem: `eslint-config-next` + `typescript-eslint` need the JS API; `ts-node` in 2 scripts; CI sets `NODE_OPTIONS=--v8-pool-size=…`. **Verdict: `needs-config` then `ready-with-bridge`.** Report: `tsgo-fit.md`.
4. Accelerator mode is available immediately with no repo changes ("I will use the native compiler for `ts-opt check` while the project's tsc stays the gate"). Adoption is a separate decision: "Adopt TS 7 on branch `chore/upgrade-typescript-go`? Findings tc-01 (3), tc-02 (1), tc-03 (1), tc-04 (alias scheme), tc-05 (2), tc-06 (1)". User: yes ⇒ same machinery as Flow B/C with waves T1–T4 and the six-tier gate; the alias scheme is applied in T2 so `eslint` keeps working on TS 6 while `tsc` becomes native; the finding for `eslint-config-next` records the 7.1 caveat.
5. Outcome: `typecheck` 38 s → 4 s, six tiers green, `SUMMARY.md` states what remains on TS 6 (lint, `next build` type-check) and when to re-evaluate (typescript-eslint 7.1 support).

## Flow E — Resume after compaction or a new session

`SessionStart(compact|resume)` injects the one-line pointer (doc 03 H1). The agent reads `run.json` (`ts-opt run status --json`), sees `wave 3 · F-0014 in progress · 2 uncommitted files`, runs `ts-opt check` to see whether those edits are sound, and continues. If the `fix` skill text was dropped by compaction, the pointer tells it to re-invoke `/ts-optimize:fix`, which resumes rather than restarts (`fix` begins with `run status`).

## Flow F — Reviewing AI-written code in a PR (diff-scoped)

`/ts-optimize:audit --diff=origin/main` → scope = changed TS files; rules: slop, type-01/02/04/11, struct-03/04/07 (duplicates checked against the whole repo's declarations), plat-01/02 (workers); engines: tier-1 + ast-grep if present; no dead-code pass (a diff cannot prove death). Output is the usual run directory; `SUMMARY.md` top section is "Findings introduced by this diff". Fixes are optional and use the same `fix` flow.

## Flow G — A repo with no TypeScript (a Python service with a Go sidecar)

`/ts-optimize:audit` → `typescript: none` ⇒ "No TypeScript found under /work/api; nothing to do." exit 3; no files created. Hooks never speak; `ts-opt` is inert on PATH; skill descriptions are the only residual cost.

## Flow H — Polyglot repo (Python backend + `web/` TypeScript)

`detect` finds one TS package (`web/`, npm). Root is the git root; `.ts-optimize/` lives there; scope defaults to `web/`; gate commands run with `cwd: web/`; Python files are never read. `git status` cleanliness is judged repo-wide (a dirty Python file blocks `fix`, with that reason).

## Flow I — Degraded: no tests, no Knip

`doctor` (or the injection) says: `test: none ✗ · knip: absent (toolbox not installed)`. `audit` runs, labels reachability `unavailable (Knip absent; allow the toolbox to enable)`, still produces types/slop/platform/structure(cycles via built-in graph) findings. `plan.md` states: "No test leg: only waves B and 4 are schedulable (zero-runtime type edits)". The user can accept this, or add a `test` script and re-run `ts-opt baseline`.
