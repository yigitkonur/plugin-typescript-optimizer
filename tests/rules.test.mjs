// Row 1.10: regex precision suite. For every tests/fixtures/rules/<id>/expect.json: each expected line fires (right tell), silent files stay silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './harness/fixture.mjs';
import { loadRules } from '../lib/catalog/index.mjs';
import { runTells } from '../lib/engines/tells.mjs';

const RULES = loadRules();
const walk = (dir, rel = '') => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? walk(dir, rel ? `${rel}/${n}` : n) : [rel ? `${rel}/${n}` : n]));
const DIR = join(REPO, 'tests', 'fixtures', 'rules');
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'expect.json'))).sort() : [];

test('every regex rule has a precision fixture', () => {
  const missing = [...RULES.values()].filter((r) => r.tells.length && !ids.includes(r.id)).map((r) => r.id);
  assert.deepEqual(missing, []);
});

for (const id of ids) {
  test(`rule ${id}: must-fire fires on the listed lines, must-not-fire stays silent`, async () => {
    const exp = JSON.parse(readFileSync(join(DIR, id, 'expect.json'), 'utf8'));
    const rule = RULES.get(exp.rule || id);
    assert.ok(rule, `rule ${id} missing from catalog`);
    const root = join(DIR, id);
    const files = walk(root).filter((f) => f !== 'expect.json');
    const { candidates } = await runTells({ root, files, rules: [rule], packages: [], skipGenerated: false });
    const got = candidates.map((c) => `${c.file}:${c.line}`).sort();
    const want = (exp.fire || []).map((x) => `${x.file}:${x.line}`).sort();
    assert.deepEqual(got.filter((g) => !(exp.silent_astgrep_only || []).some((s) => g.startsWith(s.file + ':'))), want, `tells for ${id}`);
    for (const s of exp.silent || []) assert.equal(got.filter((g) => g.startsWith(s + ':')).length, 0, `${s} must be silent`);
    for (const x of exp.fire || []) if (x.tell) assert.ok(candidates.find((c) => c.file === x.file && c.line === x.line)?.tells.includes(x.tell), `${x.file}:${x.line} should be tell ${x.tell}`);
  });
}
