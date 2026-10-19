// Unit tests for the pure parts of `ts-opt fit` (lib/tsgo/*, lib/engines/fit.mjs) with synthetic inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogJson, loadRules } from '../../lib/catalog/index.mjs';
import { collectOptions, evalDefaultExposure, evalPathsShape, evalRemoved, findBaseUrlImports, resolveChainOptions } from '../../lib/tsgo/config-scan.mjs';
import { classifyAll, classifyDivergence, compareMultisets, multiset, normaliseMessage, parseTsc } from '../../lib/tsgo/diag.mjs';
import { matchEcosystem } from '../../lib/tsgo/ecosystem.mjs';
import { evalReferences, scanCiText, scanEditorSettings } from '../../lib/tsgo/environment.mjs';
import { extractImports } from '../../lib/tsgo/imports.mjs';
import { parseLocated, prop } from '../../lib/tsgo/jsonloc.mjs';
import { loadLatestFit } from '../../lib/tsgo/store.mjs';
import { packageVerdict, projectVerdict } from '../../lib/tsgo/verdict.mjs';
import { candidatesFromFit } from '../../lib/engines/fit.mjs';

const REMOVED = catalogJson('removed-options.json');
const DEFAULTS = catalogJson('defaults-changes.json');
const ECO = catalogJson('ecosystem-compat.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'tsopt-fit-unit-'));

test('catalog data: every entry is dated and carries a verification mark', () => {
  for (const [name, data] of [['removed-options', REMOVED], ['defaults-changes', DEFAULTS], ['ecosystem-compat', ECO]]) {
    assert.ok(data && data.entries.length, name);
    for (const e of data.entries) assert.equal(e.checked_on, '2026-10-20', `${name}:${e.id}`);
  }
  for (const e of REMOVED.entries) { assert.ok(['empirical', 'docs', 'inferred'].includes(e.verified), e.id); assert.match(e.ts7.code, /^TS\d+$/); }
  // doc 08 defect 7: the 5.5 group is attributed to 5.5, and the options the source omitted are present
  for (const id of ['noImplicitUseStrict', 'keyofStringsOnly', 'suppressExcessPropertyErrors', 'suppressImplicitAnyIndexErrors', 'out', 'charset']) assert.equal(REMOVED.entries.find((e) => e.id === id).removed_in, '5.5', id);
  const ids = new Set(REMOVED.entries.map((e) => e.id));
  for (const id of ['downlevelIteration', 'moduleResolution-classic', 'module-systemjs-none', 'alwaysStrict-false']) assert.ok(ids.has(id), id);
});

test('parseLocated: key lines and columns survive comments, trailing commas and a BOM', () => {
  const text = '\uFEFF{\n  // c\n  "compilerOptions": {\n    "a": 1, /* x */\n    "b": [\n      "p",\n    ],\n  },\n}\n';
  const root = parseLocated(text);
  const co = prop(root, 'compilerOptions');
  assert.equal(co.line, 3);
  assert.equal(co.node.props.get('a').line, 4);
  assert.equal(co.node.props.get('b').node.items[0].line, 6);
  assert.equal(parseLocated('{ nope'), null);
});

test('removed options are reported at the line of the chain file that sets them, through extends', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'tsconfig.base.json'), '{\n  // legacy\n  "compilerOptions": {\n    "target": "es5",\n    "baseUrl": "src",\n    "keyofStringsOnly": true\n  }\n}\n');
    writeFileSync(join(dir, 'tsconfig.json'), '{\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": {\n    "target": "ES2022",\n    "downlevelIteration": true,\n    "moduleResolution": "Node"\n  }\n}\n');
    const { options, chain } = resolveChainOptions(join(dir, 'tsconfig.json'), dir);
    assert.equal(chain.length, 2);
    const rel = (f) => f.slice(dir.length + 1);
    const hits = evalRemoved(options, REMOVED, rel);
    const by = Object.fromEntries(hits.map((h) => [h.option, h]));
    assert.equal(by.target, undefined, 'target was overridden in the leaf to ES2022');
    assert.deepEqual([by.baseUrl.file, by.baseUrl.line], ['tsconfig.base.json', 5]);
    assert.deepEqual([by.keyofStringsOnly.file, by.keyofStringsOnly.line, by.keyofStringsOnly.kind, by.keyofStringsOnly.removed_in], ['tsconfig.base.json', 6, 'removed-in-5.5', '5.5']);
    assert.deepEqual([by.downlevelIteration.file, by.downlevelIteration.line], ['tsconfig.json', 5]);
    assert.deepEqual([by.moduleResolution.file, by.moduleResolution.line, by.moduleResolution.code], ['tsconfig.json', 6, 'TS5108'], 'value match is case-insensitive');
    assert.deepEqual(by.baseUrl.rules, ['tc-01', 'tc-02']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('array extends: the later entry wins, and the winner is the file reported', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'a.json'), '{ "compilerOptions": { "target": "es5" } }');
    writeFileSync(join(dir, 'b.json'), '{\n"compilerOptions": {\n"target": "es2020" }\n}');
    writeFileSync(join(dir, 'tsconfig.json'), '{ "extends": ["./b.json", "./a.json"], "compilerOptions": {} }');
    const { options } = resolveChainOptions(join(dir, 'tsconfig.json'), dir);
    assert.deepEqual(evalRemoved(options, REMOVED).map((h) => [h.option, h.file.endsWith('a.json')]), [['target', true]]);
    writeFileSync(join(dir, 'tsconfig.json'), '{ "extends": ["./a.json", "./b.json"] }');
    assert.deepEqual(evalRemoved(resolveChainOptions(join(dir, 'tsconfig.json'), dir).options, REMOVED), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('value-sensitive entries: alwaysStrict false and esModuleInterop false are removed, true is fine; module values', () => {
  const opts = (o) => collectOptions([{ file: 'tsconfig.json', text: JSON.stringify({ compilerOptions: o }, null, 2) }]);
  assert.deepEqual(evalRemoved(opts({ alwaysStrict: true, esModuleInterop: true, module: 'commonjs', target: 'es2017', strict: true }), REMOVED), []);
  const hits = evalRemoved(opts({ alwaysStrict: false, esModuleInterop: false, module: 'AMD', moduleResolution: 'classic', target: 'ES3' }), REMOVED);
  assert.deepEqual(hits.map((h) => h.entry).sort(), ['alwaysStrict-false', 'esModuleInterop-false', 'module-amd-umd-system', 'moduleResolution-classic', 'target-es3'].sort());
  assert.equal(evalRemoved(opts({ module: 'none' }), REMOVED)[0].code, 'TS6046');
});

test('defaults-changes exposure: absent keys are exposed only when the authoritative compiler is below the flip', () => {
  const none = collectOptions([{ file: 't.json', text: '{ "compilerOptions": { "outDir": "dist" } }' }]);
  const ids = (list) => list.filter((e) => e.effective).map((e) => e.id).sort();
  const on5 = evalDefaultExposure(none, DEFAULTS, { authMajor: 5, atTypes: true });
  assert.ok(['strict', 'types', 'module', 'rootDir', 'target'].every((i) => ids(on5).includes(i)), ids(on5).join());
  const on6 = evalDefaultExposure(none, DEFAULTS, { authMajor: 6, atTypes: true });
  assert.ok(!ids(on6).includes('strict') && !ids(on6).includes('types'), 'TS 6 already applied these flips');
  assert.ok(on6.find((e) => e.id === 'strict').already_effective_on_authority);
  const set = collectOptions([{ file: 't.json', text: '{ "compilerOptions": { "strict": true, "types": ["node"], "module": "commonjs", "target": "es2020" } }' }]);
  const ex = ids(evalDefaultExposure(set, DEFAULTS, { authMajor: 5, atTypes: true }));
  for (const i of ['strict', 'types', 'module', 'target']) assert.ok(!ex.includes(i), i + ' is explicit');
  assert.ok(!ex.includes('rootDir'), 'rootDir only matters when something is emitted');
  assert.ok(!ids(evalDefaultExposure(none, DEFAULTS, { authMajor: 5, atTypes: false })).includes('types'), 'no @types packages, no types exposure');
});

test('paths shape and baseUrl-only imports', () => {
  const o = collectOptions([{ file: 'tsconfig.json', text: '{\n"compilerOptions": {\n"baseUrl": ".",\n"paths": {\n"@/*": ["src/*"],\n"~/*": ["./src/*"]\n}\n}\n}' }]);
  const shape = evalPathsShape(o);
  assert.deepEqual(shape.map((s) => [s.key, s.value, s.line]), [['@/*', 'src/*', 5]]);
  const src = [{ file: 'src/cli.ts', text: 'import { a } from "utils/format";\nimport b from "react";\nimport c from "./local";\nimport { d } from "@/x";\nimport e from "lib/thing";\nconst f = require("fs");\n' }];
  const hits = findBaseUrlImports({ sources: src, names: new Set(['utils', 'lib', 'react']), isInstalled: (n) => n === 'react', aliasKeys: ['@/*', 'lib/*'] });
  assert.deepEqual(hits.map((h) => [h.spec, h.line]), [['utils/format', 1]]);
});

test('extractImports: from, side-effect, dynamic and require forms; comment lines skipped', () => {
  const t = "import a from 'x';\nimport 'side';\nconst b = await import(\"dyn\");\nconst c = require('req');\n// import z from 'commented';\nexport * from './re';\nconst s = Array.from('abc');\n";
  assert.deepEqual(extractImports(t).map((i) => [i.spec, i.line]), [['x', 1], ['side', 2], ['dyn', 3], ['req', 4], ['./re', 6]]);
});

test('ecosystem: dependency lines, script lines, imports, version rules, severity by gate leg', () => {
  const pkg = '{\n  "name": "x",\n  "scripts": {\n    "dev": "ts-node src/a.ts",\n    "lint": "eslint ."\n  },\n  "devDependencies": {\n    "knip": "5.88.1",\n    "ts-morph": "28.0.0",\n    "typescript": "5.9.3",\n    "typescript-eslint": "8.72.0",\n    "vite": "7.0.0"\n  }\n}\n';
  const hits = matchEcosystem({
    manifests: [{ file: 'package.json', text: pkg, package: '.' }],
    sources: [{ file: 'scripts/r.ts', text: 'import { Project } from "ts-morph";\nimport ts from "typescript";\n', package: '.' }],
    data: ECO, versionOf: (name) => { assert.ok(name, 'versionOf is never asked about an unnamed dependency'); return null; }, legs: new Set(['lint']),
  });
  const by = Object.fromEntries(hits.map((h) => [h.id, h]));
  assert.deepEqual(by['typescript-eslint'].evidence.map((e) => [e.kind, e.line]), [['dependency', 11]]);
  assert.equal(by['typescript-eslint'].severity, 'hard', 'lint leg exists');
  assert.equal(by['ts-morph'].severity, 'warn', 'ad hoc tool');
  assert.deepEqual(by['ts-morph'].evidence.map((e) => [e.kind, e.file, e.line]), [['dependency', 'package.json', 9], ['import', 'scripts/r.ts', 1]]);
  assert.deepEqual(by['ts-node'].evidence.map((e) => [e.kind, e.line]), [['script', 4]]);
  assert.equal(by['ts-node'].rule, 'tc-05');
  assert.deepEqual(by['typescript-js-api'].evidence.map((e) => [e.file, e.line]), [['scripts/r.ts', 2]], 'importing typescript is a consumer; depending on it is not');
  assert.ok(!hits.some((h) => h.evidence.some((e) => e.kind === 'dependency' && e.snippet.includes('"typescript":'))), 'typescript the compiler is not a consumer');
  assert.equal(by.knip.broken, true, 'Knip 5 breaks');
  assert.equal(matchEcosystem({ manifests: [{ file: 'package.json', text: pkg.replace('5.88.1', '6.42.1'), package: '.' }], data: ECO, legs: new Set() }).find((h) => h.id === 'knip').broken, false);
  assert.equal(by.transpilers.broken, false);
  assert.equal(by.transpilers.rule, null);
});

test('CI scan: NODE_OPTIONS worker flags are advisory, with the source-skill caveat', () => {
  const yml = 'name: ci\nenv:\n  NODE_OPTIONS: --max-old-space-size=4096 --v8-pool-size=4\njobs:\n  a:\n    steps:\n      - run: npx tsc --noEmit\n';
  const f = scanCiText('.github/workflows/ci.yml', yml);
  const no = f.find((x) => x.kind === 'node-options-worker-flag');
  assert.deepEqual([no.line, no.flags, no.severity], [3, ['--v8-pool-size'], 'advisory']);
  assert.match(no.claim, /reported by the source skill; verify in your CI/);
  assert.equal(f.find((x) => x.kind === 'npx-tsc').line, 7);
  assert.deepEqual(scanCiText('ci.yml', 'env:\n  NODE_OPTIONS: --max-old-space-size=4096\n'), [], 'max-old-space-size alone is fine');
  const block = scanCiText('ci.yml', 'env:\n  NODE_OPTIONS: >-\n    --max-old-space-size=4096\n    --max-semi-space-size=64\nother: 1\n');
  assert.deepEqual(block.map((x) => [x.kind, x.line, x.flags]), [['node-options-worker-flag', 4, ['--max-semi-space-size']]]);
  const docker = scanCiText('Dockerfile', 'FROM node:22\nENV NODE_OPTIONS="--v8-pool-size=2 --max-old-space-size=3584"\nENV GOMAXPROCS=2\n');
  assert.deepEqual(docker.map((x) => [x.kind, x.line]), [['node-options-worker-flag', 2], ['gomaxprocs', 3]]);
  assert.equal(docker.find((x) => x.kind === 'gomaxprocs').value, 2);
  assert.deepEqual(scanCiText('docker-compose.yml', 'services:\n  a:\n    cpus: 2\n').map((x) => x.kind), ['cpu-quota-without-gomaxprocs']);
  assert.deepEqual(scanCiText('package.json', '{ "scripts": { "t": "NODE_OPTIONS=--v8-pool-size=4 vitest" } }', { manifest: true }).map((x) => x.kind), ['node-options-worker-flag']);
});

test('editor settings: dangling tsdk, version mismatch, unsupported typescript.native keys', () => {
  const t = '{\n  "typescript.tsdk": "node_modules/typescript/lib",\n  "typescript.native.enabled": true,\n  "js/ts.experimental.useTsgo": true\n}\n';
  const gone = scanEditorSettings('.vscode/settings.json', t, { tsdkInfo: () => ({ exists: false }) });
  assert.deepEqual(gone.map((x) => [x.kind, x.line]), [['tsdk-missing', 2], ['unsupported-key', 3], ['usetsgo-enabled', 4]]);
  const mism = scanEditorSettings('.vscode/settings.json', t, { tsdkInfo: () => ({ exists: true, version: '5.9.3' }), workspaceVersion: '7.0.2' });
  assert.equal(mism[0].kind, 'tsdk-version-mismatch');
  assert.equal(scanEditorSettings('s.json', '{ "editor.tabSize": 2 }')[0].kind, 'no-workspace-tsdk-prompt');
});

test('project references readiness', () => {
  const cfg = (extra) => ({ file: 'tsconfig.json', class: 'project', references: [], signals: {}, ...extra });
  const mk = (path, extra = {}, deps = []) => ({ path, kind: 'node', tsconfigs: [cfg(extra)], workspace_deps: deps });
  assert.equal(evalReferences([mk('.')]).applicable, false, 'single package');
  const a = evalReferences([mk('packages/a'), mk('packages/b', {}, ['packages/a'])]);
  assert.equal(a.pattern, 'unstructured');
  const sol = { file: 'tsconfig.json', class: 'solution', references: ['packages/a', 'packages/b'], signals: {} };
  const b = evalReferences([{ path: '.', kind: 'node', tsconfigs: [sol], workspace_deps: [], workspace_root: true }, mk('packages/a', { signals: { composite: true, outDir: 'dist', rootDir: 'src' } }), mk('packages/b', { signals: {} }, ['packages/a'])]);
  assert.equal(b.pattern, 'B');
  assert.deepEqual(b.missing.map((m) => [m.kind, m.package]), [['no-composite', 'packages/b']]);
});

test('diagnostics: parse, normalise and compare as multisets (counts matter)', () => {
  const out = "src/a.ts(3,5): error TS2322: Type 'x' is not assignable\n  to 'y'.\nerror TS5110: Option 'module' must be set\ntsconfig.json(3,15): error TS5108: Option 'target=ES5' has been removed.\n";
  const d = parseTsc(out);
  assert.deepEqual(d.map((x) => [x.file, x.code]), [['src/a.ts', 'TS2322'], ['tsconfig.json', 'TS5108'], ['', 'TS5110']]);
  assert.match(d[0].message, /not assignable to 'y'/);
  assert.equal(normaliseMessage("File '/repo/src/a.ts' (3,5) missing   here", ['/repo']), "File 'src/a.ts' missing here");
  const A = multiset([{ file: 'a.ts', code: 'TS1', message: 'm', line: 1 }, { file: 'a.ts', code: 'TS1', message: 'm', line: 9 }, { file: 'b.ts', code: 'TS2', message: 'n', line: 1 }]);
  const B = multiset([{ file: 'a.ts', code: 'TS1', message: 'm', line: 4 }, { file: 'b.ts', code: 'TS2', message: 'n', line: 1 }, { file: 'c.ts', code: 'TS3', message: 'o', line: 1 }]);
  const cmp = compareMultisets(A, B);
  assert.equal(cmp.equal, false);
  assert.deepEqual(cmp.only_a.map((x) => [x.file, x.count]), [['a.ts', 1]], 'one extra TS1 on the left');
  assert.deepEqual(cmp.only_b.map((x) => [x.file, x.code]), [['c.ts', 'TS3']]);
  assert.equal(compareMultisets(A, A).equal, true);
});

test('known-divergence table', () => {
  const strict = DEFAULTS.entries.filter((e) => e.id === 'strict');
  assert.equal(classifyDivergence({ file: 'tsconfig.json', code: 'TS5108', message: '' }).rule, 'tc-01');
  assert.deepEqual([classifyDivergence({ file: 'src/a.ts', code: 'TS7006', message: '' }, { defaults: strict }).category, classifyDivergence({ file: 'src/a.ts', code: 'TS7006', message: '' }, { defaults: strict }).default], ['default-change', 'strict']);
  assert.equal(classifyDivergence({ file: 'src/a.ts', code: 'TS7006', message: '' }, { defaults: [] }).category, 'unexplained', 'strict is explicit: the default flip cannot explain it');
  assert.equal(classifyDivergence({ file: 'src/a.js', code: 'TS2749', message: '' }).rule, 'tc-09');
  assert.equal(classifyDivergence({ file: 'src/a.ts', code: 'TS2322', message: 'new text' }, { other: [{ file: 'src/a.ts', code: 'TS2322' }] }).category, 'wording');
  const cl = classifyAll({ only_a: [], only_b: [{ file: 'x.ts', code: 'TS9999', message: 'odd', count: 2, line: 1 }] }, []);
  assert.equal(cl.summary.unexplained, 2);
});

test('verdict precedence', () => {
  const v = packageVerdict;
  assert.equal(v({ applicable: false }), 'not-applicable');
  assert.equal(v({ native: true, configIssues: 3, bridgeNeeded: true, canProbe: false }), 'already-native', 'native wins even with tooling hits');
  assert.equal(v({ canProbe: false, configIssues: 3 }), 'cannot-probe', 'cannot probe outranks static findings');
  assert.equal(v({ nativeFailed: true, configIssues: 2 }), 'blocked');
  assert.equal(v({ configIssues: 1, unexplained: 4, bridgeNeeded: true }), 'needs-config', 'config may cause the divergence: fix it first');
  assert.equal(v({ unexplained: 1, bridgeNeeded: true }), 'blocked');
  assert.equal(v({ bridgeNeeded: true }), 'ready-with-bridge');
  assert.equal(v({}), 'ready');
  assert.equal(projectVerdict([]), 'not-applicable');
  assert.equal(projectVerdict(['already-native', 'already-native']), 'already-native');
  assert.equal(projectVerdict(['already-native', 'ready']), 'ready');
  assert.equal(projectVerdict(['ready', 'ready-with-bridge', 'needs-config']), 'needs-config');
  assert.equal(projectVerdict(['needs-config', 'blocked']), 'blocked');
  assert.equal(projectVerdict(['blocked', 'cannot-probe', 'ready']), 'cannot-probe');
  assert.equal(projectVerdict(['not-applicable', 'ready']), 'ready');
});

test('candidatesFromFit: rule ids, file:line, severity and symbols', () => {
  const rules = loadRules();
  const fit = {
    packages: [{
      path: '.', typecheck_set: [{ variant: 'tsc', config: 'tsconfig.json' }],
      removed_options: [{ option: 'baseUrl', value: 'src', entry: 'baseUrl', rules: ['tc-01', 'tc-02'], fix_mode: 'assisted', file: 'tsconfig.json', line: 6, col: 5, code: 'TS5102', message: 'removed', text: '"baseUrl": "src",', configs: ['tsconfig.json', 'tsconfig.app.json'] }],
      paths_issues: [], baseurl_imports: [{ file: 'src/cli.ts', line: 1, col: 32, spec: 'utils/format' }],
      default_exposure: [{ id: 'types', option: 'types', new_default: [], remedy: 'list them', fix_mode: 'assisted', configs: ['tsconfig.json'], attributed: [{ code: 'TS2591', file: 'src/a.ts', line: 4, count: 2 }] }, { id: 'strict', option: 'strict', attributed: [] }],
      only_native: [{ category: 'jsdoc', file: 'src/a.js', line: 3, col: 1, code: 'TS2749', message: 'm', count: 1 }, { category: 'jsdoc', file: 'src/d.ts', line: 3, code: 'TS2344', message: 'm', count: 1 }],
      only_authoritative: [],
    }],
    ecosystem: [
      { id: 'ts-morph', tool: 'ts-morph', rule: 'tc-04', broken: true, severity: 'warn', status_text: 'breaks', remedy: 'alias', package: '.', evidence: [{ kind: 'dependency', file: 'package.json', line: 17, snippet: '"ts-morph": "1"', detail: 'ts-morph@1', key: 'ts-morph' }, { kind: 'import', file: 'scripts/r.ts', line: 1, snippet: 'import', detail: 'ts-morph' }, { kind: 'import', file: 'scripts/r.ts', line: 9, snippet: 'import', detail: 'ts-morph' }] },
      { id: 'vite', tool: 'vite', rule: null, broken: false, evidence: [{ kind: 'dependency', file: 'package.json', line: 3, key: 'vite' }] },
    ],
    ci: [{ kind: 'node-options-worker-flag', file: '.github/workflows/ci.yml', line: 5, flags: ['--v8-pool-size'], snippet: 'NODE_OPTIONS: --v8-pool-size=4', severity: 'advisory', claim: 'reported by the source skill; verify in your CI', package: '.' }],
    editor: [{ kind: 'usetsgo-enabled', severity: 'info', file: '.vscode/settings.json', line: 2 }, { kind: 'tsdk-missing', severity: 'advisory', file: '.vscode/settings.json', line: 3, detail: 'gone', snippet: '' }],
    references: { applicable: false, missing: [] },
  };
  const c = candidatesFromFit(fit, rules, { compilerOptionsLine: () => 2 });
  const at = (rule) => c.filter((x) => x.rule === rule).map((x) => `${x.file}:${x.line}`);
  assert.deepEqual(at('tc-01'), ['tsconfig.json:6']);
  assert.deepEqual(at('tc-02'), ['tsconfig.json:6', 'src/cli.ts:1']);
  assert.deepEqual(at('tc-03'), ['tsconfig.json:2'], 'only the default the probe saw at work');
  assert.deepEqual(at('tc-04'), ['package.json:17', 'scripts/r.ts:1'], 'one per file and symbol; vite is not a hit');
  assert.deepEqual(at('tc-06'), ['.github/workflows/ci.yml:5']);
  assert.equal(c.find((x) => x.rule === 'tc-06').severity_hint, 'advisory');
  assert.match(c.find((x) => x.rule === 'tc-06').snippet, /verify in your CI/);
  assert.deepEqual(at('tc-07'), ['.vscode/settings.json:3']);
  assert.deepEqual(at('tc-09'), ['src/a.js:3'], 'JavaScript files only');
  assert.deepEqual(c.find((x) => x.rule === 'tc-09').consumers, ['src/d.ts']);
  for (const x of c) { assert.ok(x.snippet.length <= 400); assert.equal(x.domain, 'toolchain'); assert.equal(x.triage, 'deterministic'); assert.ok(x.engine.startsWith('fit:')); }
});

test('stored fit result is fresh for one hour, the same HEAD and unchanged config files', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, '.ts-optimize', 'fit', 'latest'), { recursive: true });
    const generated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeFileSync(join(dir, '.ts-optimize', 'fit', 'latest', 'fit.json'), JSON.stringify({ schema: 'ts-optimize/fit@1', generated, head: 'abc1234', verdict: 'ready', packages: [] }));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    const old = new Date(Date.now() - 30 * 60 * 1000); utimesSync(join(dir, 'tsconfig.json'), old, old);
    assert.equal(loadLatestFit(dir, { head: 'abc1234', watch: ['tsconfig.json'] }).fresh, true);
    assert.match(loadLatestFit(dir, { head: 'def5678' }).reason, /HEAD/);
    assert.match(loadLatestFit(dir, { head: 'abc1234', now: Date.now() + 2 * 3600 * 1000 }).reason, /older than one hour/);
    writeFileSync(join(dir, 'tsconfig.json'), '{ "x": 1 }');
    assert.match(loadLatestFit(dir, { head: 'abc1234', watch: ['tsconfig.json'] }).reason, /changed after/);
    assert.equal(loadLatestFit(tmp(), {}).fit, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
