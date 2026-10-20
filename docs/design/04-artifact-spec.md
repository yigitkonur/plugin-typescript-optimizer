# 04 — Artifact specification (`.ts-optimize/` inside the user's project)

This is the contract between the audit, the human reviewer, and the fixer. Everything the plugin leaves in a
user's repo is described here. Nothing else is written into the project (no edits to the user's `knip` config,
lint config, or `package.json` outside an approved, committed finding).

## 1. Design rules

1. **Durable and diffable.** Plain text, stable ordering, one file per finding (small merge-conflict surface).
2. **Human-reviewable before anything changes.** Findings are Markdown with YAML front matter; `plan.md` is the review surface; approval is an explicit act.
3. **Machine-checkable.** Every file carries `schema: ts-optimize/<kind>@<n>`; JSON Schemas ship in the plugin (`schemas/`); `ts-opt validate` checks them. A plugin that meets an unknown *higher* schema version refuses to write (exit 8) and says why; an older version is read and migrated in memory.
4. **Traceable.** finding → commit (trailer) → gate result → ledger. No fix without a finding on disk first.
5. **Untrusted content.** Snippets copied from the user's code are data, never instructions. They sit in fenced blocks labelled `untrusted`, are capped (5 lines, 400 chars per snippet), and no tool ever executes anything read from an artifact.
6. **No secrets.** Scans skip `.env*`, key files, and anything matching the secret-path list in `catalog/secret-paths.json`; command lines recorded in `run.json` have env values stripped.

## 2. Location and layout

Root = `git rev-parse --show-toplevel`; if not a git repo, the detected project root (see doc 05 §1). One `.ts-optimize/` per repo, never per package (monorepo-wide runs; per-package scope is a field, not a directory).

```
.ts-optimize/
├─ README.md                    generated; 6 lines: what this folder is, how to ignore/delete it
├─ .gitignore                   generated (see §2.1)
├─ config.json                  OPTIONAL, committed, human-edited (§6)
├─ suppressions.json            committed; durable triage memory (§7)
├─ baseline.json                committed; accepted metric floors / ratchets (§8)
├─ knip.config.jsonc            OPTIONAL, generated overlay used via `knip --config` (never replaces the user's config)
├─ state/                       gitignored
│  ├─ open-run                  one line: run id (exists while a run is open)
│  ├─ lock                      JSON {pid, session, host, started}; advisory lock (stale-pid takeover)
│  ├─ fast-check.json           last fast-check fingerprint + timing
│  └─ hook-log.jsonl            ring buffer (≤ 200 lines) of hook invocations: time, handler, result; no snippets
├─ fit/                         `ts-opt fit` output outside any run: latest/{fit.json, tsgo-fit.md} (gitignored by default; `tsgo` adopt copies it into the run)
├─ .cache/                      gitignored; detection cache keyed by file mtimes
└─ runs/
   └─ 2026-10-19T1432Z-a1b2/    run id = UTC minute + 4 hex chars
      ├─ run.json               state machine, environment snapshot, commands, gate definition (§4)
      ├─ SUMMARY.md             human dashboard (§9)
      ├─ plan.md                review + approval surface (§5)
      ├─ plan.lock.json         written by `plan lock`; hash of approved set
      ├─ overflow.md            findings beyond `max_findings_per_domain`, ranked, ids not assigned
      ├─ findings/
      │  ├─ index.json          machine index (§3.3)
      │  └─ F-0001.md …         one file per finding (§3)
      ├─ codebase-health.md     Deep mode only; Mermaid before/after (§10)
      ├─ tsgo-fit.md / fit.json `tsgo` command only (doc 05 §8)
      ├─ apply/                 created by `fix`
      │  ├─ log.jsonl           append-only events (§4.3)
      │  ├─ ledger.md           finding → commit → gate table, written by `run finish`
      │  └─ gate/               gitignored; tail of each gate leg output
      └─ raw/                   gitignored; engine outputs, candidates, verdicts
         ├─ candidates.jsonl
         ├─ chunks/C01.json …
         ├─ verdicts/C01.jsonl …
         ├─ baseline-diagnostics.json   full diagnostic-fingerprint multiset (the committed baseline keeps only hashes)
         ├─ .done/<engine>              completion markers so `scan --resume` skips finished engines
         └─ knip.json, tsc.txt, rg.jsonl, …
```

### 2.1 Generated `.ts-optimize/.gitignore`

```
state/
.cache/
runs/*/raw/
runs/*/apply/gate/
```
Everything else is meant to be committable so reviewers can read it in a PR. Tree-cleanliness checks (`run begin`, `commit`) ignore `.ts-optimize/` entirely; `run finish` commits the run's artifacts (plan, findings, ledger, SUMMARY) as one `chore(ts-optimize): record run <id>` commit with a `Run:` trailer unless `config.commit.artifacts` is `false`. Quarantined files (reach-01 default for route-like paths) are moved with `git mv` to `.quarantine/<original path>` at the repo root, which is outside every `include`/`project` glob; `run finish` writes `.quarantine/README.md` listing each item with its finding id, date and the recommended deletion step ("verify in a preview deployment, then `git rm -r .quarantine/<item>`"). `ts-opt run prune --keep 5` deletes older run directories (never `suppressions.json`, `baseline.json`, `config.json`).

## 3. Finding file

### 3.1 Front matter (YAML subset: scalars, lists, maps; strings with `:`/`#` double-quoted; regex always single-quoted)

```yaml
---
schema: ts-optimize/finding@1
id: F-0007
fingerprint: sha1:9c1e5b0a4f…           # stable across runs; see §3.4
run: 2026-10-19T1432Z-a1b2
rule: reach-04                          # catalog id; rule_version recorded below
rule_version: 1
domain: reachability                    # platform|reachability|types|structure|slop|toolchain
batch: 5                                # 1–9 for dead-code/type batches (doc 06 §3), else null
wave: "3"                               # "R0"|"R"|"1"|"2"|"3"|"B"|"4"|"5"|"P"|"T1".."T4"|null  (always a string)
severity: warn                          # hard | warn | advisory   (impact if left alone)
fix_risk: low                           # low | medium | high      (blast radius of applying the fix)
confidence: certain                     # certain | likely | speculative
recommendation: null                    # structure domain only: STRONG | WORTH_EXPLORING | SPECULATIVE
verdict: confirmed                      # candidate | confirmed | false-positive | deferred   (set by triage)
state: approved                         # open | approved | rejected | applied | reverted | skipped | stale | suppressed | superseded
fix_mode: auto                          # auto | assisted | flag-only
engines: ["knip@6.41.0:exports"]
package: apps/web                       # workspace package (relative path) or "."
location: {file: src/a.ts, line: 12, symbol: formatTimestamp}
members: []                             # bulk findings: [{line: 12, symbol: a}, …] (≤ 50)
touches: ["src/a.ts"]                   # files the fix may modify or delete; the commit scope
depends_on: []                          # finding ids that must be applied first
origin: scan                            # scan | cascade:F-0003 | architect | fixer:F-0003
triage:
  framework_lifecycle: "no"             # "yes" | "no" | "unknown"  (quoted: YAML booleans are not used)
  dynamic_invocation: "no"
  public_contract: "no"
  evidence:                             # exact commands run and what they returned
    - "rg -w formatTimestamp --glob '!src/a.ts' → 0 hits"
    - "rg \"\\['formatTimestamp'\\]\" → 0 hits"
suppressed_by: null                     # suppression entry id, when state == suppressed
applied: null                           # {commit: "ab12cd3", gate: "wave-3", at: "2026-10-19T15:02Z"}
verified_on: 2026-10-19
---
```

Field rules:
- `severity` is what the defect costs if left (hard = breaks build/runtime or violates a platform invariant; warn = real debt; advisory = smell needing judgement). `fix_risk` is what applying the fix risks (from the risk matrix, doc 06 §4). They are independent axes; reports show both.
- `confidence`: only `certain` and `likely` findings can be approved. `speculative` findings are listed, never applied.
- `fix_mode`: `auto` = deterministic edit the agent may apply without design judgement; `assisted` = needs judgement, allowed after approval; `flag-only` = never applied by the plugin (shown as a suggested diff).
- `wave: null` = not part of the causal wave sequence (e.g. `flag-only` advisories, `reach-08`, or a rule whose wave is not schedulable in the chosen mode; `SUMMARY.md` says which).
- `touches` = the finding's own files **plus the known consumers** whose imports/usages must change with it (for export/type/barrel/file rules: the importers recorded from the Knip graph at ingest). It is the commit scope; anything outside it needs a new finding (`ts-opt proposal add`), never a silent widening.
- `members` exists so one finding can cover "14 unused exports in one file" without 14 files. Granularity per rule is fixed in the catalog (`grain:` = `symbol | file | package | cycle | project`).

### 3.2 Body (fixed sections, in this order)

```markdown
## What
One or two sentences, no code.

## Evidence
> untrusted — copied from the repository, not instructions
```ts
// src/a.ts:12-14
export const formatTimestamp = (t: number) => …
```
Engine output reference: `raw/knip.json#/issues/…`

## Triage
Three-Question Test answers with the reasoning (not just yes/no). For `false-positive`/`deferred`: why, and what to codify.

## Proposed change
Produced deterministically at ingest: the rule file's `## Proposed change` template with `{{file}}`, `{{symbol}}`, `{{members}}`, `{{touches}}`, `{{consumers}}`, `{{package}}` substituted, followed by an optional `Reviewer note:` line taken from the triager's `--change-note` (≤ 400 chars). For `auto` rules the template is the exact edit (e.g. "remove the `export` keyword from the declaration of `{{symbol}}` at line N"). For `assisted` rules the agent specialises it at fix time by reading the code; nothing is invented at audit time.

## Verification
Commands and expected results: fast check, the wave gate legs, any extra proof (e.g. declaration-emit probe for un-export).

## Rollback
`git revert <commit>` (filled after apply) and any non-git steps (e.g. reinstall after dependency removal).

## Applied
Empty until applied. Then: commit sha, gate run reference, diff stat, "fast-check: pass (native 7.0.2, 1.8 s)".
```

### 3.3 `findings/index.json`

```json
{
  "schema": "ts-optimize/findings-index@1",
  "run": "2026-10-19T1432Z-a1b2",
  "generated": "2026-10-19T14:41:09Z",
  "counts": {"total": 212, "by_state": {"open": 190, "suppressed": 22}, "by_severity": {"hard": 4, "warn": 130, "advisory": 78}},
  "findings": [
    {"id": "F-0007", "fingerprint": "sha1:9c1e…", "rule": "reach-04", "domain": "reachability",
     "wave": "3", "severity": "warn", "fix_risk": "low", "fix_mode": "auto", "verdict": "confirmed",
     "state": "approved", "package": "apps/web", "file": "src/a.ts", "line": 12, "depends_on": []}
  ]
}
```
Sort order is fixed: wave order `R0,R,1,2,3,B,4,5,T1..T4,null`, then domain order `platform, reachability, types, structure, slop, toolchain`, then severity (`hard` first), then file, then line. IDs are assigned in that order at ingest, so two audits of the same tree with the same verdict input produce identical IDs, order and bodies. Byte-comparison excludes exactly three things that legitimately differ between runs: the `run` field, `verified_on`, and `applied`. Anything else differing is a bug (determinism is an acceptance criterion).

### 3.4 Fingerprint

`sha1( rule + "\0" + package + "\0" + file(normalised, forward slashes) + "\0" + symbol + "\0" + anchor )` where `anchor` is the whitespace-collapsed first 200 characters of the offending snippet for rules without a stable symbol, else empty. Line numbers are deliberately excluded. Fingerprints key suppressions, re-audit status carry-over, and cascade detection.

### 3.5 State machine

```
verdict:  candidate ──triage──▶ confirmed | false-positive | deferred
state:    open ──plan lock (checked)──▶ approved ──commit──▶ applied
                │                          │
                │                          └─gate culprit / user──▶ reverted
                ├─unchecked at lock──▶ skipped
                ├─user rejects──▶ rejected
                ├─HEAD moved & touched file changed since audit──▶ stale
                ├─matches suppression──▶ suppressed
                └─replaced by a broader finding──▶ superseded
```
Only `confirmed` + `open|approved` + `confidence ≠ speculative` + `fix_mode ≠ flag-only` findings are eligible for the lock. A `reverted` finding keeps its commit sha and the failing gate output reference, and is re-offered as `deferred` in the next run with the failure as evidence.

### 3.6 What `findings ingest` does with each verdict

| Verdict / situation | Result on disk |
|---|---|
| `confirmed` | finding file `F-nnnn.md` (`verdict: confirmed`, `state: open`); a plan line if eligible |
| `deferred` | finding file with `verdict: deferred`, `fix_mode` forced to `flag-only`; listed under "needs your decision" |
| `false-positive` | **no finding file**; an entry in `findings/index.json` under `dismissed[]` (rule, location, reason, `codify`). If the verdict is `certain` and carries a `codify` target (or an engine-behaviour reason), ingest also appends a suppression entry (§7) with `by: ts-triager`, `confirmed_by_user: false`, `expires` = ingest date + 90 days, and lists it in `SUMMARY.md` and `plan.md` under "Agent-made suppressions — delete a line to re-triage" |
| fingerprint already in `suppressions.json` (unexpired) | filtered by `scan` **before** chunking (no triage cost); index entry only, `state: suppressed`, no file |
| lost a seam (doc 06 §10) | finding file `state: superseded`, `superseded_by` set |
| over `max_findings_per_domain` | `overflow.md` line, no id |

So in doc 07 Flow A: 1 930 candidates → 212 finding files; 22 suppressed and the dismissed false positives appear in `index.json` only.

## 4. `run.json`

### 4.1 Shape

```json
{
  "schema": "ts-optimize/run@1",
  "id": "2026-10-19T1432Z-a1b2",
  "plugin_version": "0.1.0",
  "state": "planned",
  "mode": "standard",
  "created": "2026-10-19T14:32:11Z",
  "repo": {"root": "/abs/path", "git": true, "head": "ab12…", "branch": "main", "dirty": false, "default_branch": "main"},
  "env": {
    "node": "22.11.0", "os": "darwin-arm64",
    "pm": {"name": "pnpm", "version": "9.12.0", "source": "packageManager"},
    "packages": [{"path": ".", "name": "root"}, {"path": "apps/web", "name": "web"}],
    "compilers": {
      "authoritative": {"bin": "node_modules/.bin/tsc", "version": "5.9.3", "kind": "js"},
      "fast": {"bin": "node_modules/.bin/tsgo", "version": "7.0.0-dev.20260930", "kind": "native-preview"},
      "api_provider": {"version": "5.9.3"}
    },
    "engines": {
      "knip": {"version": "6.41.0", "source": "project", "works": true},
      "type-coverage": {"version": "2.30.1", "source": "toolbox", "works": true},
      "ast-grep": {"version": null, "source": null, "works": false, "reason": "not installed"},
      "lint": {"engine": "biome", "version": "2.1.0"}
    },
    "packs": ["workerd"],
    "frameworks": ["next", "vitest"]
  },
  "scope": {"workspaces": ["apps/web"], "include": [], "exclude": ["**/generated/**"], "diff_base": null},
  "domains": {"run": ["platform", "reachability", "types", "slop", "structure"],
              "degraded": [{"domain": "reachability", "part": "cycles", "reason": "madge unusable under TS 7; using knip --cycles"}],
              "skipped": [{"domain": "toolchain", "reason": "not requested"}]},
  "gate": {
    "legs": [
      {"id": "typecheck", "cmd": ["node_modules/.bin/tsc", "--noEmit", "--pretty", "false", "-p", "tsconfig.json"], "cwd": ".", "timeout_s": 600, "variant": "noemit"},
      {"id": "test", "cmd": ["pnpm", "run", "test"], "cwd": ".", "timeout_s": 1800, "ci_env": {"CI": "1"}},
      {"id": "build", "cmd": ["pnpm", "run", "build"], "cwd": ".", "timeout_s": 1800}
    ],
    "unavailable": [{"id": "declaration-emit", "reason": "no declaration/composite/types signal"}],
    "baseline_status": "green",
    "red_baseline": null,
    "accepted_risk": null
  },
  "fast_check": {"enabled": true, "engine": "tsgo", "baseline_ms": 2100, "disabled_reason": null, "divergences": 0},
  "waves": [{"id": "1", "findings": 12, "status": "pending", "tag": null, "gate": null}],
  "approvals": null,
  "applying": null,
  "timings_s": {"scan": 41.2, "triage": 188.0},
  "commands": [{"at": "2026-10-19T14:32:20Z", "cmd": "…", "exit": 0}]
}
```

### 4.2 Run state machine

```
scanning ─▶ triaging ─▶ planned ──run begin──▶ ready ──plan lock──▶ locked ──run wave begin──▶ applying ──gate P──▶ verifying ──run finish──▶ done
   │            │          │                     │                    │                        │                       │
   └────────────┴──────────┴────────────────abort / expire───────────┴────────────────────────┴───────────────────────┴──▶ aborted
```
- `scan` creates the run (`scanning`); each engine writes `raw/.done/<engine>` when finished. A run left in `scanning|triaging` by a crash is resumed with `scan --resume <id>` (skips finished engines) and `verdict status` (lists unjudged candidates). `ingest` moves it to `planned`.
- `scan` while another run is open (`planned|ready|locked|applying|verifying`) is refused (exit 5) unless `--abandon-open`, which marks the old run `aborted: superseded`.
- `run begin` = pre-flight (git repo, clean tree ignoring `.ts-optimize/`, work branch created if on the default branch, `findings stale-check`, full baseline gate, lock) ⇒ `ready`. `plan lock` requires `ready` ⇒ `locked`. The first `run wave begin` ⇒ `applying`. Starting the post-flight gate (`gate --wave P`) ⇒ `verifying`. `run finish` requires a green `P` gate ⇒ `done`.
- `state/open-run` exists while the state is `planned | ready | locked | applying | verifying` (a `planned` run older than 14 days is closed as `aborted: expired`).
- Hooks: `SessionStart` reports any open run; `commit-guard` denies raw `git commit` in `ready|locked|applying|verifying` (the only commit paths are `ts-opt commit`, allowed in `applying`, and the artifacts commit made by `run finish`); `fast-check` acts only in `applying`.

`run.json` fields filled during the run: `approvals` = `{"locked_at": …, "approved": [ids], "skipped": [ids], "amendments": [{"at": …, "ids": […], "by": "user-confirmed"}]}` (mirrors `plan.lock.json`); `applying` = `{"wave": "3", "pass": 1, "finding": "F-0014", "branch": "chore/ts-cleanup", "base": "ab12cd3"}`; `waves[].status` ∈ `pending | running | gated | reverted-partial | skipped`.

`gate.red_baseline` / `accepted_risk`: set only by `run begin --allow-red-baseline <legs>`: `{"legs": ["typecheck"], "diag_hash": "sha1:…"}` and `{"by": "user", "at": "…", "statement": "…"}` (doc 05 §9). A missing test suite is **not** something risk acceptance can unlock: without a `test` leg only waves `B` and `4` are schedulable (doc 05 §9, per the source's rule).

### 4.3 `apply/log.jsonl` (append-only; one JSON object per line)

```jsonl
{"t":"2026-10-19T15:01:02Z","ev":"wave-begin","wave":"3","tag":"ts-optimize/2026-10-19T1432Z-a1b2/wave-3-start"}
{"t":"…","ev":"finding-begin","id":"F-0007"}
{"t":"…","ev":"check","id":"F-0007","result":"pass","engine":"native-preview 7.0.0-dev","ms":1840,"new_errors":0}
{"t":"…","ev":"commit","id":"F-0007","sha":"ab12cd3","files":["src/a.ts"],"fingerprint":"wt:5f3…"}
{"t":"…","ev":"gate","wave":"3","legs":{"typecheck":"pass","test":"pass","build":"pass","declaration-emit":"pass"},"ms":412000}
{"t":"…","ev":"revert","id":"F-0011","reason":"wave gate: build failed after F-0011 (bisect)","sha":"de45f67"}
```
Complete event set (each line has `t`, `ev`; payload keys as shown): `run-begin` (branch, base, baseline summary) · `wave-begin` / `wave-end` (`wave`, `pass`, `tag`) · `finding-begin` · `check` (`id`, `result`, `engine`, `ms`, `new_errors`) · `commit` (`ids[]`, `sha`, `files[]`, `fingerprint`) · `gate` (`wave`, `legs{}`, `ms`, `flaky[]`) · `bisect` (`wave`, `culprit`) · `revert` (`ids[]`, `reason`, `sha`) · `divergence` (`fast`, `auth`) · `rescan` (`wave`, `new_cascades[]`, `stale[]`) · `amend` (`ids[]`, `by`) · `protected-override` (`rule`, `why`) · `abort` (`reason`) · `finish` (`ledger`, `outcome{}`).

## 5. `plan.md` — the review surface

Generated at ingest, hand-editable by the reviewer. Front matter + one section per wave. **Checkboxes are the approval UI.**

```markdown
---
schema: ts-optimize/plan@1
run: 2026-10-19T1432Z-a1b2
mode: standard
base_branch: main
work_branch: chore/ts-cleanup
gate_estimate_min: 14
---
# Fix plan — standard mode

Legend: `[x]` approve · `[ ]` skip. `risk` is fix risk. `flag-only` items have no checkbox.
Gate: typecheck → test (pnpm run test) → build (pnpm run build); declaration-emit not applicable.

## Wave 1 — unreferenced files (gate ≈ 14 min)
- [ ] F-0001 reach-01 `src/legacy/OldModal.tsx` — delete (risk **high**: route-like path; quarantine suggested)
- [x] F-0002 reach-01 `src/old/helpers.test.ts` — delete (risk low)

## Wave 3 — encapsulation
- [x] F-0007 reach-04 `src/a.ts` — internalize 3 exports (risk low, auto)

## Not part of any wave
- F-0031 reach-10 `FLAGS.ENABLE_EXPERIMENTAL_DISCOUNT_ENGINE_V2` — zombie feature (flag-only: verify against the flag dashboard)
```

`ts-opt plan lock`: parses `- [x] F-… ` lines, verifies each is eligible (§3.5), writes `state: approved` into those finding files and `skipped` for unchecked eligible ones, writes `plan.lock.json` `{"schema": "ts-optimize/plan-lock@1", "run", "approved": ["F-0002","F-0007"], "plan_sha256": "…", "locked_at": "…", "amendments": []}`, and moves the run from `ready` to `locked`. After locking, edits to `plan.md` are ignored and `ts-opt plan status` reports drift. **Later approvals** (findings added mid-run by `proposal add --origin fixer`, or cascade findings created by `rescan`) go only through `ts-opt plan amend F-… [F-…]` or `plan amend --cascade` (all pending cascade findings of the run), which append an `amendments[]` entry `{"at", "ids", "by": "user-confirmed"}` and recompute the hash; the `fix` skill must have the user's explicit yes in chat before calling it. Chat approval (the `fix` skill offers "approve all low-risk auto findings") is implemented by the same command editing the checkboxes, so there is one source of truth.

## 6. `config.json` (optional, committed)

```json
{
  "schema": "ts-optimize/config@1",
  "scope": {"include": ["packages/*/src/**"], "exclude": ["**/generated/**", "vendor/**"]},
  "protected": ["src/public-api.ts", "src/**/*.d.ts"],
  "gate": {
    "typecheck": "auto",
    "test": "pnpm run test:unit",
    "build": "auto",
    "timeout_s": {"typecheck": 600, "test": 1800, "build": 1800},
    "scope": "full"
  },
  "thresholds": {"cyclomatic": 10, "cognitive": 15, "function_loc": 60, "nesting": 3, "params": 4, "max_findings_per_domain": 400},
  "commit": {"granularity": "finding", "batch_max": 25, "no_verify": false, "branch_prefix": "chore/ts-cleanup", "artifacts": true},
  "hooks": {"enabled": true, "fast_check": true},
  "network": {"npx": "ask", "toolbox": "ask"},
  "keep_runs": 5
}
```
Unknown keys are ignored with a `doctor` warning. **`commit.granularity`**: `"finding"` (default; one commit per finding) or `"batched"` (opt-in: findings of the same low-risk rule within a wave share a commit, ≤ `batch_max`; required for Knip scoped bulk fixes). Two cases are always bulk by nature regardless of the setting: wave `R0` (one lint-autofix commit per rule) and wave `B` (one bridge commit). A multi-finding commit is reverted as a unit: all its members become `reverted` and are re-offered as individual `deferred` findings. **`gate.typecheck`**: `"auto"` or an array of tsconfig paths per package (`["tsconfig.app.json"]`). `gate.test: "auto"` means detect; any string is run verbatim as the leg. `network` values: `ask | allow | never`; a `never` here overrides the user's machine-level consent. `gate.scope: "affected"` (monorepos) delegates to `turbo run … --filter=...[<base>]` / `nx affected` / `pnpm --filter "...[<base>]"` when the tool is detected; default `full`.

## 7. `suppressions.json` (committed) — durable triage memory

```json
{
  "schema": "ts-optimize/suppressions@1",
  "entries": [
    {"id": "S-001", "fingerprint": "sha1:77aa…", "rule": "reach-01", "file": "worker-configuration.d.ts",
     "reason": "ambient declarations generated by `wrangler types`; no imports/exports by design",
     "evidence": ["tsconfig.json#compilerOptions.types includes it"], "by": "ts-triager", "confirmed_by_user": true,
     "date": "2026-10-19", "expires": null, "codified_in": "knip.jsonc#ignore"}
  ]
}
```
- A matching fingerprint produces a finding with `state: suppressed` (kept in the index for audit trail, excluded from `SUMMARY.md` totals except a "suppressed" count).
- `expires` forces re-triage after the date. `codified_in` records where the false positive was encoded as engine configuration (preferred over a suppression: *suppress in config, never in a broad ignore*).
- Entries created by `findings ingest` from agent verdicts (§3.6) carry `confirmed_by_user: false` and `expires` = creation + 90 days; they are shown for review in every `SUMMARY.md`/`plan.md` until the user edits or deletes them (deleting a line means "re-triage this next audit"). A user-made entry (`ts-opt suppress`) has `confirmed_by_user: true` and no default expiry.

## 8. `baseline.json` (committed) — ratchet floors

```json
{
  "schema": "ts-optimize/baseline@1",
  "captured": "2026-10-19T14:50:00Z", "head": "ab12…",
  "roots": {
    ".": {
      "typecheck": {"engine": "tsc@5.9.3", "errors": 0, "diag_hash": "sha1:…", "ms": 21300},
      "declaration_emit": {"status": "pass"},
      "type_soundness": {"metric": "type-coverage@2.30.1", "value": 95.45, "detail_hash": "sha1:…"},
      "escape_hatch": {"metric": "escape-hatch@1", "as_any": 41, "as_unknown_as": 9, "colon_any": 63, "ts_ignore": 5, "ts_expect_error": 12, "non_null_chain": 7},
      "cycles": {"engine": "knip@6.41.0", "count": 4, "ids": ["sha1:…"]},
      "knip": {"files": 31, "exports": 212, "types": 40, "dependencies": 6}
    }
  },
  "tests": {"cmd": "pnpm run test", "exit": 0, "collected": 1240, "ms": 301000},
  "build": {"cmd": "pnpm run build", "exit": 0, "ms": 188000}
}
```
The full diagnostic-fingerprint multiset needed for "new errors vs baseline" is stored in `runs/<id>/raw/baseline-diagnostics.json` (gitignored); this committed file keeps only its hash and counts, so a run resumed on another machine re-captures it at `run begin`. Fingerprint definitions are in doc 05 §9.1.

A ratchet only compares like with like: a `type_soundness` value produced by `type-coverage` is never compared with one produced by the `escape-hatch@1` proxy; if the engine changes, the baseline is re-captured and the change is recorded in `SUMMARY.md`. Raising a floor is an explicit `ts-opt baseline --save` after a green post-flight; it never lowers silently.

## 9. `SUMMARY.md` layout (generated; sole author is `ts-opt findings ingest` / `run finish`)

1. Header: run id, mode, repo head, branch, dirty flag, plugin version, duration.
2. **Verdict line**: `READY FOR REVIEW` / `BLOCKED: <reason>` and, when applicable, `tsgo readiness: <verdict>`. The gate-time estimate is the previous baseline's measured legs if one exists, otherwise `unknown until run begin measures it` (an audit does not run tests or builds).
3. Coverage table: each domain `audited | degraded (why) | not applicable (why) | skipped`, so "audited and clean" is never confused with "not looked at".
4. Rollups: by severity, by domain, by wave (with gate estimate), by fix mode.
5. "Needs your decision": every `fix_risk: high`, every `flag-only`, every `deferred`.
6. Top 10 by `score = severity_weight × confidence_weight ÷ risk_weight` (severity: hard 100 / warn 10 / advisory 1; confidence: certain 1.0 / likely 0.6; risk: low 1 / medium 2 / high 4), ties by file path, with links.
7. Baseline metrics block.
8. Suppressed count and expiring suppressions.
9. Degradations and capability gaps (copied from `doctor`).

After `run finish` the same file gains an "Outcome" section (applied / reverted / skipped counts, final gate, metric deltas vs baseline, untraced-commit check) and `apply/ledger.md` is written:

| Finding | Rule | Commit | Files | Fast-check | Wave gate | Outcome |
|---|---|---|---|---|---|---|
| F-0007 | reach-04 | `ab12cd3` | `src/a.ts` | pass | wave-3 pass | applied |

## 10. `codebase-health.md` (Deep mode)

Sections: scope and churn window (`git log --since=… -- <scope>` counts; cold modules excluded), top hot spots, each proposal with its badge (`[STRONG]`, `[WORTH EXPLORING]`, `[SPECULATIVE]`) and the Deletion Test / Seam Test result, and a Mermaid `flowchart TD` Before/After subgraph pair for each `[STRONG]` structural change (shape per the source skill). Proposals link to their `F-` files; the document itself carries no edits.

## 11. Worked example (one finding, end to end)

1. `scan` runs `knip --reporter json`; issue `exports` for `src/a.ts: formatTimestamp` becomes candidate `c-0142`.
2. `ts-triager` (chunk C03) runs `rg -w formatTimestamp --glob '!src/a.ts'` → 0 hits; no dynamic access; `src/a.ts` is not an entry or public API → `ts-opt verdict add --candidate c-0142 --verdict confirmed --q1 no --q2 no --q3 no --evidence "…"`.
3. `findings ingest` writes `F-0007.md` (`reach-04`, wave 3, `fix_risk: low`, `fix_mode: auto`, `touches: [src/a.ts]`), adds it to `plan.md` under Wave 3.
4. Reviewer ticks `[x] F-0007`; `plan lock` approves it.
5. `fix` reaches wave 3: agent removes `export`, `ts-opt check` (fast) passes, `ts-opt commit F-0007` verifies staged files ⊆ `touches`, trailer `Finding: F-0007`, writes the sha into `F-0007.md#Applied`.
6. Wave gate passes; `run finish` lists it in `ledger.md`.

## 12. Intermediate records (`raw/`, gitignored) — shapes the CLI reads and writes

**Candidate** (`raw/candidates.jsonl`, one object per line; written by `scan`; ids `c-0001…` in scan order):
```jsonl
{"schema":"ts-optimize/candidate@1","id":"c-0142","rule":"reach-04","domain":"reachability","engine":"knip@6.41.0:exports","package":"apps/web","file":"src/a.ts","line":12,"col":14,"symbol":"formatTimestamp","grain":"symbol","snippet":"export const formatTimestamp = (t: number) => …","raw_ref":"raw/knip.json#/issues/17/exports/0","severity_hint":"warn","batch":5,"wave":"3","fix_mode_hint":"auto","consumers":[],"triage":"agent"}
```
`snippet` ≤ 5 lines / 400 chars. `consumers` = files importing the symbol (for export/type/barrel/file rules), copied into `touches` at ingest.

**Chunk** (`raw/chunks/C03.json`, written by `triage plan`; ≤ `--chunk-size` candidates of one domain and one package):
```json
{"schema":"ts-optimize/chunk@1","id":"C03","run":"2026-10-19T1432Z-a1b2","domain":"reachability","package":"apps/web",
 "candidates":["c-0141","c-0142"],
 "context":{"packs":["next"],"protected":["src/public-api.ts"],"entry_conventions":["app/**/route.ts"],"rule_notes":{"reach-04":"Strip export only after the declaration-emit pre-check."}},
 "protocol":"skills/audit/references/triage-protocol.md"}
```

**Verdict** (`raw/verdicts/C03.jsonl`, one per candidate; written only by `verdict add`):
```jsonl
{"schema":"ts-optimize/verdict@1","candidate":"c-0142","verdict":"confirmed","confidence":"certain","q1":"no","q2":"no","q3":"no","evidence":["rg -w formatTimestamp --glob '!src/a.ts' → 0 hits"],"reason":"Defined and used only in src/a.ts","touches":["src/a.ts"],"depends_on":[],"recommendation":null,"codify":null}
```
`ts-opt verdict add --chunk C03 --candidate c-0142 --verdict confirmed|false-positive|deferred --confidence certain|likely|speculative --q1 yes|no|unknown --q2 … --q3 … --evidence "<cmd → result>" [--evidence …] --reason "…" [--touch <path> …] [--depends-on c-… …] [--codify "<where the false positive is encoded>"]`. Validation (exit 2, nothing written on failure): candidate belongs to the chunk; at most one verdict per candidate; any `yes` among q1–q3 ⇒ verdict must not be `confirmed`; `false-positive` requires `--codify` or a `--reason` naming the engine behaviour; `confirmed` for a `fix_risk: high` rule requires all three answers and ≥ 1 evidence; evidence strings ≤ 300 chars, ≤ 8 per verdict; `--touch` paths must exist inside the repo; `certain` confidence requires all three answers `no`.

**Proposal** (`ts-opt proposal add`): `--origin architect --rule struct-03 --file src/x.ts --line 12 --recommendation STRONG|WORTH_EXPLORING|SPECULATIVE --deletion-test "…" --seam-test "…" --touch … --plan-step "…" [--mermaid-file path]` or `--origin fixer --parent F-0007 --reason "consumer needs an import change" --touch src/c.ts`. It appends a candidate (`origin` recorded) that skips triage if `fixer`, goes through ingest as a normal finding in the parent's wave with `state: open` and needs approval before it can be committed (`plan check` or `plan lock` for runs already locked is replaced by `plan amend F-new --approve`, which requires the user's explicit yes in chat; the `fix` skill must ask).

**Run-scoped state files** are written atomically (write to `*.tmp`, `fsync`, rename) so a crash never leaves a half-written `run.json` or finding.
