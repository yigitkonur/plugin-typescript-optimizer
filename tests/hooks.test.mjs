// Golden-stdin cases for every hook handler (tests/hooks/*.case.json), run exactly as hooks/hooks.json declares them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, ensureFixture } from './harness/fixture.mjs';
import { runCase } from './harness/hook.mjs';

process.env.TSOPT_NS = 'hooks';
ensureFixture('F01', {}); ensureFixture('F10', {});
const dir = join(REPO, 'tests', 'hooks');
for (const f of readdirSync(dir).filter((n) => n.endsWith('.case.json')).sort()) {
  test(f.replace('.case.json', ''), () => {
    const r = runCase(join(dir, f));
    assert.ok(r.ok, `${r.name}\n${r.fails.join('\n')}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  });
}
