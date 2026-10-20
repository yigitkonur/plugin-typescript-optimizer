# 03 — Hooks: exactly what fires, what it injects or blocks, and why

Claude Code has 33 hook events (checked live, 2026-10-19). `ts-optimize` uses **three events with five handlers** (H1–H5).
Plugin hooks register when the session loads the plugin and run in every project, so every handler is built to
be free and silent unless it has run-scoped (H1, H3, H4), command-scoped (H2) or plugin-subagent-scoped (H5) content.

## 1. Principles (how a hook earns its place)

A hook is justified only if **all** hold:
1. The behaviour must be *deterministic* (a skill can be ignored, forgotten after compaction, or out-voted by task pressure).
2. It acts at a *moment a skill cannot see* (a tool call about to run, a session starting after compaction, an edit batch just finished).
3. It adds **nothing** to context when there is nothing to say (no always-on banners).
4. Its worst case is bounded: fail-open on infrastructure errors (crash, timeout, unparsable input → exit 0, no output), fail-closed only on the specific safety rule it owns.

Cost model used below: *latency* = wall time added to the triggering step; *tokens* = `additionalContext` or deny-reason text the model must read. Prefilter = a shell snippet using only builtins (plus `dirname` while below a repo root) that costs ~1–5 ms and avoids starting Node; it walks up from `$PWD` to the first directory containing `.ts-optimize/state/open-run`, stopping at a directory that contains `.git` (so in an ordinary repo root it is a single `test`). The hook never runs the TypeScript presence test; a repo with no `.ts-optimize/` is never touched.

Shared plumbing: all handlers are `node "${CLAUDE_PLUGIN_ROOT}/lib/hooks/<name>.mjs"`; stdin is the hook JSON (`cwd`, `session_id`, `tool_name`, `tool_input`, …); the repo root is found by the prefilter's walk-up from `$PWD` (not `CLAUDE_PROJECT_DIR`, which can be a monorepo sub-package) and re-derived inside Node with `git rev-parse --show-toplevel`; output is a single JSON object on stdout; `shell` is pinned to `bash`; `timeout` is set on every handler.

## 2. The handlers

### H1 — `SessionStart` → `resume-context`

| | |
|---|---|
| Fires | `SessionStart`, matcher `startup\|resume\|clear\|compact\|fork` (a forked session needs the pointer too) |
| Prefilter | `[ -f "$ROOT/.ts-optimize/state/open-run" ] \|\| exit 0` (so: only repos where a run is open) |
| Reads | `run.json` of the open run, `git status --porcelain` count, current branch |
| Output shape | `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` (plain stdout is also added to context, but the structured form is used so the text can never be mistaken for a command) |
| Injects | one `additionalContext` string, ≤ 700 chars |
| Blocks | never |
| Latency / tokens | ≤ 150 ms once per session start; ~150 tokens; **0** when no run is open |
| Failure | exit 0, nothing |

Example payload (state `applying`):
```
ts-optimize: run 2026-10-19T1432Z-a1b2 is APPLYING on branch chore/ts-cleanup (wave 3 of [R0,1,2,3,B,4,5]; F-0014 in progress, 2/7 done in this wave). Last green gate: wave 2. 2 uncommitted files. Continue with /ts-optimize:fix; commits go through `ts-opt commit` only. State: .ts-optimize/runs/2026-10-19T1432Z-a1b2/run.json
```
State `planned`: `ts-optimize: audit run <id> awaits review — 212 findings, 31 need a decision. Edit .ts-optimize/runs/<id>/plan.md (tick [x]), then run /ts-optimize:fix.` State `locked`/`verifying` have their own one-liners.

Why a hook, not a skill or command: after `compact` or `resume` the agent has no memory of where it was; skill text survives compaction only partially (first 5k tokens of recent skills, 25k shared) and is absent on `resume`/`clear`. The run state lives on disk; only a SessionStart hook can put a *pointer* to it into a fresh context at exactly the moment the context is empty. No skill can run before the first user message.

### H2 — `PreToolUse` (Bash) → `cmd-guard`

| | |
|---|---|
| Fires | `PreToolUse`, matcher `Bash`, with one handler per `if` filter (each `if` takes a single permission rule) so Node starts only for candidate commands: `Bash(*knip*--fix*)`, `Bash(*knip *-f *)`, `Bash(npx tsc *)`, `Bash(*dlx tsc *)`, `Bash(bunx tsc *)` (the space before the trailing `*` keeps `npx tsconfig-…` out while still matching a bare `npx tsc`). Filters are checked per subcommand and a leading `*` also matches quoted text, so the handler re-parses the command and acts only if a real command segment matches |
| Prefilter | none beyond the `if` filter (non-matching commands never spawn the handler); inside Node the handler first requires the TypeScript presence test (doc 05 §1) for the repo and otherwise allows, so a non-TS repo is never blocked or asked |
| Reads | `tool_input.command`; nearest `node_modules/typescript`/`.bin/tsc` for the trap; `.ts-optimize/state/open-run` for severity |
| Rule A | `knip` with `--fix`/`-f` and **no** `--fix-type`: all-in-one fix deletes files, prunes exports and edits `package.json` in one unaudited pass. Decision: `deny` when a run is `applying` (the plugin's own flow), otherwise `ask` (the user keeps the last word). `--fix-type files` without `--allow-remove-files` is allowed (it removes nothing); `--fix-type files --allow-remove-files` outside a run → `ask` |
| Rule B | `npx tsc` / `pnpm dlx tsc` / `yarn dlx tsc` / `bunx tsc` when no TypeScript is resolvable from the repo: the registry package named `tsc` is a 2017 stub; decision `deny` |
| Output (deny) | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` |
| Latency / tokens | ≤ 60 ms when it spawns; reason ≤ 300 chars (~70 tokens); 0 otherwise |

Example reasons:
- A: `ts-optimize: all-in-one "knip --fix" would delete files, exports and dependencies in one pass. Scope it per wave: knip --fix --fix-type exports --format (types, files, dependencies likewise). Findings drive scope: see /ts-optimize:fix.`
- B: `ts-optimize: "npx tsc" fetches the obsolete registry package "tsc@2.0.4" when typescript is not installed. Use node_modules/.bin/tsc, or the package manager's exec (pnpm exec tsc), or let ts-opt pick the compiler (ts-opt check).`

Why a hook: both are *known catastrophic one-liners* the source skill lists as "never" (Safety Rail 4, Common Mistakes). Agents under pressure reach for them anyway, and the instruction is easily lost; a deterministic gate at the tool boundary is the only reliable defence.

### H3 — `PreToolUse` (Bash) → `commit-guard`

| | |
|---|---|
| Fires | `PreToolUse`, matcher `Bash`, `if: "Bash(*git *commit*)"` (matches `git commit` and `git -C dir commit`; the handler re-parses and acts only on a real `git … commit` segment) |
| Prefilter | `[ -f "$ROOT/.ts-optimize/state/open-run" ] \|\| exit 0`; then run state must be `ready`, `locked`, `applying` or `verifying` or exit 0 |
| Decision | From `ready` to `verifying` the **only** commit paths are `ts-opt commit` (accepted in `applying`) and the artifacts commit made by `run finish`. Any raw `git commit` Bash call is denied |
| Output (deny) | `…permissionDecisionReason: "ts-optimize: run <id> is <state>; commit with `ts-opt commit <F-id> [-m summary]` (it checks scope, protected paths, the fast check and previous wave gates, and writes the Finding trailer). To leave the run: `ts-opt run abort`."` |
| Latency / tokens | ≤ 40 ms (no git work in the hook itself); ~60 tokens on deny; 0 otherwise |

The checks themselves are in `ts-opt commit` (one implementation, `lib/gate/commit-policy.mjs`), so disabling hooks (opt-out below) does not remove the safety, it only removes the interception of raw `git commit`.

`ts-opt commit` refuses (exit 7) unless **all** hold:
1. run `applying`; every finding named is `approved`, eligible and belongs to the **current wave** (or an earlier wave whose gate is green); earlier waves' gates are green or the finding is in the first wave;
2. the set of changed paths (`git status --porcelain=v1 -z`, excluding `.ts-optimize/`) ⊆ `touches` of the named findings ∪ their lockfile when the rule is `reach-07`/`tc-*`; anything else is listed back to the agent;
3. a fast check (or the authoritative typecheck, if no fast compiler) at the **current worktree fingerprint** passed with no new diagnostic fingerprints vs baseline;
4. no protected-path violation (§4);
5. for `fix_risk: high` findings: the finding carries `triage` answers (all three questions) and an `evidence` entry;
6. for rules flagged `semantic_invariance: true` (doc 06 §6): no test-assertion lines changed, added control-flow keywords only where the finding allows them, ≤ 5 files per refactor unit.
Then it stages exactly the changed paths, commits with message `<type>(ts-optimize): <summary>` and trailers (`Rule:`, `Finding:` (repeated per id), `Run:`, `Wave:`, `Fast-check:`), writes the sha into each finding's `Applied` section, and appends to `apply/log.jsonl`. It does not pass `--no-verify` unless `config.commit.no_verify` is true; a failing repo commit hook (husky/lint-staged/commitlint) is surfaced as exit 6 with the hook output, never bypassed silently.

Why a hook: "every change traceable to a finding and verified" is a user requirement, not a suggestion. A skill can ask for it; only a PreToolUse interception makes the traceable path the *only* path.

### H4 — `PostToolBatch` → `fast-check`  (Phase 4; optional, config `hooks.fast_check`)

| | |
|---|---|
| Fires | `PostToolBatch` (after every batch of tool calls resolves, before the next model call). No `if` (not supported on this event) |
| Prefilter | `[ -f "$ROOT/.ts-optimize/state/open-run" ] \|\| exit 0` (a single `test -f` in non-run states); then run state must be `applying` |
| Reads | `config.json`, `state/fast-check.json`, `run.json`, `git status --porcelain=v1 -z`, baseline diagnostic fingerprints |
| Steps | (1) worktree fingerprint over TS-family files + `package.json` + `tsconfig*`; unchanged since last check ⇒ exit 0. (2) throttle: last check < 3 s ago ⇒ exit 0. (3) map changed files to TS packages and their typecheck sets. (4) run the **fast** compiler (`--noEmit --pretty false`; `-b` for solution configs) with timeout `min(20 s, 5 × baseline fast time)`. (5) multiset diff vs baseline fingerprints. (6) emit only **new** errors |
| Injects | `additionalContext`, ≤ 6 lines + "…and N more" |
| Blocks | never |
| Disabled when | no fast compiler; baseline fast time > 20 s (`run begin` records `fast_check.disabled_reason`); 3 divergences (fast fails where the authority passes); `TS_OPTIMIZE_HOOKS=off` |
| Latency / tokens | native compiler on a mid-size project 1–5 s per changed batch; ~100–150 tokens, only when new errors exist |

Example: `ts-optimize fast-check (tsc 7.0.2, 1.8 s): 2 NEW errors vs baseline — src/a.ts(3,10) TS2305: Module './b' has no exported member 'x'; src/c.ts(8,1) TS2307: Cannot find module './old'. Finding F-0014 is in progress; transient errors are expected mid-refactor, but ts-opt commit will refuse until clean.`

Why a hook: this is the "tight validation loop" tsgo makes affordable. Un-exporting or deleting breaks *other* files; a per-file LSP diagnostic would not show it, and relying on the agent to remember to run a check after each edit batch is exactly what fails. Why `PostToolBatch` and not `PostToolUse(Edit)`: one check per batch instead of one per edit; fires before the next model call so the agent sees the result in the same turn. If the payload has no edited-path list (unverified), the handler does not need it: it derives changes from git.

`PostToolBatch` input (verified in the live docs, 2026-10-20) is the common fields plus `tool_calls[]`, each with `tool_name`, `tool_input` (edited paths in `tool_input.file_path`), `tool_use_id` and `tool_response`. The handler uses `tool_calls[].tool_input.file_path` as a hint only; the authoritative change set still comes from `git status` so edits made through Bash are covered, and `tool_response` is never parsed. Fallback if the event misbehaves in verification (Phase 4 acceptance): register the same handler on `PostToolUse` with matcher `Edit|Write` (`MultiEdit` is a legacy tool and is not used), no `if` (brace expansion in `if` globs is undocumented), and filter by extension inside the handler after the `open-run` prefilter; the throttle still applies.

### H5 — `PreToolUse` (Bash|Read) → `agent-guard`

| | |
|---|---|
| Fires | `PreToolUse`, matcher `Bash\|Read`; the shell prefilter starts Node only when the stdin JSON names `ts-triager` or `ts-architect` in `agent_type` (the docs state subagent hook input adds `agent_id` and `agent_type`; the value format, e.g. `ts-optimize:ts-triager`, is matched by suffix — doc 10 §9 #15) |
| Policy | **Bash** is allowed only if every command segment is one of: `ts-opt verdict add\|status`, `ts-opt proposal add`, `ts-opt rule <id>`, `ts-opt findings show\|list`, `rg`, `git grep\|ls-files\|log\|show\|blame\|diff` (read-only forms), `wc`, `head`, `tail`, `sort`, `uniq`, `ls`, `tree`, `find` (without `-delete`/`-exec`), `jq`; no redirection to files (`>`, `>>`, `tee`), no `sed -i`, `rm`, `mv`, `cp`, package managers, `node`, `python`, `curl`, `wget`, no git write subcommands. **Read** is denied for secret paths (`catalog/secret-paths.json`: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, cloud credential files) |
| Output | deny JSON with a one-line reason (≤ 200 chars) |
| Latency / tokens | ~2 ms for any non-plugin caller (`cat` + `case`); ≈ 40 ms per call made by a plugin subagent; ~50 tokens only on deny |
| Failure | exit 0, nothing (fail open on infrastructure errors) |

Why a hook, not the prompt: plugin agents cannot carry `hooks`, `mcpServers` or `permissionMode` (docs) and `tools: Bash` is all-or-nothing, so "the triager is read-only" is otherwise only a sentence in a system prompt that untrusted repository text is trying to override. The hook turns it into a property, bounds the blast radius of prompt injection, and keeps secrets out of the triager's context.

## 3. `hooks/hooks.json` (illustrative; generated here so the quoting is valid JSON — the builder verifies with `claude plugin validate` and `claude --debug`)

```json
{
  "description": "ts-optimize: resume pointer, command guard, commit guard, plugin-subagent guard, fast check. Silent unless a run is open, a guarded command is typed, or a plugin subagent acts.",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact|fork",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "command -v node >/dev/null || exit 0; d=$PWD; while :; do [ -f \"$d/.ts-optimize/state/open-run\" ] && break; [ -e \"$d/.git\" ] && exit 0; n=$(dirname \"$d\"); [ \"$n\" = \"$d\" ] && exit 0; d=$n; done; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/session-start.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(*knip*--fix*)",
            "command": "command -v node >/dev/null || exit 0; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/cmd-guard.mjs\"",
            "timeout": 5
          },
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(*knip *-f *)",
            "command": "command -v node >/dev/null || exit 0; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/cmd-guard.mjs\"",
            "timeout": 5
          },
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(npx tsc *)",
            "command": "command -v node >/dev/null || exit 0; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/cmd-guard.mjs\"",
            "timeout": 5
          },
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(*dlx tsc *)",
            "command": "command -v node >/dev/null || exit 0; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/cmd-guard.mjs\"",
            "timeout": 5
          },
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(bunx tsc *)",
            "command": "command -v node >/dev/null || exit 0; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/cmd-guard.mjs\"",
            "timeout": 5
          },
          {
            "type": "command",
            "shell": "bash",
            "if": "Bash(*git *commit*)",
            "command": "command -v node >/dev/null || exit 0; d=$PWD; while :; do [ -f \"$d/.ts-optimize/state/open-run\" ] && break; [ -e \"$d/.git\" ] && exit 0; n=$(dirname \"$d\"); [ \"$n\" = \"$d\" ] && exit 0; d=$n; done; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/commit-guard.mjs\"",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "Bash|Read",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "command -v node >/dev/null || exit 0; i=$(cat); case \"$i\" in *agent_type*ts-triager*|*agent_type*ts-architect*) printf '%s' \"$i\" | node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/agent-guard.mjs\";; esac; exit 0",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolBatch": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "command -v node >/dev/null || exit 0; d=$PWD; while :; do [ -f \"$d/.ts-optimize/state/open-run\" ] && break; [ -e \"$d/.git\" ] && exit 0; n=$(dirname \"$d\"); [ \"$n\" = \"$d\" ] && exit 0; d=$n; done; exec node \"${CLAUDE_PLUGIN_ROOT}/lib/hooks/fast-check.mjs\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```
Notes: (1) The prefilter is `d=$PWD; while :; do [ -f "$d/.ts-optimize/state/open-run" ] && break; [ -e "$d/.git" ] && exit 0; n=$(dirname "$d"); [ "$n" = "$d" ] && exit 0; d=$n; done` — builtins only (`dirname` runs only below a repo root). It deliberately avoids `${…}` shell expansions because Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}`-style variables in hook command strings and unknown `${…}` forms are best not risked. (2) `cmd-guard.mjs` decides which rule applies by parsing the command, so one script serves the five `if` entries (kept separate because each `if` takes a single permission rule). **Command-segment parsing (all Bash-matching handlers):** split the command on `&&`, `||`, `;`, `|`, newlines and `$(…)`/backtick groups; a segment counts only if its first words are the real command (`git [-C x] commit`, `knip …`, `npx tsc`), so `echo "git commit"` and quoted text are allowed (the `if` filter is checked per subcommand and a leading `*` also matches quoted text). (3) `agent-guard` is spawned only when the stdin JSON names one of this plugin's subagents; every other Bash/Read call costs one `cat` and one `case`. (4) **Windows:** Claude Code runs shell-form hooks in Git Bash, or PowerShell when Git Bash is absent; what an explicit `shell: "bash"` does without Git Bash is not documented, so it is a Phase 6 verification item (doc 10 §9 #13). If it fails there, ship all handlers in exec form (`command: "node"`, `args: ["…/hook.mjs", "<name>"]`, prefilter inside Node, ≈ 40 ms per event) on every platform; the CLI-side checks (`ts-opt commit`, `gate`) are unaffected either way.

## 4. Protected paths and edit patterns (data for `commit-guard` and `ts-opt commit`)

Protected **paths** (deletion or rename is a violation): `config.protected` globs; ambient declaration files (`.d.ts` with no `import`/`export`, or named by `tsconfig` `include|files|types`) — covers `worker-configuration.d.ts`, `next-env.d.ts`, `vite-env.d.ts`, `global.d.ts`; `main`/entry files of a detected framework or `wrangler` config; files containing exported `DurableObject|WorkerEntrypoint|WorkflowEntrypoint` classes registered in wrangler; `package.json#exports|main|module|types|bin` targets (mapped to `src` when they point into `dist`); `tsconfig*.json` and `wrangler.*` themselves unless the finding's rule is `tc-*`.

Protected **edit patterns** (worker packs only, evaluated on the staged diff of files under a worker package): (a) the number of `ctx.waitUntil(` occurrences in a file decreases without an equal increase; (b) a removed `export default` or removed handler method (`fetch|scheduled|queue|email|tail`) in an entry file; (c) an **added** `process.env` in a worker file when the pack says `process_env_populated != true`; (d) removal of an import from `cloudflare:workers`/`cloudflare:test`.

A violation is exit 7 with the rule and path. Override: `ts-opt commit … --allow-protected <rule-id> --why "<reason>"` (recorded in `log.jsonl`); the `fix` skill instructs the agent to obtain explicit user confirmation first. There is no silent override.

## 5. Opt-outs and observability

- `TS_OPTIMIZE_HOOKS=off` (env) disables the nudges (H1, H2 rule A, H4 output); H2 rule B, H3 and H5 stay (they are protections) unless the project sets `config.json` `hooks.enabled=false`, which disables all five handlers (the CLI-side checks in `ts-opt` still apply).
- `config.json`: `hooks.enabled`, `hooks.fast_check`.
- Org `disableAllHooks` is honoured by Claude Code itself; the CLI-side policy still applies.
- `ts-opt doctor` prints the registered handlers, the last invocation time/result from `state/hook-log.jsonl` (≤ 200 lines, ring-buffered, no snippets), and why each is active or idle.

## 6. Considered and rejected

| Hook / event | Why rejected |
|---|---|
| `UserPromptSubmit` (inject TS context each prompt) | Pays tokens on every prompt in every repo to restate what skill descriptions and the SessionStart pointer already cover. |
| `SessionStart` banner in every TS repo | Noise with no state to act on; discoverability is the job of `/help` and skill descriptions. H1 fires only when a run is open. |
| `Stop` (block "done" while a finding is in progress / tree dirty) | Cannot tell "I am asking the user a question" from "I claim I'm finished" ⇒ false blocks and loops (`stop_hook_active` caps at 8). Replaced by: commit-guard (nothing unverified gets committed), `run finish` ledger (reports untraced commits and unfinished findings), and the SessionStart pointer on resume. |
| `SubagentStop` / `SubagentStart` | Triager output is already validated at the CLI (`verdict add` rejects malformed records); extra context belongs in the agent's system prompt, not injected per start. |
| `PreCompact` / `PostCompact` | `SessionStart(compact)` already restores the pointer; blocking compaction would hurt long runs. |
| `FileChanged` on `tsconfig*.json`/lockfiles | Detection cache is keyed on mtimes and revalidated lazily; no push needed. |
| `CwdChanged`, `InstructionsLoaded`, `ConfigChange`, `DirectoryAdded`, `Setup` | No plugin-relevant behaviour to change. |
| `PostToolUse` slop nudge on every TS edit (`as any`, `export *`, `process.env`) | Does not improve audits, fixes or tsgo adoption; precision problems (tests, boundaries, generated code); overlaps Biome/Oxlint rules and the `anti-slop` plugin; would add tokens to ordinary coding. The audit finds slop; prevention is a different product. |
| `PostToolUse(Edit)` per-edit typecheck | Replaced by `PostToolBatch`: one check per batch instead of one per edit. |
| `PreToolUse(Edit\|Write)` scope guard (deny edits outside the finding's `touches`) | Legitimate fixes touch consumers discovered while editing (import repairs after un-export); blocking edits mid-flight causes dead ends. Scope is enforced at the commit boundary where it is cheap to correct. |
| `PreToolUse(Bash)` deny `rm`/`git rm` outside findings | Same reason; deletion of protected paths is caught at commit by the protected-path rule. |
| `PermissionRequest` auto-approve of `ts-opt`/`git` read commands | Skill `allowed-tools` already pre-approves `Bash(ts-opt *)` during the skill turn; a global auto-approve widens trust. |
| `PermissionDenied` retry hook | No scenario. |
| `PostToolUseFailure` (inject triage help when `tsc`/tests fail) | `ts-opt gate` output already ends with `next_actions` and the gate-triage table is in the `fix` skill reference; injecting per failure adds tokens without new information. |
| `prompt` / `agent` / `http` / `mcp_tool` hook types | Non-deterministic or networked or require an MCP server; the handlers are pure, local, millisecond-scale commands. |
| Skill/agent-frontmatter `hooks:` instead of `hooks/hooks.json` | Would make the guards inactive after `resume`/`clear` until the skill is re-invoked and untestable by `claude plugin validate`; global handlers with a `test -f` prefilter cost the same and cover the gap. |
| `Notification`, `Elicitation*`, `Worktree*`, `Task*`, `Teammate*`, `Model switch`, `MessageDisplay`, `SessionEnd`, `StopFailure` | Irrelevant to the workflow. |

## 7. Acceptance for the hooks (also listed per phase in doc 10)

Golden-stdin tests in `tests/hooks/`: for each handler a JSON fixture and the expected stdout/exit code, run through the real `hooks.json` command string (so the prefilter and quoting are tested, not just the script):
- non-TS repo, no open run: all four exit 0 with empty stdout in < 50 ms.
- open run `planned`: only H1 speaks; H3/H4 silent.
- open run `applying`: raw `git commit -m x` ⇒ deny text above; `ts-opt commit` ⇒ allowed path; `knip --fix` ⇒ deny; `knip --fix --fix-type exports` ⇒ allow; `npx tsc` without local TS ⇒ deny, with local TS ⇒ allow.
- fast-check: introduce a breaking un-export in a fixture ⇒ one `additionalContext` naming the consumer error; second batch with no further change ⇒ silent; fast compiler absent ⇒ silent.
- `agent-guard`: stdin naming `ts-triager` with `rm -rf x`, `sed -i`, `npm i`, `rg x > out` ⇒ deny; with `rg -w sym`, `ts-opt verdict add …`, `git grep -n sym` ⇒ allow; `Read .env` ⇒ deny; the same inputs without `agent_type` ⇒ no output and ≤ 5 ms.
- crash injection (malformed stdin, missing `run.json`, read-only dir) ⇒ exit 0, empty stdout.
- prefilter latency: 100 invocations of each prefiltered command in a non-TS repo and in a TS repo with no `.ts-optimize/` ⇒ p95 ≤ 10 ms (H1–H4) and ≤ 5 ms (H5, non-plugin caller).
