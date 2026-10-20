// Toolchain engine (rules tc-01…tc-11, adapters `fit:*`): turns the `ts-opt fit` result into candidates (doc 05 §8.3, doc 06 §2.6).
// The fit result is imported from .ts-optimize/fit/latest when it is under an hour old for the same HEAD, otherwise fit runs here.
// Rules carry `modes: [tsgo]`, so standard and deep scans never reach this engine.
import { join } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { readText } from '../core/fs.mjs';
import { tsOptHome } from '../core/home.mjs';
import { pathClass } from '../detect/classify.mjs';
import { runFit } from '../tsgo/fit.mjs';
import { parseLocated, prop } from '../tsgo/jsonloc.mjs';
import { renderReport } from '../tsgo/report.mjs';
import { loadLatestFit, saveFit } from '../tsgo/store.mjs';

export const name = 'fit';
export const handles = (rule) => String(rule.adapter || '').startsWith('fit:');
export const available = () => ({ ok: true });

const JS_FILE = /\.[cm]?jsx?$/;
const clip = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Pure: fit result + rules -> candidates. `compilerOptionsLine(file)` -> 1-based line of the compilerOptions key (default 1).
 * rules: Map or array of rule objects; only those present are produced.
 */
export function candidatesFromFit(fit, rules, { compilerOptionsLine = () => 1 } = {}) {
  const byId = new Map((Array.isArray(rules) ? rules : [...rules.values()]).map((r) => [r.id, r]));
  const out = [];
  const add = (ruleId, extra) => {
    const rule = byId.get(ruleId);
    if (!rule) return;
    const adapter = String(rule.adapter || '').replace(/^fit:/, '');
    out.push({
      rule: rule.id, domain: rule.domain, engine: `fit:${adapter}`, package: '.', line: 1, col: 1, symbol: null, grain: rule.grain || 'file',
      severity_hint: rule.severity, batch: rule.batch ?? null, wave: rule.wave ?? null, fix_mode_hint: rule.fix_mode, consumers: [], triage: rule.triage || 'deterministic',
      path_class: pathClass(extra.file), ...extra, snippet: clip(extra.snippet),
    });
  };
  const pkgOf = (file, packages) => {
    let best = '.'; let len = -1;
    for (const p of packages) if (p.path !== '.' && (file === p.path || file.startsWith(p.path + '/')) && p.path.length > len) { best = p.path; len = p.path.length; }
    return best;
  };

  for (const p of fit.packages || []) {
    // tc-01 / tc-02: options the native compiler rejects
    for (const r of p.removed_options || []) {
      for (const rule of r.rules || ['tc-01']) {
        add(rule, {
          package: p.path, file: r.file, line: r.line, col: r.col || 1, symbol: r.option, snippet: `${r.text || r.option} -- ${r.code || 'removed'}: ${r.message || ''}`,
          raw_ref: `fit:removed-options:${r.entry}`, fix_mode_hint: r.fix_mode, severity_hint: 'hard', consumers: (r.configs || []).filter((c) => c !== r.file),
        });
      }
    }
    for (const r of p.paths_issues || []) add('tc-02', { package: p.path, file: r.file, line: r.line, col: r.col || 1, symbol: `paths:${r.key}`, snippet: `paths "${r.key}": "${r.value}" is not relative to the tsconfig (it only resolved through baseUrl)`, raw_ref: 'fit:paths-baseurl:paths', severity_hint: 'hard' });
    for (const r of p.baseurl_imports || []) add('tc-02', { package: p.path, file: r.file, line: r.line, col: r.col || 1, symbol: `import:${r.spec}`, snippet: `import of "${r.spec}" resolves only through baseUrl (no installed package of that name)`, raw_ref: 'fit:paths-baseurl:import', severity_hint: 'hard' });

    // tc-03: a flipped default the probe saw at work
    for (const e of p.default_exposure || []) {
      if (!(e.attributed || []).length) continue;
      const file = (e.configs || [])[0] || (p.path === '.' ? 'tsconfig.json' : `${p.path}/tsconfig.json`);
      const n = e.attributed.reduce((s, x) => s + x.count, 0);
      add('tc-03', {
        package: p.path, file, line: compilerOptionsLine(file), symbol: e.id, grain: 'package',
        snippet: `"${e.option}" is not set in the resolved config; it now defaults to ${JSON.stringify(e.new_default)}. ${n} native-only diagnostic(s), e.g. ${e.attributed[0].code} at ${e.attributed[0].file}:${e.attributed[0].line}. ${e.remedy}`,
        raw_ref: `fit:default-changes:${e.id}`, fix_mode_hint: e.fix_mode, consumers: [...new Set(e.attributed.map((x) => x.file))].slice(0, 20),
      });
    }

    // tc-09: native diagnostics in JavaScript files
    const jsd = [...(p.only_native || []).map((d) => ({ ...d, side: 'native' })), ...(p.only_authoritative || []).map((d) => ({ ...d, side: 'authoritative' }))].filter((d) => d.category === 'jsdoc');
    const seenJs = new Set();
    const tsConsumers = [...new Set(jsd.filter((d) => !JS_FILE.test(d.file)).map((d) => d.file))];
    for (const d of jsd) {
      if (!JS_FILE.test(d.file) || seenJs.has(d.file)) continue; // tc-09 reports JavaScript files; TypeScript consumers are listed as consumers
      seenJs.add(d.file);
      add('tc-09', { package: p.path, file: d.file, line: d.line || 1, col: d.col || 1, symbol: 'jsdoc-delta', grain: 'file', snippet: `${d.code} only on the ${d.side} compiler: ${d.message}`, raw_ref: 'fit:jsdoc-semantics', severity_hint: 'warn', consumers: tsConsumers.slice(0, 20) });
    }

    // tc-10: declaration-emit diagnostics only the native compiler reports
    if (p.declaration?.checked) {
      const seen = new Set();
      for (const d of p.declaration.only_native || []) {
        const k = `${d.file}|${d.code}`;
        if (seen.has(k)) continue;
        seen.add(k);
        add('tc-10', { package: p.path, file: d.file, line: d.line || 1, col: d.col || 1, symbol: d.code, grain: 'package', snippet: `${d.code} only on the native compiler during declaration emit: ${d.message}`, raw_ref: 'fit:declaration-parity', severity_hint: 'advisory' });
      }
    }

    // tc-11: differences nothing in the known-divergence table explains
    const unexplained = [...(p.only_native || []).map((d) => ({ ...d, side: 'native' })), ...(p.only_authoritative || []).map((d) => ({ ...d, side: 'project' }))].filter((d) => d.category === 'unexplained' || d.category === 'skiplibcheck-conflict');
    if (unexplained.length) {
      const first = unexplained[0];
      const cfg = ((p.typecheck_set || [])[0] || {}).config || 'tsconfig.json';
      add('tc-11', {
        package: p.path, file: p.path === '.' ? cfg : `${p.path}/${cfg}`, line: 1, symbol: 'parity-drift', grain: 'project',
        snippet: `${unexplained.reduce((n, d) => n + d.count, 0)} diagnostic(s) differ between the compilers and no known divergence explains them. First: ${first.file}:${first.line} ${first.code} (${first.side} only) ${first.message}`,
        raw_ref: 'fit:diagnostic-parity', severity_hint: 'advisory', consumers: [...new Set(unexplained.map((d) => d.file))].slice(0, 20),
      });
    }

    // tc-12: nothing blocks the switch and nothing needs the JavaScript API -> move `typescript` to the native major (T3).
    // With a tc-04 hit for the package the alias scheme (T2) already performs the switch, so tc-12 stays silent.
    const needsBridge = (fit.ecosystem || []).some((h) => h.broken && h.rule === 'tc-04' && (h.package || '.') === p.path);
    const jsCompiler = p.authoritative && p.authoritative.kind === 'js';
    if (jsCompiler && !needsBridge && ['ready', 'needs-config'].includes(p.verdict) && p.declares_typescript) {
      add('tc-12', {
        package: p.path, file: p.declares_typescript.file, line: p.declares_typescript.line, symbol: `typescript:${p.declares_typescript.field}`, grain: 'package',
        snippet: `"typescript": "${p.declares_typescript.range}" resolves to ${p.authoritative.version || 'a JavaScript-compiler release'}; the fit probe found nothing that stops the native compiler (${p.verdict})`,
        raw_ref: 'fit:engine-switch', severity_hint: 'warn', fix_mode_hint: 'assisted',
      });
    }
  }

  // tc-04 / tc-05: tooling that needs the JavaScript compiler API (one candidate per evidence line, deduplicated per file and symbol)
  for (const h of fit.ecosystem || []) {
    if (!h.broken || !h.rule) continue;
    const seen = new Set();
    for (const ev of h.evidence || []) {
      const symbol = `${h.id}:${ev.kind}:${ev.key ?? ev.detail}`;
      const key = `${ev.file}|${symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(h.rule, {
        package: h.package || pkgOf(ev.file, fit.packages || []), file: ev.file, line: ev.line, symbol, grain: 'package',
        snippet: `${h.tool}: ${h.status_text}. ${ev.snippet} -- remedy: ${h.remedy || 'none listed'}`,
        raw_ref: `fit:ecosystem:${h.id}`, severity_hint: h.severity === 'hard' ? 'hard' : 'warn', fix_mode_hint: 'assisted',
        consumers: [...new Set((h.evidence || []).map((e) => e.file).filter((f) => f !== ev.file))].slice(0, 20),
      });
    }
  }

  // tc-06: CI and container files
  for (const c of fit.ci || []) {
    const text = {
      'node-options-worker-flag': `NODE_OPTIONS has ${(c.flags || []).join(', ')}: ${c.claim || 'reported by the source skill; verify in your CI'}. Keep --max-old-space-size for the Node tools. ${c.snippet || ''}`,
      gomaxprocs: `GOMAXPROCS is set${c.value != null ? ' to ' + c.value : ''}: it should equal the container CPU quota. ${c.snippet || ''}`,
      'cpu-quota-without-gomaxprocs': `a CPU quota is configured and GOMAXPROCS is not: the Go-based compiler counts all host CPUs. ${c.snippet || ''}`,
      'npx-tsc': `bare \`npx tsc\` fetches the obsolete registry package when tsc is not installed locally; use the package manager's exec or the direct bin. ${c.snippet || ''}`,
      'tsbuildinfo-committed': 'a *.tsbuildinfo file is committed; stale build info keeps errors for deleted files', 'tsbuildinfo-stale': c.snippet, 'tsbuildinfo-cache': `CI caches *.tsbuildinfo: ${c.snippet || ''}`,
    }[c.kind] || c.kind;
    add('tc-06', {
      package: c.package || '.', file: c.file, line: c.line || 1, symbol: `${c.kind}${c.flags ? ':' + c.flags.join(',') : ''}`, grain: 'project', snippet: text, raw_ref: `fit:ci-container:${c.kind}`,
      severity_hint: c.severity === 'advisory' ? 'advisory' : 'warn',
    });
  }

  // tc-07: editor configuration (informational items stay in fit.json)
  for (const e of fit.editor || []) {
    if (e.severity === 'info') continue;
    add('tc-07', { package: e.package || '.', file: e.file, line: e.line || 1, symbol: e.kind, grain: 'project', snippet: `${e.detail || e.kind}. ${e.snippet || ''}`, raw_ref: `fit:editor-config:${e.kind}`, severity_hint: 'advisory', fix_mode_hint: 'flag-only' });
  }

  // tc-08: project-reference readiness (one candidate for the workspace)
  if (fit.references?.applicable && fit.references.missing.length) {
    const m = fit.references.missing;
    add('tc-08', {
      package: '.', file: m[0].file, line: 1, symbol: `references:${fit.references.pattern}`, grain: 'project',
      snippet: `pattern ${fit.references.pattern}; missing: ${m.slice(0, 5).map((x) => x.detail).join(' | ')}${m.length > 5 ? ` | +${m.length - 5} more` : ''}`,
      raw_ref: 'fit:project-references', severity_hint: 'advisory', consumers: [...new Set(m.map((x) => x.file))].slice(0, 20),
    });
  }
  return out;
}

export async function run(ctx) {
  const { root, detect: d, rules } = ctx;
  const config = ctx.config || loadConfig(root).config;
  const watch = (d.packages || []).flatMap((p) => [...(p.tsconfigs || []).map((c) => (p.path === '.' ? c.file : `${p.path}/${c.file}`)), p.has_package_json ? (p.path === '.' ? 'package.json' : `${p.path}/package.json`) : null]).filter(Boolean);
  const cached = loadLatestFit(root, { head: d.git?.head ?? null, watch });
  let fit = cached.fresh ? cached.fit : null;
  const notes = { fit_source: fit ? 'cache' : 'fresh' };
  if (!fit) {
    fit = await runFit({ root, detect: d, config, home: tsOptHome() });
    try { saveFit(root, fit, renderReport(fit)); } catch { notes.fit_stored = false; }
    if (cached.reason) notes.fit_cache_miss = cached.reason;
  }
  notes.fit_verdict = fit.verdict;
  notes.fit_generated = fit.generated;
  const degraded = [];
  if (fit.verdict === 'cannot-probe') {
    for (const r of rules) if (['tc-03', 'tc-09', 'tc-10', 'tc-11'].includes(r.id)) degraded.push({ domain: r.domain, part: r.id, reason: `needs the native-compiler probe: ${fit.cannot_probe_reason || 'no native compiler available'}` });
  }
  const lineCache = new Map();
  const compilerOptionsLine = (file) => {
    if (lineCache.has(file)) return lineCache.get(file);
    const text = readText(join(root, file));
    const l = text === null ? 1 : prop(parseLocated(text), 'compilerOptions')?.line || 1;
    lineCache.set(file, l);
    return l;
  };
  const candidates = candidatesFromFit(fit, rules, { compilerOptionsLine });
  notes.degraded = degraded;
  return { candidates, notes };
}
