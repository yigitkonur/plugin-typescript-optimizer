import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseToml, tryParseToml } from '../../lib/core/toml-min.mjs';

const corpus = (name) => readFileSync(new URL(`../corpora/${name}`, import.meta.url), 'utf8');

test('basic key/values', () => {
  assert.deepEqual(parseToml('a = 1\nb = "x"\nc = true\nd = false\ne = 1.5'), { a: 1, b: 'x', c: true, d: false, e: 1.5 });
});
test('empty and comment-only input', () => {
  assert.deepEqual(parseToml(''), {});
  assert.deepEqual(parseToml('# c\n\n  # d\n'), {});
});
test('integers: signs, underscores, hex/oct/bin', () => {
  assert.deepEqual(parseToml('a = +1\nb = -2\nc = 1_000\nd = 0xFF\ne = 0o17\nf = 0b101\ng = 0'), { a: 1, b: -2, c: 1000, d: 255, e: 15, f: 5, g: 0 });
});
test('floats, exponents, inf and nan', () => {
  const v = parseToml('a = 3.14\nb = -1e3\nc = 5e-1\nd = inf\ne = -inf\nf = nan\ng = 1_0.5');
  assert.equal(v.a, 3.14);
  assert.equal(v.b, -1000);
  assert.equal(v.c, 0.5);
  assert.equal(v.d, Infinity);
  assert.equal(v.e, -Infinity);
  assert.ok(Number.isNaN(v.f));
  assert.equal(v.g, 10.5);
});
test('basic string escapes', () => {
  assert.equal(parseToml('a = "x\\ty\\n\\"q\\" \\\\ \\u00e9 \\U0001F600"').a, 'x\ty\n"q" \\ é \u{1F600}');
});
test('literal strings take backslashes verbatim', () => {
  assert.equal(parseToml("a = 'C:\\path\\n'").a, 'C:\\path\\n');
});
test('multiline basic strings: leading newline trimmed, line-ending backslash', () => {
  assert.equal(parseToml('a = """\nline1\nline2"""').a, 'line1\nline2');
  assert.equal(parseToml('a = """one \\\n    two"""').a, 'one two');
  assert.equal(parseToml('a = """q ""quoted"" """').a, 'q ""quoted"" ');
});
test('multiline literal strings', () => {
  assert.equal(parseToml("a = '''\nraw \\n\n  text'''").a, 'raw \\n\n  text');
});
test('comments after values and keys with # in strings', () => {
  assert.deepEqual(parseToml('a = "x # y" # trailing\nb = 1#no space'), { a: 'x # y', b: 1 });
});
test('quoted and dotted keys', () => {
  assert.deepEqual(parseToml('"a b" = 1\n\'c.d\' = 2\ne.f.g = 3\n"h".i = 4'), { 'a b': 1, 'c.d': 2, e: { f: { g: 3 } }, h: { i: 4 } });
});
test('tables and nested tables', () => {
  assert.deepEqual(parseToml('[a]\nx = 1\n[a.b]\ny = 2\n[c]\nz = 3'), { a: { x: 1, b: { y: 2 } }, c: { z: 3 } });
});
test('implicit parent tables can be defined later', () => {
  assert.deepEqual(parseToml('[a.b]\nx = 1\n[a]\ny = 2'), { a: { b: { x: 1 }, y: 2 } });
});
test('arrays of tables', () => {
  assert.deepEqual(parseToml('[[m]]\ntag = "v1"\n[[m]]\ntag = "v2"'), { m: [{ tag: 'v1' }, { tag: 'v2' }] });
});
test('subtables of array-of-tables elements attach to the latest element', () => {
  const v = parseToml('[[a]]\nn = 1\n[a.sub]\nk = 1\n[[a]]\nn = 2\n[a.sub]\nk = 2');
  assert.deepEqual(v, { a: [{ n: 1, sub: { k: 1 } }, { n: 2, sub: { k: 2 } }] });
});
test('dotted array-of-tables path', () => {
  const v = parseToml('[[durable_objects.bindings]]\nname = "A"\n[[durable_objects.bindings]]\nname = "B"');
  assert.deepEqual(v.durable_objects.bindings.map((b) => b.name), ['A', 'B']);
});
test('arrays: multi-line, trailing comma, comments, nested, mixed whitespace', () => {
  assert.deepEqual(parseToml('a = [\n  1, # one\n  2,\n]\nb = [[1,2],["x"]]\nc = []\nd = [ "p" , "q" ]'), { a: [1, 2], b: [[1, 2], ['x']], c: [], d: ['p', 'q'] });
});
test('inline tables', () => {
  assert.deepEqual(parseToml('a = { x = 1, y = "z", n = { k = true } }\nb = {}\nc = [{ p = 1 }, { p = 2 }]'), {
    a: { x: 1, y: 'z', n: { k: true } },
    b: {},
    c: [{ p: 1 }, { p: 2 }],
  });
});
test('datetimes are returned as strings', () => {
  const v = parseToml('a = 1979-05-27T07:32:00Z\nb = 1979-05-27\nc = 07:32:00\nd = 1979-05-27 07:32:00-08:00\ne = [1979-05-27, 1979-05-28]');
  assert.deepEqual(v, { a: '1979-05-27T07:32:00Z', b: '1979-05-27', c: '07:32:00', d: '1979-05-27 07:32:00-08:00', e: ['1979-05-27', '1979-05-28'] });
});
test('CRLF and BOM', () => {
  assert.deepEqual(parseToml('\ufeffa = 1\r\n[t]\r\nb = "x"\r\n'), { a: 1, t: { b: 'x' } });
});
test('__proto__ is an ordinary key', () => {
  const v = parseToml('__proto__ = 1');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__']);
});
test('duplicate keys and tables are errors', () => {
  assert.throws(() => parseToml('a = 1\na = 2'), /Duplicate key/);
  assert.throws(() => parseToml('[a]\n[a]'), /more than once/);
  assert.throws(() => parseToml('a.b = 1\na.b = 2'), /Duplicate key/);
});
test('redefining values as tables is an error', () => {
  assert.throws(() => parseToml('a = 1\n[a]'), /not a table/);
  assert.throws(() => parseToml('a = { x = 1 }\n[a.y]'), /inline table|not a table/);
  assert.throws(() => parseToml('a = [1]\n[[a]]'), /array of tables/);
});
test('unterminated strings', () => {
  assert.throws(() => parseToml('a = "oops'), /Unterminated/);
  assert.throws(() => parseToml('a = \'oops'), /Unterminated/);
  assert.throws(() => parseToml('a = """oops'), /Unterminated/);
  assert.throws(() => parseToml("a = '''oops"), /Unterminated/);
  assert.throws(() => parseToml('a = "x\ny"'), /Unterminated/);
});
test('unterminated array, inline table, header', () => {
  assert.throws(() => parseToml('a = [1, 2'), /Unterminated array/);
  assert.throws(() => parseToml('a = { x = 1'), /Expected/);
  assert.throws(() => parseToml('[a'), /Expected/);
  assert.throws(() => parseToml('[[a]'), /Expected/);
});
test('syntax errors', () => {
  assert.throws(() => parseToml('a'), /Expected/);
  assert.throws(() => parseToml('a ='), /Expected a value/);
  assert.throws(() => parseToml('= 1'), /Expected a key/);
  assert.throws(() => parseToml('a = 1 b = 2'), /Unexpected content/);
  assert.throws(() => parseToml('a = hello'), /Invalid value/);
  assert.throws(() => parseToml('a = 01'), /Invalid value/);
  assert.throws(() => parseToml('a = "\\q"'), /Invalid escape/);
  assert.throws(() => parseToml('a = "\\u12"'), /Invalid unicode/);
  assert.throws(() => parseToml('a = { x = 1, }'), /Trailing comma/);
});
test('errors report line and column', () => {
  try {
    parseToml('a = 1\nb = ??');
    assert.fail();
  } catch (e) {
    assert.equal(e.line, 2);
    assert.equal(e.column, 5);
  }
});
test('tryParseToml shapes and non-string input', () => {
  assert.deepEqual(tryParseToml('a = 1'), { ok: true, value: { a: 1 } });
  for (const bad of ['a = ', undefined, null, 3, {}, Buffer.from('a = 1')]) {
    const r = tryParseToml(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
});
test('corpus: wrangler.toml top-level fields', () => {
  const v = parseToml(corpus('wrangler.toml'));
  assert.equal(v.name, 'edge-api');
  assert.equal(v.main, 'src/index.ts');
  assert.equal(v.compatibility_date, '2025-09-01');
  assert.deepEqual(v.compatibility_flags, ['nodejs_compat', 'nodejs_als']);
  assert.equal(v.workers_dev, false);
});
test('corpus: wrangler.toml tables', () => {
  const v = parseToml(corpus('wrangler.toml'));
  assert.deepEqual(v.observability, { enabled: true, head_sampling_rate: 0.1 });
  assert.deepEqual(v.vars, { API_URL: 'https://api.example.com/v1', LOG_LEVEL: 'debug', RETRIES: 3 });
  assert.deepEqual(v.durable_objects.bindings, [
    { name: 'COUNTER', class_name: 'Counter' },
    { name: 'ROOM', class_name: 'Room' },
  ]);
  assert.deepEqual(v.migrations, [
    { tag: 'v1', new_classes: ['Counter'] },
    { tag: 'v2', new_sqlite_classes: ['Room'] },
  ]);
  assert.equal(v.kv_namespaces[0].binding, 'CACHE');
});
test('corpus: wrangler.toml env tables and multiline string', () => {
  const v = parseToml(corpus('wrangler.toml'));
  assert.equal(v.env.production.name, 'edge-api-prod');
  assert.deepEqual(v.env.production.routes, [{ pattern: 'api.example.com/*', zone_name: 'example.com' }]);
  assert.equal(v.env.production.vars.LOG_LEVEL, 'warn');
  assert.equal(v.env.production.vars.BANNER, 'Hello,\n  production world');
});
