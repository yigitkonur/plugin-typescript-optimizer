import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadPacks, workerdInfo, frameworkEntryGlobs, routeLike, protectedPaths, processEnvPopulated } from '../../lib/detect/packs.mjs';
import { scanManifests } from '../../lib/detect/manifests.mjs';

function worker(file, text, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tsopt-packs-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, file), text);
  for (const [n, t] of Object.entries(extra)) writeFileSync(join(root, n), t);
  return root;
}
async function info(file, text, extra) {
  const root = worker(file, text, extra);
  try {
    const mf = await scanManifests(root, false);
    return workerdInfo(root, mf, []).variants[0];
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const j = (date, flags) => JSON.stringify({ main: 'src/index.ts', ...(date ? { compatibility_date: date } : {}), ...(flags ? { compatibility_flags: flags } : {}) });

test('packs load with checked_on / sources', () => {
  const p = loadPacks();
  assert.ok(Object.keys(p.frameworks.packs).length >= 28);
  for (const pk of Object.values(p.frameworks.packs)) assert.ok(Array.isArray(pk.sources) && 'checked_on' in pk);
  assert.equal(p.workerd.process_env.populate_opt_out_flag, 'nodejs_compat_do_not_populate_process_env');
});

const cases = [
  ['jsonc nodejs_compat + 2025-06-01', 'wrangler.jsonc', `// c\n{"main":"src/index.ts","compatibility_date":"2025-06-01","compatibility_flags":["nodejs_compat"],}`, true],
  ['json nodejs_compat + 2024-09-01 (no populate)', 'wrangler.json', j('2024-09-01', ['nodejs_compat']), false],
  ['json nodejs_compat + populate flag + old date', 'wrangler.json', j('2024-09-01', ['nodejs_compat', 'nodejs_compat_populate_process_env']), true],
  ['json date 2025-04-01 w/o nodejs_compat', 'wrangler.json', j('2025-04-01'), false],
  ['json nodejs_compat exactly 2025-04-01', 'wrangler.json', j('2025-04-01', ['nodejs_compat']), true],
  ['json 2025-03-31 nodejs_compat', 'wrangler.json', j('2025-03-31', ['nodejs_compat']), false],
  ['json date 2026-08-04 auto node compat', 'wrangler.json', j('2026-08-04'), true],
  ['json date 2026-08-03 no flags', 'wrangler.json', j('2026-08-03'), false],
  ['json 2026-08-04 + no_nodejs_compat', 'wrangler.json', j('2026-08-04', ['no_nodejs_compat']), false],
  ['opt-out flag', 'wrangler.json', j('2025-06-01', ['nodejs_compat', 'nodejs_compat_do_not_populate_process_env']), false],
  ['unrecognised process_env flag', 'wrangler.json', j('2025-06-01', ['nodejs_compat', 'nodejs_compat_no_process_env_future']), 'unknown'],
  ['no date no flags', 'wrangler.json', j(), false],
  ['toml 2024-09-01', 'wrangler.toml', 'main = "src/index.ts"\ncompatibility_date = "2024-09-01"\n', false],
  ['toml nodejs_compat 2025-06-01', 'wrangler.toml', 'main = "src/index.ts"\ncompatibility_date = "2025-06-01"\ncompatibility_flags = ["nodejs_compat"]\n', true],
  ['unreadable json => unknown', 'wrangler.json', '{ not json', 'unknown'],
  ['unreadable toml => unknown', 'wrangler.toml', 'a = = 1', 'unknown'],
];
for (const [name, file, text, want] of cases) {
  test(`process_env_populated: ${name}`, async () => {
    const v = await info(file, text);
    assert.equal(v.process_env_populated, want, v.populated_reason);
  });
}

test('no wrangler config readable (dep only) => unknown', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsopt-packs-'));
  const r = workerdInfo(root, { wrangler: [] }, [{ path: '.', deps: ['wrangler'] }]);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.active, true);
  assert.equal(r.variants[0].process_env_populated, 'unknown');
  assert.equal(workerdInfo(root, { wrangler: [] }, []).active, false);
});

test('processEnvPopulated(null) is unknown', () => assert.equal(processEnvPopulated(null).process_env_populated, 'unknown'));

test('rpc classes located by scanning main dir', async () => {
  const root = worker('wrangler.jsonc', '{"main":"src/index.ts","durable_objects":{"bindings":[{"name":"C","class_name":"Counter"}]},"workflows":[{"name":"w","binding":"W","class_name":"Flow"}]}',
    { 'worker-configuration.d.ts': 'interface Env {}' });
  writeFileSync(join(root, 'src/index.ts'), 'export default {}');
  mkdirSync(join(root, 'src/do'));
  writeFileSync(join(root, 'src/do/c.ts'), 'export class Counter extends DurableObject {}');
  const mf = await scanManifests(root, false);
  const v = workerdInfo(root, mf, []).variants[0];
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(v.rpc_classes, [{ class_name: 'Counter', kind: 'durable_object', file: 'src/do/c.ts' }, { class_name: 'Flow', kind: 'workflow', file: null }]);
  assert.deepEqual(v.entry_files, ['src/index.ts']);
  assert.deepEqual(v.ambient_files, ['worker-configuration.d.ts']);
});

const W = join(homedir(), '.cache/ts-optimize-dev/work');
test('F06 fixture variants', { skip: !existsSync(join(W, 'F06')) }, async () => {
  const root = join(W, 'F06');
  const mf = await scanManifests(root, false);
  const r = workerdInfo(root, mf, []);
  const by = Object.fromEntries(r.variants.map((v) => [v.dir.split('/').pop(), v]));
  assert.equal(r.active, true);
  assert.equal(by['a-jsonc'].process_env_populated, true);
  assert.equal(by['b-toml'].process_env_populated, false);
  assert.equal(by['c-json'].process_env_populated, false); // doc 05 s6: no node compat => false
  for (const v of r.variants) {
    assert.deepEqual(v.rpc_classes.map((c) => [c.class_name, c.file && c.file.split('/').pop()]), [['Counter', 'counter.ts'], ['ReportWorkflow', 'report-workflow.ts']]);
    assert.equal(v.ambient_files.length, 1);
  }
  assert.equal(by['a-jsonc'].node_compat, true);
});

test('F05 next pack', { skip: !existsSync(join(W, 'F05')) }, () => {
  assert.ok(frameworkEntryGlobs(['next']).entry.length > 0);
  assert.ok(frameworkEntryGlobs(['next']).special_exports['app/**/page.*'].includes('generateMetadata'));
  assert.equal(routeLike('app/page.tsx', ['next']), true);
  assert.equal(routeLike('app/blog/[slug]/page.tsx', ['next']), true);
  assert.equal(routeLike('app/api/x/route.ts', ['next']), true);
  assert.equal(routeLike('lib/legacy-format.ts', ['next']), false);
  assert.equal(routeLike('app/page.tsx', []), false);
  const pp = protectedPaths(join(W, 'F05'), { packages: [{ path: '.' }], frameworks: ['next'], packs: [] });
  assert.ok(pp.includes('next-env.d.ts'));
  assert.ok(pp.includes('tsconfig*.json'));
});

test('protectedPaths: F06 variant registers class files and dist->src mapping', { skip: !existsSync(join(W, 'F06')) }, () => {
  const pp = protectedPaths(join(W, 'F06'), { packages: [{ path: 'variants/a-jsonc' }], frameworks: [], packs: [{ name: 'workerd', paths: ['variants/a-jsonc'] }] });
  assert.ok(pp.includes('variants/a-jsonc/src/counter.ts'));
  assert.ok(pp.includes('variants/a-jsonc/worker-configuration.d.ts'));
  assert.ok(pp.includes('variants/a-jsonc/src/index.ts'));
});
