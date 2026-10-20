#!/usr/bin/env node
// CI entry points (explicit file lists: `node --test <dir>` fails on Node 26, globs differ per shell).
//   node tests/harness/ci.mjs prepare   install the pinned toolbox (engines + native compiler) into the dev TS_OPT_HOME the tests use
//   node tests/harness/ci.mjs core      what every OS x Node cell runs
//   node tests/harness/ci.mjs full      the whole suite (needs pnpm, yarn, bun on PATH)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO } from './fixture.mjs';

const mode = process.argv[2];
const win = process.platform === 'win32';
const list = (dir) => readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(dir, f));
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', ...opts }); if (r.status !== 0) process.exit(r.status || 1); };

if (mode === 'prepare') {
  const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home') };
  sh(process.execPath, [join(REPO, 'bin', 'ts-opt'), 'toolbox', 'install', '--yes'], { env });
  sh(process.execPath, [join(REPO, 'bin', 'ts-opt'), 'toolbox', 'status'], { env });
} else if (mode === 'core') {
  // unit tests, hook goldens (bash hooks are inactive on Windows: doc 03), and one full F01 run through the CLI
  sh(process.execPath, ['--test', ...list('tests/unit'), ...(win ? [] : ['tests/hooks.test.mjs'])]);
  // the fixture's own tools (vitest 5, Knip 6) need Node >= 20.19: on older Node the plugin code is covered by the unit tests and hook goldens above
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 20 || (maj === 20 && min >= 19)) sh(process.execPath, ['--test', '--test-name-pattern=^3\\.19', 'tests/fix.test.mjs']);
  else console.log(`node ${process.versions.node}: fixture toolchain needs Node >= 20.19; lifecycle test skipped`);
} else if (mode === 'full') {
  sh(process.execPath, ['--test', ...list('tests'), ...list('tests/unit')]);
} else {
  console.error('usage: ci.mjs prepare|core|full'); process.exit(2);
}
