// `--help` after a subcommand prints that command's flags and never runs the command (it used to be parsed and ignored,
// so `ts-opt plan lock --help` locked the plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/ts-opt', import.meta.url));
const ts = (cwd, ...a) => spawnSync(process.execPath, [BIN, ...a, '--cwd', cwd], { cwd, encoding: 'utf8' });

test('--help after a subcommand prints the flags, exits 0 and runs nothing', () => {
  const d = mkdtempSync(join(tmpdir(), 'tsopt-help-'));
  try {
    for (const cmd of [['plan', 'lock'], ['run', 'abort'], ['scan'], ['rule', 'reach-01'], ['toolbox', 'install']]) {
      const r = ts(d, ...cmd, '--help');
      assert.equal(r.status, 0, `${cmd.join(' ')}: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`^ts-opt ${cmd[0]} — options:`), cmd.join(' '));
      assert.doesNotMatch(r.stdout, /^# reach-01/m, 'the rule text means the command ran');
    }
    assert.deepEqual(readdirSync(d), [], 'nothing was written into the directory');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
