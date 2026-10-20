---
name: doctor
description: "Show what ts-optimize can do in this repository: packages, compilers, engines, gate commands, degradations and the action that fixes each. Read-only."
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(ts-opt doctor *) Bash(ts-opt detect *)
---

!`ts-opt detect --brief 2>&1 || true`

If the block above is missing, empty, or contains `[shell command execution disabled by policy]`, run `ts-opt detect --brief` yourself. If `ts-opt` is not found, use `node "${CLAUDE_PLUGIN_ROOT}/bin/ts-opt"` instead (it asks for permission once).

# /ts-optimize:doctor

Read-only health report. Change nothing.

1. If the block says `typescript: none`, say `No TypeScript found under <root>; nothing to do.` and stop.
2. Run `ts-opt doctor`. It prints the full report as text.
3. Present it in at most 25 lines, in this order:
   - detection summary: root, git state, package manager, packages, workspaces;
   - compilers: the project's authoritative compiler and whether a fast native one exists;
   - engines: each with version, source and `works` or the reason it does not;
   - gate legs: typecheck, test, build, declaration-emit, and which are unavailable and why;
   - toolbox state and config validation;
   - registered hooks.
4. For every degradation, print the single action that fixes it, exactly as `ts-opt doctor` gives it. Do not invent fixes.
5. End with the next step: `/ts-optimize:audit` when nothing blocks it, otherwise the first blocking action.

Never install anything, edit files, or run an engine yourself; if the user wants the toolbox, tell them to run the `fix:` line from the doctor output (`ts-opt toolbox install --yes`): it installs per machine and needs their consent.
