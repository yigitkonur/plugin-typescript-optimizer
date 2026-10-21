#!/usr/bin/env node
// Entry-point smoke test, run by every CI cell (`ci.mjs core`): the hook handlers act when started as `node <file>` (their
// main-module check must hold on Windows paths and through symlinks), and on Windows `bin\ts-opt.cmd` starts the CLI.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from './fixture.mjs';

const version = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const tmp = mkdtempSync(join(tmpdir(), 'tsopt-smoke-'));
writeFileSync(join(tmp, '.git'), 'x');
writeFileSync(join(tmp, 'tsconfig.json'), '{}');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${detail}`}`); if (!ok) failed++; };
const hook = (file, input) => spawnSync(process.execPath, [join(REPO, 'lib', 'hooks', file)], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: tmp, ...input }), encoding: 'utf8', timeout: 20_000 });

console.log(`argv[1] of this script: ${process.argv[1]}`);
let r = hook('agent-guard.mjs', { agent_type: 'ts-optimize:ts-triager', tool_input: { command: 'rm -rf src' } });
check('agent-guard denies a triager rm', /"permissionDecision":"deny"/.test(r.stdout), `exit ${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
r = hook('cli-allow.mjs', { tool_input: { command: 'ts-opt doctor' } });
check('cli-allow pre-approves ts-opt doctor', /"permissionDecision":"allow"/.test(r.stdout), `exit ${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
r = hook('cmd-guard.mjs', { tool_input: { command: 'npx -y tsc --noEmit' } });
check('cmd-guard denies npx -y tsc without typescript', /"permissionDecision":"deny"/.test(r.stdout), `exit ${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
if (process.platform === 'win32') {
  r = spawnSync(`"${join(REPO, 'bin', 'ts-opt.cmd')}" --version`, { shell: true, encoding: 'utf8', timeout: 20_000 });
  check(`bin\\ts-opt.cmd --version prints ${version}`, r.status === 0 && r.stdout.trim() === version, `exit ${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
