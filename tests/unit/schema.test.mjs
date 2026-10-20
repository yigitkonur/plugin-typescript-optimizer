import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validate, loadSchema, checkSchemaId, SUPPORTED, KINDS } from '../../lib/artifacts/schema.mjs';
import { splitFrontMatter } from '../../lib/core/yaml-subset.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clone = (v) => JSON.parse(JSON.stringify(v));

const FINDING_MD = String.raw`---
schema: ts-optimize/finding@1
id: F-0007
fingerprint: sha1:9c1e5b0a4f…           # stable across runs; see §3.4
run: 2026-10-19T1432Z-a1b2
rule: reach-04                          # catalog id; rule_version recorded below
rule_version: 1
domain: reachability                    # platform|reachability|types|structure|slop|toolchain
batch: 5                                # 1–9 for dead-code/type batches (doc 06 §3), else null
wave: "3"                               # "R0"|"R"|"1"|"2"|"3"|"B"|"4"|"5"|"P"|"T1".."T4"|null  (always a string)
severity: warn                          # hard | warn | advisory   (impact if left alone)
fix_risk: low                           # low | medium | high      (blast radius of applying the fix)
confidence: certain                     # certain | likely | speculative
recommendation: null                    # structure domain only: STRONG | WORTH_EXPLORING | SPECULATIVE
verdict: confirmed                      # candidate | confirmed | false-positive | deferred   (set by triage)
state: approved                         # open | approved | rejected | applied | reverted | skipped | stale | suppressed | superseded
fix_mode: auto                          # auto | assisted | flag-only
engines: ["knip@6.41.0:exports"]
package: apps/web                       # workspace package (relative path) or "."
location: {file: src/a.ts, line: 12, symbol: formatTimestamp}
members: []                             # bulk findings: [{line: 12, symbol: a}, …] (≤ 50)
touches: ["src/a.ts"]                   # files the fix may modify or delete; the commit scope
depends_on: []                          # finding ids that must be applied first
origin: scan                            # scan | cascade:F-0003 | architect | fixer:F-0003
triage:
  framework_lifecycle: "no"             # "yes" | "no" | "unknown"  (quoted: YAML booleans are not used)
  dynamic_invocation: "no"
  public_contract: "no"
  evidence:                             # exact commands run and what they returned
    - "rg -w formatTimestamp --glob '!src/a.ts' → 0 hits"
    - "rg \"\\['formatTimestamp'\\]\" → 0 hits"
suppressed_by: null                     # suppression entry id, when state == suppressed
applied: null                           # {commit: "ab12cd3", gate: "wave-3", at: "2026-10-19T15:02Z"}
verified_on: 2026-10-19
---
## What
x
`;

const PLAN_MD = `---
schema: ts-optimize/plan@1
run: 2026-10-19T1432Z-a1b2
mode: standard
base_branch: main
work_branch: chore/ts-cleanup
gate_estimate_min: 14
---
# Fix plan
`;

const RULE_MD = String.raw`---
schema: ts-optimize/rule@1
id: type-01
version: 1
name: Type laundering
domain: types
batch: 8
wave: "4"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol                  # symbol | file | package | cycle | project
triage: agent                  # agent | deterministic
semantic_invariance: false
modes: [standard, deep]
engines: [R, A]
requires: {}                   # e.g. {strictNullChecks: true}
tells:
  - {id: t1, regex: '\bas\s+any\b',                glob: ['**/*.{ts,tsx,mts,cts}'], exclude: ['**/*.d.ts', '**/generated/**']}
  - {id: t2, regex: '\bas\s+unknown\s+as\s+[A-Z]\w*', glob: ['**/*.{ts,tsx,mts,cts}']}
  - {id: t3, regex: '<\s*any\s*>',                 glob: ['**/*.{ts,mts,cts}']}
astgrep: ['astgrep/type-01-as-any.yml']   # optional; paths relative to catalog/
downgrade_in: {tests: advisory}
primary_over: []               # seams: rules this one wins against on the same location
sources: ['CAT Pattern 1', 'STM §2']
---
## What
`;

const RUN = {
  schema: 'ts-optimize/run@1', id: '2026-10-19T1432Z-a1b2', plugin_version: '0.1.0', state: 'planned', mode: 'standard',
  created: '2026-10-19T14:32:11Z',
  repo: { root: '/abs/path', git: true, head: 'ab12…', branch: 'main', dirty: false, default_branch: 'main' },
  env: {
    node: '22.11.0', os: 'darwin-arm64',
    pm: { name: 'pnpm', version: '9.12.0', source: 'packageManager' },
    packages: [{ path: '.', name: 'root' }, { path: 'apps/web', name: 'web' }],
    compilers: {
      authoritative: { bin: 'node_modules/.bin/tsc', version: '5.9.3', kind: 'js' },
      fast: { bin: 'node_modules/.bin/tsgo', version: '7.0.0-dev.20260930', kind: 'native-preview' },
      api_provider: { version: '5.9.3' },
    },
    engines: {
      knip: { version: '6.41.0', source: 'project', works: true },
      'type-coverage': { version: '2.30.1', source: 'toolbox', works: true },
      'ast-grep': { version: null, source: null, works: false, reason: 'not installed' },
      lint: { engine: 'biome', version: '2.1.0' },
    },
    packs: ['workerd'], frameworks: ['next', 'vitest'],
  },
  scope: { workspaces: ['apps/web'], include: [], exclude: ['**/generated/**'], diff_base: null },
  domains: {
    run: ['platform', 'reachability', 'types', 'slop', 'structure'],
    degraded: [{ domain: 'reachability', part: 'cycles', reason: 'madge unusable under TS 7; using knip --cycles' }],
    skipped: [{ domain: 'toolchain', reason: 'not requested' }],
  },
  gate: {
    legs: [
      { id: 'typecheck', cmd: ['node_modules/.bin/tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], cwd: '.', timeout_s: 600, variant: 'noemit' },
      { id: 'test', cmd: ['pnpm', 'run', 'test'], cwd: '.', timeout_s: 1800, ci_env: { CI: '1' } },
      { id: 'build', cmd: ['pnpm', 'run', 'build'], cwd: '.', timeout_s: 1800 },
    ],
    unavailable: [{ id: 'declaration-emit', reason: 'no declaration/composite/types signal' }],
    baseline_status: 'green', red_baseline: null, accepted_risk: null,
  },
  fast_check: { enabled: true, engine: 'tsgo', baseline_ms: 2100, disabled_reason: null, divergences: 0 },
  waves: [{ id: '1', findings: 12, status: 'pending', tag: null, gate: null }],
  approvals: null, applying: null,
  timings_s: { scan: 41.2, triage: 188.0 },
  commands: [{ at: '2026-10-19T14:32:20Z', cmd: '…', exit: 0 }],
};

const INDEX = {
  schema: 'ts-optimize/findings-index@1', run: '2026-10-19T1432Z-a1b2', generated: '2026-10-19T14:41:09Z',
  counts: { total: 212, by_state: { open: 190, suppressed: 22 }, by_severity: { hard: 4, warn: 130, advisory: 78 } },
  findings: [{
    id: 'F-0007', fingerprint: 'sha1:9c1e…', rule: 'reach-04', domain: 'reachability', wave: '3', severity: 'warn',
    fix_risk: 'low', fix_mode: 'auto', verdict: 'confirmed', state: 'approved', package: 'apps/web', file: 'src/a.ts', line: 12, depends_on: [],
  }],
};

const LOCK = { schema: 'ts-optimize/plan-lock@1', run: '2026-10-19T1432Z-a1b2', approved: ['F-0002', 'F-0007'], plan_sha256: 'a3f1c0', locked_at: '2026-10-19T14:50:00Z', amendments: [] };

const CONFIG = {
  schema: 'ts-optimize/config@1',
  scope: { include: ['packages/*/src/**'], exclude: ['**/generated/**', 'vendor/**'] },
  protected: ['src/public-api.ts', 'src/**/*.d.ts'],
  gate: { typecheck: 'auto', test: 'pnpm run test:unit', build: 'auto', timeout_s: { typecheck: 600, test: 1800, build: 1800 }, scope: 'full' },
  thresholds: { cyclomatic: 10, cognitive: 15, function_loc: 60, nesting: 3, params: 4, max_findings_per_domain: 400 },
  commit: { granularity: 'finding', batch_max: 25, no_verify: false, branch_prefix: 'chore/ts-cleanup', artifacts: true },
  hooks: { enabled: true, fast_check: true },
  network: { npx: 'ask', toolbox: 'ask' },
  keep_runs: 5,
};

const SUPP = {
  schema: 'ts-optimize/suppressions@1',
  entries: [{
    id: 'S-001', fingerprint: 'sha1:77aa…', rule: 'reach-01', file: 'worker-configuration.d.ts',
    reason: 'ambient declarations generated by `wrangler types`; no imports/exports by design',
    evidence: ['tsconfig.json#compilerOptions.types includes it'], by: 'ts-triager', confirmed_by_user: true,
    date: '2026-10-19', expires: null, codified_in: 'knip.jsonc#ignore',
  }],
};

const BASE = {
  schema: 'ts-optimize/baseline@1', captured: '2026-10-19T14:50:00Z', head: 'ab12…',
  roots: { '.': {
    typecheck: { engine: 'tsc@5.9.3', errors: 0, diag_hash: 'sha1:…', ms: 21300 },
    declaration_emit: { status: 'pass' },
    type_soundness: { metric: 'type-coverage@2.30.1', value: 95.45, detail_hash: 'sha1:…' },
    escape_hatch: { metric: 'escape-hatch@1', as_any: 41, as_unknown_as: 9, colon_any: 63, ts_ignore: 5, ts_expect_error: 12, non_null_chain: 7 },
    cycles: { engine: 'knip@6.41.0', count: 4, ids: ['sha1:…'] },
    knip: { files: 31, exports: 212, types: 40, dependencies: 6 },
  } },
  tests: { cmd: 'pnpm run test', exit: 0, collected: 1240, ms: 301000 },
  build: { cmd: 'pnpm run build', exit: 0, ms: 188000 },
};

const CAND = JSON.parse(`{"schema":"ts-optimize/candidate@1","id":"c-0142","rule":"reach-04","domain":"reachability","engine":"knip@6.41.0:exports","package":"apps/web","file":"src/a.ts","line":12,"col":14,"symbol":"formatTimestamp","grain":"symbol","snippet":"export const formatTimestamp = (t: number) => …","raw_ref":"raw/knip.json#/issues/17/exports/0","severity_hint":"warn","batch":5,"wave":"3","fix_mode_hint":"auto","consumers":[],"triage":"agent"}`);
const CHUNK = JSON.parse(`{"schema":"ts-optimize/chunk@1","id":"C03","run":"2026-10-19T1432Z-a1b2","domain":"reachability","package":"apps/web",
 "candidates":["c-0141","c-0142"],
 "context":{"packs":["next"],"protected":["src/public-api.ts"],"entry_conventions":["app/**/route.ts"],"rule_notes":{"reach-04":"Strip export only after the declaration-emit pre-check."}},
 "protocol":"skills/audit/references/triage-protocol.md"}`);
const VERD = JSON.parse(`{"schema":"ts-optimize/verdict@1","candidate":"c-0142","verdict":"confirmed","confidence":"certain","q1":"no","q2":"no","q3":"no","evidence":["rg -w formatTimestamp --glob '!src/a.ts' → 0 hits"],"reason":"Defined and used only in src/a.ts","touches":["src/a.ts"],"depends_on":[],"recommendation":null,"codify":null}`);
const PROP = { schema: 'ts-optimize/proposal@1', origin: 'architect', rule: 'struct-03', file: 'src/x.ts', line: 12, recommendation: 'STRONG', deletion_test: 'x', seam_test: 'y', touches: ['src/x.ts'], plan_step: 'z' };
const PROP_FIXER = { schema: 'ts-optimize/proposal@1', origin: 'fixer', parent: 'F-0007', reason: 'consumer needs an import change', touches: ['src/c.ts'] };
const ENV = { ok: true, schema: 'ts-optimize/envelope@1', result: { a: 1 }, warnings: [], next_actions: [{ cmd: 'ts-opt plan lock', why: 'approve' }], error: null };
const ENV_ERR = { ok: false, schema: 'ts-optimize/envelope@1', result: null, warnings: ['w'], next_actions: [], error: { code: 8, name: 'artifact', message: 'bad', hint: null } };
const FIT = {
  schema: 'ts-optimize/fit@1', verdict: 'ready-with-bridge',
  packages: [{ path: '.', authoritative: { bin: 'tsc', version: '5.9.3' }, fast: { bin: 'tsgo', version: '7.0.0' }, ms: { auth: 21000, fast: 2100, fast_single: 6000 }, diag_equal: true, only_authoritative: [], only_native: [], removed_options: [{ option: 'baseUrl', file: 'tsconfig.json', line: 4 }], blockers: [{ rule: 'tc-01', detail: 'baseUrl removed' }] }],
  ecosystem: [{ tool: 'madge', status: 'unusable', remedy: 'use knip --cycles' }], ci: [], cannot_probe_reason: null,
};
const LOGS = [
  '{"t":"2026-10-19T15:01:02Z","ev":"wave-begin","wave":"3","tag":"ts-optimize/2026-10-19T1432Z-a1b2/wave-3-start"}',
  '{"t":"2026-10-19T15:01:03Z","ev":"finding-begin","id":"F-0007"}',
  '{"t":"2026-10-19T15:01:04Z","ev":"check","id":"F-0007","result":"pass","engine":"native-preview 7.0.0-dev","ms":1840,"new_errors":0}',
  '{"t":"2026-10-19T15:01:05Z","ev":"commit","id":"F-0007","sha":"ab12cd3","files":["src/a.ts"],"fingerprint":"wt:5f3…"}',
  '{"t":"2026-10-19T15:02:00Z","ev":"gate","wave":"3","legs":{"typecheck":"pass","test":"pass","build":"pass","declaration-emit":"pass"},"ms":412000}',
  '{"t":"2026-10-19T15:03:00Z","ev":"revert","id":"F-0011","reason":"wave gate: build failed after F-0011 (bisect)","sha":"de45f67"}',
].map((l) => JSON.parse(l));

const finding = splitFrontMatter(FINDING_MD).data;
const plan = splitFrontMatter(PLAN_MD).data;
const rule = splitFrontMatter(RULE_MD).data;

const higher = (v, kind) => { const c = clone(v); c.schema = `ts-optimize/${kind}@2`; return c; };
const mut = (v, fn) => { const c = clone(v); fn(c); return c; };

// kind -> { valid: [docs], invalid: { name: doc } }
const CASES = {
  candidate: { valid: [CAND], invalid: {
    'missing rule': mut(CAND, (c) => { delete c.rule; }), 'bad domain enum': mut(CAND, (c) => { c.domain = 'nope'; }),
    'line is string': mut(CAND, (c) => { c.line = '12'; }), 'higher schema': higher(CAND, 'candidate'),
  } },
  chunk: { valid: [CHUNK], invalid: {
    'missing candidates': mut(CHUNK, (c) => { delete c.candidates; }), 'bad chunk id': mut(CHUNK, (c) => { c.id = 'X3'; }),
    'candidates not array': mut(CHUNK, (c) => { c.candidates = 'c-1'; }), 'higher schema': higher(CHUNK, 'chunk'),
  } },
  verdict: { valid: [VERD], invalid: {
    'missing candidate': mut(VERD, (c) => { delete c.candidate; }), 'bad verdict enum': mut(VERD, (c) => { c.verdict = 'candidate'; }),
    'evidence wrong type': mut(VERD, (c) => { c.evidence = 'rg'; }), 'too many evidence': mut(VERD, (c) => { c.evidence = Array(9).fill('x'); }),
    'higher schema': higher(VERD, 'verdict'),
  } },
  proposal: { valid: [PROP, PROP_FIXER], invalid: {
    'missing origin': mut(PROP, (c) => { delete c.origin; }), 'bad origin': mut(PROP, (c) => { c.origin = 'user'; }),
    'bad recommendation': mut(PROP, (c) => { c.recommendation = 'MAYBE'; }), 'higher schema': higher(PROP, 'proposal'),
  } },
  rule: { valid: [rule], invalid: {
    'missing grain': mut(rule, (c) => { delete c.grain; }), 'bad triage enum': mut(rule, (c) => { c.triage = 'ai'; }),
    'version string': mut(rule, (c) => { c.version = '1'; }), 'higher schema': higher(rule, 'rule'),
  } },
  finding: { valid: [finding], invalid: {
    'missing fingerprint': mut(finding, (c) => { delete c.fingerprint; }), 'bad severity': mut(finding, (c) => { c.severity = 'critical'; }),
    'bad state': mut(finding, (c) => { c.state = 'done'; }), 'wave not a string': mut(finding, (c) => { c.wave = 3; }),
    'location.file missing': mut(finding, (c) => { delete c.location.file; }), 'higher schema': higher(finding, 'finding'),
  } },
  'findings-index': { valid: [INDEX], invalid: {
    'missing findings': mut(INDEX, (c) => { delete c.findings; }), 'bad entry state': mut(INDEX, (c) => { c.findings[0].state = 'x'; }),
    'total is string': mut(INDEX, (c) => { c.counts.total = '212'; }), 'higher schema': higher(INDEX, 'findings-index'),
  } },
  run: { valid: [RUN, mut(RUN, (c) => { c.state = 'aborted'; c.abort_reason = 'superseded'; }),
    // a folder with a tsconfig.json but no package.json is a package without a name (found on a public repo: nodewarden/webapp)
    mut(RUN, (c) => { c.env.packages.push({ path: 'webapp', name: null }); })], invalid: {
    'missing state': mut(RUN, (c) => { delete c.state; }), 'bad state': mut(RUN, (c) => { c.state = 'running'; }),
    'repo.git string': mut(RUN, (c) => { c.repo.git = 'yes'; }), 'bad wave status': mut(RUN, (c) => { c.waves[0].status = 'done'; }),
    'higher schema': higher(RUN, 'run'),
  } },
  plan: { valid: [plan], invalid: {
    'missing run': mut(plan, (c) => { delete c.run; }), 'bad mode': mut(plan, (c) => { c.mode = 'fast'; }),
    'estimate string': mut(plan, (c) => { c.gate_estimate_min = 'x'; }), 'higher schema': higher(plan, 'plan'),
  } },
  'plan-lock': { valid: [LOCK], invalid: {
    'missing approved': mut(LOCK, (c) => { delete c.approved; }), 'bad id in approved': mut(LOCK, (c) => { c.approved = ['X-1']; }),
    'amendments object': mut(LOCK, (c) => { c.amendments = {}; }), 'higher schema': higher(LOCK, 'plan-lock'),
  } },
  baseline: { valid: [BASE], invalid: {
    'missing roots': mut(BASE, (c) => { delete c.roots; }), 'errors string': mut(BASE, (c) => { c.roots['.'].typecheck.errors = '0'; }),
    'negative errors': mut(BASE, (c) => { c.roots['.'].typecheck.errors = -1; }), 'higher schema': higher(BASE, 'baseline'),
  } },
  suppressions: { valid: [SUPP, { schema: 'ts-optimize/suppressions@1', entries: [] }], invalid: {
    'missing entries': mut(SUPP, (c) => { delete c.entries; }), 'entry missing reason': mut(SUPP, (c) => { delete c.entries[0].reason; }),
    'confirmed_by_user string': mut(SUPP, (c) => { c.entries[0].confirmed_by_user = 'true'; }), 'higher schema': higher(SUPP, 'suppressions'),
  } },
  config: { valid: [CONFIG, { schema: 'ts-optimize/config@1', unknown_key: 1 }], invalid: {
    'missing schema': mut(CONFIG, (c) => { delete c.schema; }), 'bad granularity': mut(CONFIG, (c) => { c.commit.granularity = 'bulk'; }),
    'bad network value': mut(CONFIG, (c) => { c.network.npx = 'yes'; }), 'typecheck wrong shape': mut(CONFIG, (c) => { c.gate.typecheck = 'tsconfig.json'; }),
    'higher schema': higher(CONFIG, 'config'),
  } },
  envelope: { valid: [ENV, ENV_ERR], invalid: {
    'missing ok': mut(ENV, (c) => { delete c.ok; }), 'ok string': mut(ENV, (c) => { c.ok = 'true'; }),
    'error without code': mut(ENV_ERR, (c) => { delete c.error.code; }), 'warnings not array': mut(ENV, (c) => { c.warnings = 'w'; }),
    'higher schema': higher(ENV, 'envelope'),
  } },
  fit: { valid: [FIT, { schema: 'ts-optimize/fit@1', verdict: 'cannot-probe', packages: [], cannot_probe_reason: 'no native compiler' }], invalid: {
    'missing verdict': mut(FIT, (c) => { delete c.verdict; }), 'bad verdict': mut(FIT, (c) => { c.verdict = 'maybe'; }),
    'packages not array': mut(FIT, (c) => { c.packages = {}; }), 'package missing path': mut(FIT, (c) => { delete c.packages[0].path; }),
    'higher schema': higher(FIT, 'fit'),
  } },
  'log-event': { valid: LOGS, invalid: {
    'missing ev': mut(LOGS[0], (c) => { delete c.ev; }), 'unknown ev': mut(LOGS[0], (c) => { c.ev = 'explode'; }),
    'ms string': mut(LOGS[2], (c) => { c.ms = '1840'; }), 'files not array': mut(LOGS[3], (c) => { c.files = 'src/a.ts'; }),
    'higher schema': { ...LOGS[0], schema: 'ts-optimize/log-event@2' },
  } },
};

test('16 schema files exist and are well-formed JSON', () => {
  assert.equal(KINDS.length, 16);
  for (const kind of KINDS) {
    const f = path.join(ROOT, 'schemas', `${kind}.schema.json`);
    assert.ok(existsSync(f), `${f} missing`);
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(parsed.type, 'object');
    assert.equal(loadSchema(kind), loadSchema(kind), 'cached');
    assert.equal(SUPPORTED[kind], 1);
  }
});

test('every kind has test cases', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...KINDS].sort());
});

test('spec example front matter parsed as expected', () => {
  assert.equal(finding.wave, '3');
  assert.equal(finding.id, 'F-0007');
  assert.equal(rule.id, 'type-01');
  assert.equal(plan.mode, 'standard');
});

for (const [kind, c] of Object.entries(CASES)) {
  test(`${kind}: valid documents validate`, () => {
    c.valid.forEach((doc, i) => {
      const r = validate(kind, doc);
      assert.deepEqual(r.errors, [], `valid doc #${i}`);
      assert.equal(r.ok, true);
    });
  });
  test(`${kind}: invalid mutations are rejected`, () => {
    assert.ok(Object.keys(c.invalid).length >= 3);
    for (const [name, doc] of Object.entries(c.invalid)) {
      const r = validate(kind, doc);
      assert.equal(r.ok, false, `${kind}: "${name}" should be invalid`);
      assert.ok(r.errors.length > 0 && typeof r.errors[0].path === 'string' && typeof r.errors[0].message === 'string');
    }
  });
}

test('error paths point at the offending location', () => {
  const r = validate('finding', mut(finding, (c) => { c.location.line = 'x'; }));
  assert.ok(r.errors.some((e) => e.path === '/location/line'), JSON.stringify(r.errors));
  const r2 = validate('finding', mut(finding, (c) => { c.touches = [1]; }));
  assert.ok(r2.errors.some((e) => e.path === '/touches/0'));
});

test('errors are collected and capped at 50', () => {
  const r = validate('config', { schema: 'ts-optimize/config@1', protected: Array(200).fill(1) });
  assert.equal(r.errors.length, 50);
  const r2 = validate('finding', {});
  assert.ok(r2.errors.length > 5);
});

test('unknown kind throws', () => {
  assert.throws(() => validate('nope', {}));
  assert.throws(() => loadSchema('nope'));
});

test('checkSchemaId', () => {
  assert.deepEqual(checkSchemaId({ schema: 'ts-optimize/finding@1' }), { ok: true, kind: 'finding', version: 1 });
  assert.deepEqual(checkSchemaId('ts-optimize/run@1'), { ok: true, kind: 'run', version: 1 });
  assert.deepEqual(checkSchemaId({}), { ok: false, reason: 'missing' });
  assert.equal(checkSchemaId({ schema: 'finding@1' }).reason, 'malformed');
  assert.equal(checkSchemaId({ schema: 'ts-optimize/finding' }).reason, 'malformed');
  assert.equal(checkSchemaId({ schema: 5 }).reason, 'malformed');
  const u = checkSchemaId({ schema: 'ts-optimize/bogus@1' });
  assert.equal(u.reason, 'unknown-kind'); assert.equal(u.kind, 'bogus');
  assert.deepEqual(checkSchemaId({ schema: 'ts-optimize/finding@2' }), { ok: false, reason: 'incompatible', kind: 'finding', version: 2, supported: 1 });
  assert.equal(checkSchemaId({ schema: 'ts-optimize/finding@0' }).older, true);
});

test('validator supports $ref, oneOf, anyOf, allOf, bounds', async () => {
  const { validate: v } = await import('../../lib/artifacts/schema.mjs');
  // exercise via config's oneOf (typecheck) and envelope's oneOf (error)
  assert.equal(v('config', { schema: 'ts-optimize/config@1', gate: { typecheck: ['a.json'] } }).ok, true);
  assert.equal(v('config', { schema: 'ts-optimize/config@1', gate: { typecheck: 3 } }).ok, false);
  assert.equal(v('config', { schema: 'ts-optimize/config@1', keep_runs: -1 }).ok, false);
});
