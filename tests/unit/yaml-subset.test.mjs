import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYaml, tryParseYaml, stringifyYaml, splitFrontMatter, trySplitFrontMatter } from '../../lib/core/yaml-subset.mjs';

const corpus = (name) => readFileSync(new URL(`../corpora/${name}`, import.meta.url), 'utf8');

test('block map with scalars', () => {
  assert.deepEqual(parseYaml('a: 1\nb: two\nc: true\nd: ~\ne: null\nf:\n'), { a: 1, b: 'two', c: true, d: null, e: null, f: null });
});
test('numbers: int, negative, float, exponent; leading zeros and versions stay strings', () => {
  assert.deepEqual(parseYaml('a: -3\nb: 1.5\nc: 1e3\nd: 007\ne: 1.2.3\nf: ^5.9.3'), { a: -3, b: 1.5, c: 1000, d: '007', e: '1.2.3', f: '^5.9.3' });
});
test('yes/no/on/off are strings (YAML 1.2)', () => {
  assert.deepEqual(parseYaml('a: yes\nb: no'), { a: 'yes', b: 'no' });
});
test('nested maps', () => {
  assert.deepEqual(parseYaml('a:\n  b:\n    c: 1\n  d: 2\ne: 3'), { a: { b: { c: 1 }, d: 2 }, e: 3 });
});
test('block sequence, indented and same-indent', () => {
  assert.deepEqual(parseYaml('a:\n  - 1\n  - 2\nb:\n- x\n- y\nc: z'), { a: [1, 2], b: ['x', 'y'], c: 'z' });
});
test('sequence of maps', () => {
  const v = parseYaml('items:\n  - name: a\n    n: 1\n  - name: b\n    sub:\n      k: v\n');
  assert.deepEqual(v, { items: [{ name: 'a', n: 1 }, { name: 'b', sub: { k: 'v' } }] });
});
test('nested sequences', () => {
  assert.deepEqual(parseYaml('- - 1\n  - 2\n- - 3'), [[1, 2], [3]]);
  assert.deepEqual(parseYaml('-\n  - 1\n-\n  a: 2'), [[1], { a: 2 }]);
});
test('top-level scalar and empty documents', () => {
  assert.equal(parseYaml('hello'), 'hello');
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('  \n# only a comment\n'), null);
});
test('quoted scalars', () => {
  assert.deepEqual(parseYaml(`a: 'it''s: ok'\nb: "x # y"\nc: "1"\nd: ''\ne: 'true'`), { a: "it's: ok", b: 'x # y', c: '1', d: '', e: 'true' });
});
test('double-quote escapes', () => {
  assert.equal(parseYaml('a: "l1\\nl2\\t\\"q\\" \\\\ \\u00e9 \\u2192"').a, 'l1\nl2\t"q" \\ é →');
});
test('quoted keys', () => {
  assert.deepEqual(parseYaml(`"a: b": 1\n'c d': 2\n"@scope/pkg": 3`), { 'a: b': 1, 'c d': 2, '@scope/pkg': 3 });
});
test('comments: full line, trailing, and inside quotes', () => {
  assert.deepEqual(parseYaml('# top\na: 1 # t\n# mid\nb: "x#y" # t2\nc: a#b\n'), { a: 1, b: 'x#y', c: 'a#b' });
});
test('plain scalars may contain colons not followed by space', () => {
  assert.deepEqual(parseYaml('fp: sha1:9c1e\nurl: https://x.y/z'), { fp: 'sha1:9c1e', url: 'https://x.y/z' });
});
test('flow sequence and map', () => {
  assert.deepEqual(parseYaml('a: [x, 1, "y, z", true, null]\nb: {k: 1, j: v, "q r": [1, 2]}\nc: []\nd: {}'), {
    a: ['x', 1, 'y, z', true, null],
    b: { k: 1, j: 'v', 'q r': [1, 2] },
    c: [],
    d: {},
  });
});
test('flow collections may span lines and carry comments', () => {
  assert.deepEqual(parseYaml('a: [\n  1, # one\n  2,\n]\nb: 3'), { a: [1, 2], b: 3 });
});
test('literal block scalar', () => {
  assert.deepEqual(parseYaml('a: |\n  l1\n  l2\n\n    indented\nb: 1'), { a: 'l1\nl2\n\n  indented\n', b: 1 });
});
test('block scalar chomping', () => {
  assert.equal(parseYaml('a: |-\n  x\n  y\n\n').a, 'x\ny');
  assert.equal(parseYaml('a: |+\n  x\n\n\nb: 1').a, 'x\n\n\n');
});
test('folded block scalar', () => {
  assert.equal(parseYaml('a: >\n  one\n  two\n\n  three\n').a, 'one two\nthree\n');
});
test('block scalar keeps # lines and works in sequences', () => {
  assert.deepEqual(parseYaml('- |\n  # not a comment\n  x\n- y'), ['# not a comment\nx\n', 'y']);
});
test('CRLF and BOM', () => {
  assert.deepEqual(parseYaml('\ufeffa: 1\r\nb:\r\n  - x\r\n  - y\r\n'), { a: 1, b: ['x', 'y'] });
});
test('document start marker', () => {
  assert.deepEqual(parseYaml('---\na: 1\n'), { a: 1 });
  assert.deepEqual(parseYaml('# c\n---\na: 1\n...\n'), { a: 1 });
});
test('unsupported features give clear errors', () => {
  assert.throws(() => parseYaml('a: &x 1\nb: *x'), /anchors/);
  assert.throws(() => parseYaml('a: *x'), /aliases/);
  assert.throws(() => parseYaml('a: !!str 1'), /tags/);
  assert.throws(() => parseYaml('a: 1\n---\nb: 2'), /Multi-document/);
  assert.throws(() => parseYaml('%YAML 1.2\n---\na: 1'), /directives/);
});
test('duplicate keys are an error', () => {
  assert.throws(() => parseYaml('a: 1\na: 2'), /Duplicate key "a"/);
});
test('bad indentation', () => {
  assert.throws(() => parseYaml('a: 1\n  b: 2'), /indent/i);
  assert.throws(() => parseYaml('a:\n    b: 1\n  c: 2'), /indent/i);
  assert.throws(() => parseYaml('  a: 1\nb: 2'), /Unexpected|indent/i);
});
test('tabs as indentation are rejected', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), /Tabs/);
});
test('unterminated quotes and flow collections', () => {
  assert.throws(() => parseYaml('a: "oops'), /Unterminated/);
  assert.throws(() => parseYaml("a: 'oops"), /Unterminated/);
  assert.throws(() => parseYaml('a: [1, 2'), /Unterminated/);
  assert.throws(() => parseYaml('a: {k: 1'), /Unterminated|Expected/);
});
test('unquoted ": " inside a value is an error', () => {
  assert.throws(() => parseYaml('a: b: c'), /Mapping values/);
});
test('bad escapes and trailing junk after quotes', () => {
  assert.throws(() => parseYaml('a: "\\q"'), /escape/i);
  assert.throws(() => parseYaml('a: "\\u12"'), /escape/i);
  assert.throws(() => parseYaml('a: "x" y'), /after quoted/);
});
test('line without key inside a map', () => {
  assert.throws(() => parseYaml('a: 1\njust text'), /Expected "key: value"/);
});
test('__proto__ key is an own property', () => {
  const v = parseYaml('__proto__: 1');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__']);
});
test('tryParseYaml shapes and non-string input', () => {
  assert.deepEqual(tryParseYaml('a: 1'), { ok: true, value: { a: 1 } });
  for (const bad of ['a: [', undefined, null, 4, {}, Buffer.from('a: 1')]) {
    const r = tryParseYaml(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
});
test('corpus: pnpm-workspace.yaml', () => {
  const v = parseYaml(corpus('pnpm-workspace.yaml'));
  assert.deepEqual(v.packages, ['apps/*', 'packages/*', 'tools/**', '!packages/legacy', '!**/__fixtures__/**']);
  assert.equal(v.catalog.typescript, '^5.9.3');
  assert.equal(v.catalog.react, '18.3.1');
  assert.equal(v.catalog['@types/node'], '^22.10.0');
  assert.equal(v.catalog.vitest, '~2.1.0');
  assert.equal(v.catalogs.legacy.react, '^17.0.2');
  assert.deepEqual(v.onlyBuiltDependencies, ['esbuild', 'sharp', '@swc/core']);
  assert.equal(v.overrides['lodash@<4.17.21'], '>=4.17.21');
  assert.equal(v.shamefullyHoist, false);
  assert.equal(v.minimumReleaseAge, 1440);
});
test('corpus: finding front matter follows the quoting rules', () => {
  const { data, body, hasFrontMatter } = splitFrontMatter(corpus('finding.md'));
  assert.equal(hasFrontMatter, true);
  assert.equal(data.schema, 'ts-optimize/finding@1');
  assert.equal(data.id, 'F-0007');
  assert.equal(data.wave, '3');
  assert.equal(data.batch, 5);
  assert.equal(data.recommendation, null);
  assert.equal(data.verified_on, '2026-10-19');
  assert.match(data.fingerprint, /^sha1:9c1e/);
  assert.deepEqual(data.engines, ['knip@6.41.0:exports']);
  assert.deepEqual(data.location, { file: 'src/a.ts', line: 12, symbol: 'formatTimestamp' });
  assert.equal(data.pattern, 'export\\s+(const|function)\\s+\\w+');
  assert.equal(data.triage.framework_lifecycle, 'no');
  assert.deepEqual(data.triage.evidence, ["rg -w formatTimestamp --glob '!src/a.ts' → 0 hits", 'rg "\\[\'formatTimestamp\'\\]" → 0 hits']);
  assert.ok(body.startsWith('\n## What'));
});
test('stringify: deterministic, insertion order, two-space indent', () => {
  const out = stringifyYaml({ b: 1, a: { c: [1, 2], d: [] }, e: [{ x: 1, y: [3] }] });
  assert.equal(out, 'b: 1\na:\n  c:\n    - 1\n    - 2\n  d: []\ne:\n  - x: 1\n    y:\n      - 3\n');
});
test('stringify: keyOrder', () => {
  assert.equal(stringifyYaml({ z: 1, a: 2, m: 3 }, { keyOrder: ['m', 'a'] }), 'm: 3\na: 2\nz: 1\n');
});
test('stringify: quoting rules', () => {
  const out = stringifyYaml({ a: 'x: y', b: 'x #y', c: '123', d: 'true', e: 'null', f: '', g: ' pad', h: '-x', i: '@s', j: 'plain', k: '1.2.3', l: 'a\nb', m: '2026-10-19', n: '~' });
  assert.equal(
    out,
    ['a: "x: y"', 'b: "x #y"', 'c: "123"', 'd: "true"', 'e: "null"', 'f: ""', 'g: " pad"', 'h: "-x"', 'i: "@s"', 'j: plain', 'k: 1.2.3', 'l: "a\\nb"', 'm: 2026-10-19', 'n: "~"', ''].join('\n'),
  );
});
test('stringify: regexKeys are single-quoted', () => {
  const out = stringifyYaml({ pattern: 'a\\s+(b|c)', other: 'a\\s', pats: ["it's \\d"] }, { regexKeys: ['pattern', 'pats'] });
  assert.equal(out, "pattern: 'a\\s+(b|c)'\nother: a\\s\npats:\n  - 'it''s \\d'\n");
});
test('stringify: odd keys are quoted', () => {
  assert.equal(stringifyYaml({ '@scope/pkg': 1, 'a b': 2, 'a:b': 3, ok_key: 4 }), '"@scope/pkg": 1\n"a b": 2\n"a:b": 3\nok_key: 4\n');
});
test('stringify: undefined values are skipped; bad values throw', () => {
  assert.equal(stringifyYaml({ a: undefined, b: 1 }), 'b: 1\n');
  assert.throws(() => stringifyYaml({ a: NaN }), TypeError);
  assert.throws(() => stringifyYaml({ a: () => 1 }), TypeError);
});
test('round-trip property over JSON-like values', () => {
  const samples = [
    {},
    [],
    { a: [] , b: {} },
    'str',
    42,
    null,
    { s: ['x: y', '# c', '', ' ', '1', 'true', '-', '- a', '? q', "it's", 'say "hi"', 'back\\slash', 'multi\nline\n', 'tab\there', 'é→', '[a]', '{b}', '&a', '*a', '!t', '|', '>'] },
    { list: [[1, [2, [3]]], [], {}, [{}], [{ a: [] }]] },
    { nested: { deep: { deeper: { deepest: ['x', { y: null, z: [true, false] }] } } } },
    { 'a b': 1, 'k:': 2, '': 3, '@x/y': 4, '-': 5, '#': 6, '1': 7, '__proto__': 8 },
    { n: [0, -1, 1.5, 1e21, 1e-7, 12345678901234567890] },
    [{ a: 1, b: [{ c: 2 }] }, 'x', [1]],
  ];
  for (const s of samples) {
    const text = stringifyYaml(s);
    assert.deepEqual(parseYaml(text), s, text);
  }
});
test('round-trip with regexKeys and keyOrder', () => {
  const x = { z: 1, rx: '^src/(a|b)\\.ts$', arr: ['a', { rx: "it's" }] };
  assert.deepEqual(parseYaml(stringifyYaml(x, { regexKeys: ['rx'], keyOrder: ['arr'] })), x);
});
test('round-trip of the parsed corpus', () => {
  const v = parseYaml(corpus('pnpm-workspace.yaml'));
  assert.deepEqual(parseYaml(stringifyYaml(v)), v);
  const { data } = splitFrontMatter(corpus('finding.md'));
  assert.deepEqual(parseYaml(stringifyYaml(data, { regexKeys: ['pattern'] })), data);
});
test('splitFrontMatter basics', () => {
  const r = splitFrontMatter('---\na: 1\n---\nbody\ntext');
  assert.deepEqual(r, { data: { a: 1 }, body: 'body\ntext', hasFrontMatter: true });
});
test('splitFrontMatter without front matter', () => {
  assert.deepEqual(splitFrontMatter('# Title\n---\nx'), { data: {}, body: '# Title\n---\nx', hasFrontMatter: false });
  assert.deepEqual(splitFrontMatter(''), { data: {}, body: '', hasFrontMatter: false });
});
test('splitFrontMatter: CRLF, BOM, empty block, leading --- inside body', () => {
  assert.deepEqual(splitFrontMatter('\ufeff---\r\na: 1\r\n---\r\nb\r\n').data, { a: 1 });
  assert.deepEqual(splitFrontMatter('---\n---\nbody'), { data: {}, body: 'body', hasFrontMatter: true });
  assert.equal(splitFrontMatter('---\na: 1\n---\nx\n---\ny').body, 'x\n---\ny');
});
test('splitFrontMatter errors', () => {
  assert.throws(() => splitFrontMatter('---\na: 1\nbody'), /Unterminated front matter/);
  assert.throws(() => splitFrontMatter('---\n- a\n---\n'), /must be a mapping/);
  assert.throws(() => splitFrontMatter('---\na: [\n---\n'), /Unterminated/);
  assert.throws(() => splitFrontMatter(5), TypeError);
  assert.equal(trySplitFrontMatter('---\na: [\n---\n').ok, false);
  assert.equal(trySplitFrontMatter(null).ok, false);
  assert.equal(trySplitFrontMatter('---\na: 1\n---\n').ok, true);
});
