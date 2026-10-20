#!/usr/bin/env node
// Prepare a fixture work copy that is mid-run (state "applying", wave begun) for live hook rows, using only the real CLI.
//   TSOPT_NS=h4live node tests/harness/applying-live.mjs F02 reach-04 3
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DEV, REPO } from './fixture.mjs';
import { git } from './applying.mjs';
import { auditFixture } from './fixrun.mjs';

export function prepareApplying(fixture, rule, wave) {
  const work = auditFixture(fixture);
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  const T = (...a) => { const r = spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), ...a, '--cwd', work], { cwd: work, encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' } }); if (r.status !== 0) throw new Error(`${a.join(' ')} failed: ${r.stdout}${r.stderr}`); return r; };
  T('run', 'begin'); T('plan', 'check', '--rule', rule); T('plan', 'lock'); T('run', 'wave', 'begin', wave);
  return work;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fixture, rule, wave] = process.argv.slice(2);
  console.log(prepareApplying(fixture, rule, wave));
}
