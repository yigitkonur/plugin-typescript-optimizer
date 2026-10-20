#!/usr/bin/env node
// Run a hook exactly as hooks.json declares it (bash -c <command>, golden stdin) and check expectations.
//   node tests/harness/hook.mjs tests/hooks/<case>.case.json      (or imported: runCase(path))
// case: { name, handler:"session-start", event?, tmp?:{files:{path:content}}, cwd:"{WORK}/F10"|"{TMP}"|abs, stdin:{...}, env?:{},
//         expect:{ stdout?:string, stdoutJson?:{...subset}, stdoutMatches?:regex, exitCode?:0, maxMs?:50 } }
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEV, REPO } from './fixture.mjs';

function findCommand(handler) {
  const j = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8'));
  for (const groups of Object.values(j.hooks)) for (const g of groups) for (const h of g.hooks) {
    if ((h.command || '').includes(`lib/hooks/${handler}.mjs`)) return h;
  }
  throw new Error(`no hook for handler ${handler} in hooks.json`);
}

export function runCase(path) {
  const c = JSON.parse(readFileSync(path, 'utf8'));
  let tmp = null;
  if (c.tmp) {
    tmp = mkdtempSync(join(tmpdir(), 'tsopt-hook-'));
    for (const [rel, content] of Object.entries(c.tmp.files || {})) { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), content); }
    for (const [rel, target] of Object.entries(c.tmp.symlinks || {})) { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); symlinkSync(target, join(tmp, rel)); }
  }
  try {
    const sub = (s) => String(s).split('{WORK}').join(join(DEV, 'work')).split('{TMP}').join(tmp || '').split('{REPO}').join(REPO);
    const cwd = sub(c.cwd);
    const stdin = JSON.parse(sub(JSON.stringify(c.stdin || {})));
    const h = findCommand(c.handler);
    const command = h.command.split('${CLAUDE_PLUGIN_ROOT}').join(REPO);
    // timing assertions are noisy on a busy machine: take the best of up to 3 runs (functional output must be identical anyway)
    let r; let ms = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = process.hrtime.bigint();
      r = spawnSync('bash', ['-c', command], { cwd, input: JSON.stringify(stdin), encoding: 'utf8', timeout: (h.timeout || 10) * 1000, env: { ...process.env, ...(c.env || {}), CLAUDE_PLUGIN_ROOT: REPO } });
      ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
      if (!c.expect?.maxMs || ms <= c.expect.maxMs) break;
    }
    const e = c.expect || {}; const fails = [];
    if (e.exitCode !== undefined && r.status !== e.exitCode) fails.push(`exit ${r.status} != ${e.exitCode}`);
    if (e.stdout !== undefined && r.stdout !== e.stdout) fails.push(`stdout ${JSON.stringify(r.stdout.slice(0, 200))} != ${JSON.stringify(e.stdout)}`);
    if (e.stdoutMatches && !new RegExp(e.stdoutMatches).test(r.stdout)) fails.push(`stdout does not match /${e.stdoutMatches}/: ${r.stdout.slice(0, 200)}`);
    if (e.stdoutJson) {
      let o = null; try { o = JSON.parse(r.stdout); } catch { fails.push('stdout is not JSON'); }
      if (o) for (const [k, v] of Object.entries(e.stdoutJson)) if (JSON.stringify(k.split('.').reduce((a, p) => a?.[p], o)) !== JSON.stringify(v)) fails.push(`json ${k} = ${JSON.stringify(k.split('.').reduce((a, p) => a?.[p], o))} != ${JSON.stringify(v)}`);
    }
    if (e.maxMs !== undefined && ms > e.maxMs) fails.push(`took ${ms.toFixed(1)} ms > ${e.maxMs}`);
    return { name: c.name, ok: fails.length === 0, fails, ms: Math.round(ms * 10) / 10, stdout: r.stdout, stderr: r.stderr, exit: r.status };
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let bad = 0;
  for (const p of process.argv.slice(2)) {
    const r = runCase(p);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.ms} ms, exit ${r.exit}) stdout=${JSON.stringify(r.stdout.slice(0, 160))}${r.fails.length ? '\n  ' + r.fails.join('\n  ') : ''}`);
    if (!r.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
