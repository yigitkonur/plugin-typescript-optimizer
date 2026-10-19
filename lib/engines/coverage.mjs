// type-06: type soundness metric. Real `type-coverage` when it works under the project's TypeScript, else the proxy `escape-hatch@1`.
// A ratchet only compares like with like: the metric id is part of every value (doc 04 §8).
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { run as runProc } from '../core/proc.mjs';
import { isFile } from '../core/fs.mjs';
import { tsOptHome } from '../core/home.mjs';
import { toPosix } from '../core/fs.mjs';
import { isGeneratedPath, isTestPath, packageOf } from '../detect/classify.mjs';
import { maskSource } from './mask.mjs';

export const name = 'coverage';
export const handles = (rule) => rule.adapter === 'coverage';
export const available = () => ({ ok: true }); // the proxy always works

const HATCH = {
  as_any: /\bas\s+any\b|<any>\s*[\w(]/g,
  as_unknown_as: /\bas\s+unknown\s+as\b/g,
  colon_any: /:\s*any\b(?!\s*=>)/g,
  non_null_chain: /[\w)\]]!\.[\w$]+[^\n;]*?[\w)\]]!\./g,
};

export async function escapeHatch(root, files) {
  const total = { metric: 'escape-hatch@1', as_any: 0, as_unknown_as: 0, colon_any: 0, ts_ignore: 0, ts_expect_error: 0, non_null_chain: 0 };
  const perFile = new Map();
  for (let i = 0; i < files.length; i += 64) {
    await Promise.all(files.slice(i, i + 64).map(async (f) => {
      if (isGeneratedPath(f) || !/\.[cm]?tsx?$/.test(f) || /\.d\.[cm]?ts$/.test(f)) return;
      let text; try { text = await readFile(join(root, f), 'utf8'); } catch { return; }
      if (text.length > 1024 * 1024) return;
      const { code, comments } = maskSource(text);
      const c = { as_any: (code.match(HATCH.as_any) || []).length, as_unknown_as: (code.match(HATCH.as_unknown_as) || []).length, colon_any: (code.match(HATCH.colon_any) || []).length, non_null_chain: (code.match(HATCH.non_null_chain) || []).length, ts_ignore: (comments.match(/@ts-ignore/g) || []).length, ts_expect_error: (comments.match(/@ts-expect-error/g) || []).length };
      const sum = Object.values(c).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(c)) total[k] += c[k];
      if (sum) perFile.set(f, { ...c, total: sum, test: isTestPath(f) });
    }));
  }
  return { total, perFile };
}

async function typeCoverage(bin, root, pkgDir, timeoutMs) {
  const r = await runProc([bin, '--detail', '--strict', '--ignore-catch', '--ignore-files', '**/generated/**', '--ignore-files', '**/*.d.ts'], { cwd: join(root, pkgDir === '.' ? '' : pkgDir), timeoutMs, maxBytes: 128 * 1024 * 1024 });
  const m = /\((\d+)\s*\/\s*(\d+)\)\s*([\d.]+)%/.exec(r.stdout);
  if (!m) {
    const lines = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
    const why = lines.find((l) => /error|needs|not support|cannot|unsupported|compiler api/i.test(l)) || lines[0] || 'no output';
    return { ok: false, reason: `type-coverage failed (exit ${r.code}): ${why}`.slice(0, 260) };
  }
  const perFile = new Map();
  for (const line of r.stdout.split('\n')) {
    const mm = /^(.+?):(\d+):(\d+): /.exec(line);
    if (!mm) continue;
    const rel = toPosix(relative(root, mm[1]));
    perFile.set(rel, (perFile.get(rel) || 0) + 1);
  }
  return { ok: true, covered: Number(m[1]), total: Number(m[2]), value: Number(m[3]), perFile };
}

export async function run(ctx) {
  const { root, detect: d, rules, scope, config } = ctx;
  const rule = rules.find((r) => r.id === 'type-06');
  const notes = {};
  const hot = [];
  const tc = d.engines['type-coverage'];
  let metric = null;
  const degraded = [];
  const tryBin = async (bin, source) => {
    const results = [];
    const pkgs = d.packages.filter((p) => !p.root_only && p.tsconfigs.some((c) => c.class === 'project'));
    for (const p of pkgs.slice(0, 20)) results.push([p, await typeCoverage(bin, root, p.path, 300_000)]);
    const failed = results.filter(([, r]) => !r.ok);
    if (results.length && !failed.length) {
      const covered = results.reduce((a, [, r]) => a + r.covered, 0); const total = results.reduce((a, [, r]) => a + r.total, 0);
      for (const [, r] of results) for (const [f, n] of r.perFile) hot.push({ file: f, count: n, kind: 'untyped identifiers' });
      return { metric: { metric: `type-coverage@${tc?.version || '?'}`, value: total ? Math.round((covered / total) * 10000) / 100 : 100, covered, total, source } };
    }
    return { reason: failed[0] ? failed[0][1].reason : 'no TypeScript project with a tsconfig' };
  };
  const toolboxTc = join(tsOptHome(), 'toolbox', 'node_modules', '.bin', process.platform === 'win32' ? 'type-coverage.cmd' : 'type-coverage');
  if (tc && tc.works && tc.bin) {
    const r = await tryBin(tc.bin, tc.source);
    if (r.metric) metric = r.metric;
    else if (tc.source !== 'toolbox' && isFile(toolboxTc)) {
      // the project's TypeScript cannot serve type-coverage (e.g. TS 7 has no JS API): retry with the toolbox's private TS 6
      const r2 = await tryBin(toolboxTc, 'toolbox');
      if (r2.metric) { metric = r2.metric; degraded.push({ domain: 'types', part: 'type-coverage', reason: `project type-coverage failed (${r.reason}); ran the toolbox copy with TypeScript 6` }); }
      else degraded.push({ domain: 'types', part: 'type-coverage', reason: `${r.reason}; using proxy metric escape-hatch@1` });
    } else degraded.push({ domain: 'types', part: 'type-coverage', reason: `${r.reason}; using proxy metric escape-hatch@1 (allow the toolbox for a TypeScript 6 copy)` });
  } else degraded.push({ domain: 'types', part: 'type-coverage', reason: tc?.reason && tc.reason !== 'absent' ? `${tc.reason}; using proxy metric escape-hatch@1` : 'type-coverage not found; using proxy metric escape-hatch@1 (allow the toolbox for the real metric)' });

  const proxy = await escapeHatch(root, scope.files);
  if (!metric) {
    metric = { metric: 'escape-hatch@1', ...proxy.total };
    for (const [f, c] of proxy.perFile) hot.push({ file: f, count: c.total, kind: 'escape hatches', detail: c });
  }
  notes.metric = metric; notes.proxy = proxy.total; notes.degraded = degraded;
  const THRESH = 5;
  const cands = hot.filter((h) => h.count >= THRESH).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)).slice(0, 10).map((h) => ({
    rule: 'type-06', domain: 'types', engine: `coverage:${metric.metric}`, package: packageOf(h.file, d.packages), file: h.file, line: 1, col: 1, symbol: null, grain: 'file',
    snippet: `${h.count} ${h.kind} in this file${h.detail ? ' (' + Object.entries(h.detail).filter(([k, v]) => k !== 'total' && k !== 'test' && v).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`,
    raw_ref: `metric:${metric.metric}`, severity_hint: 'advisory', // hotspots are advisory; a regression against the same-metric baseline is hard (fix phase) batch: rule?.batch ?? 8, wave: rule?.wave ?? '4', fix_mode_hint: 'flag-only', consumers: [], triage: 'deterministic', path_class: isTestPath(h.file) ? 'test' : 'source',
  }));
  return { candidates: rule ? cands : [], notes };
}
export { sep };
