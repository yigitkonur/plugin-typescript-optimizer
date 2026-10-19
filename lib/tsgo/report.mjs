// Human report for `ts-opt fit` (tsgo-fit.md) and the one-screen console text. Every number comes from a measurement or a count
// in the fit result; no vendor figures are quoted anywhere (doc 05 §8.3, doc 08 defect 10).

const MEANING = {
  'already-native': 'the project compiler already is the TypeScript 7 native compiler; only the tooling around it needs attention',
  ready: 'configuration and tooling are compatible; the native compiler can replace the project compiler as is',
  'ready-with-bridge': 'configuration is fine, but tools that need the JavaScript compiler API are present (alias scheme or replacement needed)',
  'needs-config': 'configuration changes (assisted or automatic fixes) will clear every blocker found',
  blocked: 'a blocker no listed fix clears: the compilers disagree for a reason fit cannot explain, or the native compiler did not complete',
  'not-applicable': 'no TypeScript package that the native compiler applies to',
  'cannot-probe': 'no native compiler is available, so the two compilers could not be compared; the static findings below still hold',
};

const ms = (v) => (typeof v === 'number' ? `${v} ms` : 'n/a');
const loc = (b) => (b.file ? `${b.file}${b.line ? ':' + b.line : ''}` : '');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const compilerCell = (c) => (c ? `${c.kind}${c.version ? ' ' + c.version : ''}${c.source ? ` (${c.source})` : ''}` : 'none');

export function speedupCell(p) {
  if (p.authoritative?.kind === 'native') return 'n/a (already native)';
  if (!p.speedup) return p.ms?.auth != null && p.ms?.fast == null ? 'not measured (native compiler did not run)' : 'not measured';
  return `${p.speedup.fast_vs_auth}x (${p.ms.auth} ms vs ${p.ms.fast} ms)${p.speedup.comparable ? '' : ' - diagnostics differ, not like for like'}`;
}

export function renderReport(fit) {
  const L = [];
  L.push('# ts-opt fit: native compiler fit report', '');
  L.push(`- generated: ${fit.generated}`, `- root: .`, `- HEAD: ${fit.head ?? 'n/a'}${fit.dirty ? ' (working tree has uncommitted changes)' : ''}`);
  L.push('', `## Verdict: ${fit.verdict}`, '', MEANING[fit.verdict] || '');
  if (fit.cannot_probe_reason) L.push('', `Why it could not be probed: ${fit.cannot_probe_reason}`);

  L.push('', '## Packages', '');
  L.push('| package | project compiler | native compiler | project ms | native ms | native single-threaded ms | speed-up (measured) | verdict |', '|---|---|---|---|---|---|---|---|');
  for (const p of fit.packages) {
    L.push(`| ${esc(p.path)} | ${esc(compilerCell(p.authoritative))} | ${esc(compilerCell(p.fast))} | ${ms(p.ms?.auth)} | ${ms(p.ms?.fast)} | ${ms(p.ms?.fast_single)} | ${esc(speedupCell(p))} | ${p.verdict} |`);
  }
  L.push('', 'Timings are wall-clock `--noEmit` runs on this machine, best of two passes when a pass takes under 20 s; they are not benchmarks and are not quoted from anywhere. The native compiler\'s multi-threading is experimental; the single-threaded column shows what it costs without it.');
  for (const p of fit.packages) {
    if (p.scratch) L.push('', `Note (${p.path}): the native compiler stops at configuration errors without type-checking, so its timing and non-configuration diagnostics above come from a temporary tsconfig that unsets ${Object.keys(p.scratch.overrides[0] || {}).filter((k) => k !== 'rootDir').join(', ') || 'the removed options'}. The unmodified configuration took ${ms(p.scratch.unmodified_ms)} to fail. Project files were not touched.`);
    for (const n of p.notes || []) if (!/^the native compiler stopped at configuration/.test(n)) L.push('', `Note (${p.path}): ${n}`);
  }

  const blockers = fit.packages.flatMap((p) => (p.blockers || []).map((b) => ({ ...b, package: p.path })));
  L.push('', '## Blockers', '');
  if (!blockers.length) L.push('None found.');
  else {
    L.push('| rule | where | package | detail |', '|---|---|---|---|');
    for (const b of blockers) L.push(`| ${b.rule} | ${esc(loc(b))} | ${esc(b.package)} | ${esc(b.detail)} |`);
  }

  const removed = fit.packages.flatMap((p) => (p.removed_options || []).map((r) => ({ ...r, package: p.path })));
  if (removed.length) {
    L.push('', '## Options the native compiler rejects', '', '| where | option | value | native diagnostic | removed in | remedy |', '|---|---|---|---|---|---|');
    for (const r of removed) L.push(`| ${esc(loc(r))} | ${esc(r.option)} | ${esc(JSON.stringify(r.value))} | ${esc(r.code)} | ${esc(r.removed_in)} | ${esc(r.remedy)} |`);
    L.push('', 'Options marked removed in 5.5 already fail on TypeScript 5.5 and later; they were not removed by TypeScript 7.');
  }

  const exposure = fit.packages.flatMap((p) => (p.default_exposure || []).filter((e) => e.effective).map((e) => ({ ...e, package: p.path })));
  if (exposure.length) {
    L.push('', '## Defaults that change for this project', '', 'An option absent from the resolved tsconfig takes the new default. "Seen" means the probe attributed native-only diagnostics to it.', '', '| package | option | now defaults to | seen in the probe |', '|---|---|---|---|');
    for (const e of exposure) L.push(`| ${esc(e.package)} | ${esc(e.option)} | ${esc(JSON.stringify(e.new_default))} | ${(e.attributed || []).length ? (e.attributed || []).reduce((n, x) => n + x.count, 0) + ' diagnostic(s)' : 'no'} |`);
  }

  const eco = (fit.ecosystem || []).filter((h) => h.broken || h.rule);
  L.push('', '## Tooling that needs the JavaScript compiler API', '');
  if (!eco.length) L.push('None found.');
  else {
    L.push('| tool | status on TypeScript 7 | where | rule | severity | remedy |', '|---|---|---|---|---|---|');
    for (const h of eco) {
      const where = h.evidence.slice(0, 3).map((e) => `${e.file}:${e.line}`).join(', ') + (h.evidence_count > 3 ? `, +${h.evidence_count - 3} more` : '');
      L.push(`| ${esc(h.tool)}${h.version ? ' ' + esc(h.version) : ''} | ${esc(h.status_text)} | ${esc(where)} | ${h.rule || '-'} | ${h.severity} | ${esc(h.remedy)} |`);
    }
    L.push('', 'Basis per tool is recorded in `catalog/ecosystem-compat.json` (verified in a source, or inferred and to be re-verified on a fixture).');
  }
  const fine = [...new Set((fit.ecosystem || []).filter((h) => !h.broken && !h.rule).map((h) => h.tool))];
  if (fine.length) L.push('', `Present and fine on TypeScript 7: ${fine.join(', ')}.`);

  L.push('', '## CI and container files', '');
  if (!(fit.ci || []).length) L.push('Nothing found.');
  else for (const c of fit.ci) {
    const claim = c.claim ? ` (${c.claim})` : '';
    const what = { 'node-options-worker-flag': `NODE_OPTIONS contains ${(c.flags || []).join(', ')}`, gomaxprocs: `GOMAXPROCS is set${c.value != null ? ' to ' + c.value : ''}: check it matches the container CPU quota`, 'cpu-quota-without-gomaxprocs': 'a CPU quota is configured and GOMAXPROCS is not set: the Go runtime counts all host CPUs', 'npx-tsc': 'bare `npx tsc` can fetch the obsolete registry package tsc if the compiler is not installed locally', 'tsbuildinfo-committed': 'a *.tsbuildinfo file is committed', 'tsbuildinfo-stale': 'stale *.tsbuildinfo file', 'tsbuildinfo-cache': 'CI caches *.tsbuildinfo' }[c.kind] || c.kind;
    L.push(`- ${c.file}:${c.line} [${c.severity}] ${what}${claim}`);
  }
  if ((fit.editor || []).length) {
    L.push('', '## Editor settings', '');
    for (const e of fit.editor) L.push(`- ${e.file}:${e.line} [${e.severity}] ${e.detail || e.kind}`);
  }
  if (fit.references?.applicable) {
    L.push('', '## Project references', '', `Pattern in use: ${fit.references.pattern}. ${fit.references.missing.length ? 'Missing:' : 'Nothing missing.'}`);
    for (const m of fit.references.missing) L.push(`- ${m.file}: ${m.detail}`);
  }

  const diverge = fit.packages.filter((p) => p.diag_equal === false);
  if (diverge.length) {
    L.push('', '## Diagnostic comparison', '');
    for (const p of diverge) {
      const by = Object.entries(p.divergence?.by_category || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
      L.push(`- ${p.path}: ${p.only_native.length} item(s) only on the native compiler, ${p.only_authoritative.length} only on the project compiler (by cause: ${by}; unexplained: ${p.divergence?.unexplained ?? 0}).`);
      for (const d of [...p.only_native.filter((x) => x.category === 'unexplained'), ...p.only_authoritative.filter((x) => x.category === 'unexplained')].slice(0, 5)) L.push(`  - ${d.file}:${d.line} ${d.code} ${d.message.slice(0, 160)}`);
    }
  }
  L.push('', '## Next action', '');
  if (!fit.next_actions?.length) L.push('None.');
  else for (const a of fit.next_actions) L.push(`- \`${a.cmd}\`: ${a.why}`);
  L.push('');
  return L.join('\n');
}

/** console text: verdict, one line per package, blocker count, next action */
export function renderText(fit, files = null) {
  const L = [`fit verdict: ${fit.verdict}`];
  if (fit.cannot_probe_reason) L.push(`  ${fit.cannot_probe_reason}`);
  for (const p of fit.packages) {
    const t = p.ms?.auth != null ? ` project ${p.ms.auth} ms, native ${p.ms.fast ?? 'n/a'} ms${p.ms.fast_single != null ? ` (single-threaded ${p.ms.fast_single} ms)` : ''}` : '';
    L.push(`  ${p.path.padEnd(18)} ${p.verdict.padEnd(18)} ${compilerCell(p.authoritative)}${t}${p.speedup ? ` -> ${p.speedup.fast_vs_auth}x measured` : ''}`);
  }
  const blockers = fit.packages.reduce((n, p) => n + (p.blockers || []).length, 0);
  L.push(`blockers: ${blockers}; tooling hits: ${(fit.ecosystem || []).filter((h) => h.broken).length}; CI findings: ${(fit.ci || []).length}`);
  if (files) L.push(`report: ${files.report}`);
  for (const a of fit.next_actions || []) L.push(`next: ${a.cmd}`);
  return L.join('\n');
}
