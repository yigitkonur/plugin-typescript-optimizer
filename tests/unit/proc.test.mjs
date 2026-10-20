// Windows spawning plan (lib/core/proc.mjs): .cmd shims go through cmd.exe with quoted arguments; unsafe arguments are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnPlan } from '../../lib/core/proc.mjs';

test('spawnPlan: non-Windows spawns the command as given', () => {
  assert.deepEqual(spawnPlan('npm', ['ci'], {}, false), { file: 'npm', args: ['ci'], opts: {} });
});

test('spawnPlan: a .cmd shim found on PATH runs through cmd.exe with quoted arguments', () => {
  const d = mkdtempSync(join(tmpdir(), 'tsopt-proc-'));
  try {
    writeFileSync(join(d, 'npm.cmd'), '@echo off\r\n');
    const p = spawnPlan('npm', ['ci', '--prefix', 'C:\\a b\\', '--ignore-scripts'], { PATH: d }, true);
    assert.match(p.file, /cmd(\.exe)?$/i);
    assert.deepEqual(p.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(p.opts.windowsVerbatimArguments, true);
    assert.ok(p.args[3].startsWith('""') && p.args[3].endsWith('"'), p.args[3]);
    assert.ok(p.args[3].includes('npm.cmd" "ci" "--prefix" "C:\\a b\\\\" "--ignore-scripts"'), p.args[3]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('spawnPlan: arguments cmd.exe would expand are refused, an .exe is spawned directly', () => {
  const d = mkdtempSync(join(tmpdir(), 'tsopt-proc-'));
  try {
    writeFileSync(join(d, 'pnpm.cmd'), '@echo off\r\n'); writeFileSync(join(d, 'git.exe'), '');
    assert.match(spawnPlan('pnpm', ['%PATH%'], { PATH: d }, true).error, /not safe/);
    assert.match(spawnPlan('pnpm', ['a"b'], { PATH: d }, true).error, /not safe/);
    const g = spawnPlan('git', ['log', '--format=%H'], { PATH: d }, true);
    assert.equal(g.args.join(' '), 'log --format=%H'); assert.match(g.file, /git\.exe$/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
