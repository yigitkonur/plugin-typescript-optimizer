// Baseline capture (doc 05 §9 "Red baseline", doc 04 §8). Runs the required legs BEFORE any edit and records what "green" means
// for the rest of the run: per-leg status/ms, the diagnostic multisets (authoritative and fast, kept apart because messages differ),
// type-soundness / Knip / cycle metrics. `.ts-optimize/baseline.json` is written only with save=true and never lowers a floor.
import { join } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { readRun, runDir } from '../artifacts/store.mjs';
import { catalogJson, loadRules } from '../catalog/index.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, mkdirp, readJsonc, writeAtomic } from '../core/fs.mjs';
import { sha1 } from '../core/hash.mjs';
import { run as runProc } from '../core/proc.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { normalizeKnip, knipRoots } from '../engines/knip.mjs';
import * as coverage from '../engines/coverage.mjs';
import { buildImporterIndex } from '../engines/importers.mjs';
import { collectFiles } from '../engines/scope.mjs';
import { diagMultiset, multisetHash } from './fingerprint.mjs';
import { legDiagnostics, legKey, parseCollected, runWithRetry, swapBin, updateRun } from './exec.mjs';

const ORDER = ['typecheck', 'declaration-emit', 'test', 'build'];
const REQUIRED = new Set(ORDER);

export const gateDir = (root, runId) => join(runDir(root, runId), 'apply', 'gate');
export const diagFile = (root, runId) => join(runDir(root, runId), 'raw', 'baseline-diagnostics.json');
export function readBaselineDiagnostics(root, runId) {
  const r = readJsonc(diagFile(root, runId));
  return r.ok ? r.value : null;
}

const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
function addInto(acc, m) { for (const [k, n] of Object.entries(m)) acc[k] = (acc[k] || 0) + n; return acc; }
export function multisetRecord(engine, byLeg, keys) {
  const ms = {};
  for (const k of keys) addInto(ms, byLeg[k] || {});
  return { engine, multiset: ms, hash: multisetHash(ms), count: total(ms), by_leg: byLeg };
}

// ---------------------------------------------------------------------------------------------------------------------
// shared metric helpers (also used by the gate's extra legs)
// ---------------------------------------------------------------------------------------------------------------------
const KNIP_CONFIGS = ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.ts', 'knip.js', 'knip.config.ts', 'knip.config.js'];
function hasKnipConfig(root) {
  if (KNIP_CONFIGS.some((f) => isFile(join(root, f)))) return true;
  const pj = readJsonc(join(root, 'package.json'));
  return !!(pj.ok && pj.value && pj.value.knip);
}

/** Knip issues over the repo ({ok, issues:[{type,file,name,line,cycle?}], reason?, ms}); the same root/config choice as the audit */
export async function knipIssues(root, d, extra, timeoutMs = 600_000) {
  const k = d.engines?.knip;
  if (!k || !k.works || !k.bin) return { ok: false, reason: k && k.reason && k.reason !== 'absent' ? `Knip unusable (${k.reason})` : 'Knip not found' };
  const overlay = join(root, '.ts-optimize', 'knip.config.jsonc');
  const cfgArgs = !hasKnipConfig(root) && isFile(overlay) ? ['--config', overlay] : [];
  const issues = []; let ms = 0;
  for (const rp of knipRoots(root, d)) {
    const cwd = rp === '.' ? root : join(root, rp);
    const r = await runProc([k.bin, '--reporter', 'json', '--no-config-hints', '--no-exit-code', ...(rp === '.' ? cfgArgs : []), ...extra], { cwd, timeoutMs, maxBytes: 128 * 1024 * 1024 });
    ms += r.ms;
    if (r.timedOut) return { ok: false, reason: `Knip timed out after ${timeoutMs / 1000}s` };
    const start = r.stdout.indexOf('{');
    if (start < 0) return { ok: false, reason: `Knip produced no JSON (exit ${r.code})` };
    let json; try { json = JSON.parse(r.stdout.slice(start)); } catch (e) { return { ok: false, reason: `Knip JSON unparsable: ${e.message}` }; }
    for (const i of normalizeKnip(json)) {
      if (rp === '.') issues.push(i);
      else issues.push({ ...i, file: join(rp, i.file).split('\\').join('/'), cycle: i.cycle ? i.cycle.map((e) => ({ ...e, name: join(rp, e.name).split('\\').join('/') })) : undefined });
    }
  }
  return { ok: true, issues, ms, version: k.version || '?' };
}

export function knipCounts(issues) {
  const c = { files: 0, exports: 0, types: 0, dependencies: 0 };
  for (const i of issues) {
    if (i.type === 'files') c.files++;
    else if (i.type === 'exports') c.exports++;
    else if (i.type === 'types') c.types++;
    else if (['dependencies', 'devDependencies', 'optionalPeerDependencies'].includes(i.type)) c.dependencies++;
  }
  return c;
}

/** cycle ids = sha1 of the sorted member files; Knip --cycles when it works, else the importer-index SCCs */
export async function currentCycles(root, d, run) {
  const idOf = (files) => 'sha1:' + sha1([...new Set(files)].sort().join('\n'));
  const k = await knipIssues(root, d, ['--cycles']);
  if (k.ok) {
    const ids = [...new Set(k.issues.filter((i) => i.type === 'cycles').map((i) => idOf(i.cycle.map((e) => e.name))))].sort();
    return { engine: `knip@${k.version}`, count: ids.length, ids };
  }
  try {
    const { config } = loadConfig(root);
    const scope = await collectFiles(root, { isGit: d.git.repo, config, workspacePaths: run?.scope?.workspaces?.length ? run.scope.workspaces : null });
    const idx = await buildImporterIndex({ root, files: scope.all_files, packages: d.packages });
    const ids = idx.cycles().map(idOf).sort();
    return { engine: 'importer-index@1', count: ids.length, ids, reason: k.reason };
  } catch (e) {
    return { engine: null, count: null, ids: null, reason: `${k.reason}; importer index failed: ${e.message}` };
  }
}

/** type-soundness metric (type-coverage when it works, else the escape-hatch proxy) via the audit's coverage engine */
export async function currentTypeMetrics(root, d, run) {
  const { config } = loadConfig(root);
  const scope = await collectFiles(root, { isGit: d.git.repo, config, workspacePaths: run?.scope?.workspaces?.length ? run.scope.workspaces : null });
  const rule = loadRules().get('type-06');
  const out = await coverage.run({ root, detect: d, rules: rule ? [rule] : [], scope, config });
  const m = out.notes.metric; const proxy = out.notes.proxy;
  const hatchTotal = Object.entries(proxy).filter(([k]) => k !== 'metric').reduce((a, [, v]) => a + v, 0);
  const escape_hatch = { ...proxy };
  const type_soundness = m.metric.startsWith('type-coverage')
    ? { metric: m.metric, value: m.value, covered: m.covered, total: m.total, detail_hash: 'sha1:' + sha1(JSON.stringify([m.covered, m.total])) }
    : { metric: m.metric, value: hatchTotal, lower_is_better: true, detail_hash: 'sha1:' + sha1(JSON.stringify(proxy)) };
  return { type_soundness, escape_hatch, degraded: out.notes.degraded || [] };
}

export function wavesCatalog() { return catalogJson('waves.json') || { order: [], waves: [] }; }

/** fix waves whose `needs` are all available (a project without tests can schedule only waves B and 4) */
export function schedulableWaves(available) {
  const cat = wavesCatalog();
  const byId = new Map(cat.waves.map((w) => [w.id, w]));
  return cat.order.filter((id) => id !== 'P' && (byId.get(id)?.needs || []).every((n) => available.has(n)));
}

// ---------------------------------------------------------------------------------------------------------------------
async function version(bin) {
  const r = await runProc([bin, '--version'], { timeoutMs: 10_000 });
  return /Version\s+(\S+)/.exec(r.stdout)?.[1] || null;
}
const ver = (c) => `${c.kind === 'native' || c.kind === 'native-preview' ? c.kind : 'tsc'}@${c.version || '?'}`;

export async function captureBaseline({ root, runId, detect = null, save = false, legs = null, allowRed = [] }) {
  const t0 = Date.now();
  const d = detect || await detectProject(root);
  const run = readRun(root, runId);
  const wanted = legs && legs.length ? new Set(legs) : null;
  const want = (id) => !wanted || wanted.has(id);
  const outDir = gateDir(root, runId);
  const warnings = [];

  const defs = (run.gate?.legs || []).map((l, index) => ({ l, index })).filter(({ l }) => REQUIRED.has(l.id) && want(l.id));
  defs.sort((a, b) => ORDER.indexOf(a.l.id) - ORDER.indexOf(b.l.id));
  const legResults = []; const adoptions = [];
  const byLeg = {};
  const tcKeys = [];
  for (const { l, index } of defs) {
    const r = await runWithRetry(l, { root, wave: 'baseline', outDir });
    if (r.adopted) adoptions.push({ index, adopted: r.adopted });
    const entry = { id: l.id, cwd: l.cwd, status: r.status, ms: r.ms, variant: r.variant ?? l.variant ?? null, exit: r.exit };
    if (r.flaky) entry.flaky = true;
    if (r.reason) entry.reason = r.reason;
    if (r.tail_file) entry.tail_file = r.tail_file;
    if (l.id === 'typecheck' || l.id === 'declaration-emit') {
      const key = legKey({ ...l, cmd: l.cmd });
      if (r.status !== 'unavailable') byLeg[key] = diagMultiset(legDiagnostics(l, r), root);
      if (l.id === 'typecheck' && r.status !== 'unavailable') tcKeys.push(key);
      entry.key = key;
      entry.errors = r.status === 'fail' ? total(byLeg[key] || {}) : 0;
    }
    if (l.id === 'test') {
      const collected = parseCollected(l.runner, r.tail);
      if (collected !== null) entry.collected = collected;
      if (collected === 0) { entry.status = 'unavailable'; entry.reason = 'the test script ran but collected 0 tests'; }
    }
    if (r.status === 'fail') entry.tail = r.tail.slice(-1200);
    legResults.push(entry);
  }
  // legs the project cannot run (from detect): recorded with the reason
  for (const u of run.gate?.unavailable || []) {
    if (!want(u.id)) continue;
    legResults.push({ id: u.id, cwd: null, status: u.id === 'typecheck' || u.id === 'test' ? 'unavailable' : 'not-applicable', ms: 0, reason: u.reason });
  }
  if (!legResults.some((e) => e.id === 'declaration-emit') && want('declaration-emit')) legResults.push({ id: 'declaration-emit', cwd: null, status: 'not-applicable', ms: 0, reason: 'no declaration/composite/types signal' });

  const tcEntries = legResults.filter((e) => e.id === 'typecheck');
  if (want('typecheck') && (!tcEntries.length || tcEntries.every((e) => e.status === 'unavailable'))) {
    throw new TsOptError(EXIT.CAPABILITY, `no typecheck is possible here: ${tcEntries[0]?.reason || 'no typecheck leg detected'}`, 'install TypeScript in the project (npm i -D typescript) or run `ts-opt doctor`');
  }

  // ---- fast compiler baseline (own multiset: messages differ between compilers) -------------------------------------------
  const authLegs = defs.filter(({ l }) => l.id === 'typecheck' && !['script', 'deno'].includes(l.variant));
  const compOf = (l) => d.packages.find((p) => p.path === l.cwd)?.compilers || d.compilers;
  let fast = null; let fastMs = null;
  const primary = compOf(defs.find(({ l }) => l.id === 'typecheck')?.l || {}) || d.compilers;
  const authBin = primary?.authoritative?.bin; const fastBin = primary?.fast?.bin;
  if (want('typecheck') && fastBin && fastBin !== authBin && authLegs.length) {
    const fastByLeg = {}; let ms = 0; let broken = null;
    for (const { l, index } of authLegs) {
      const adopted = adoptions.find((a) => a.index === index)?.adopted;
      const base = adopted ? { ...l, ...adopted } : l;
      const r = await runWithRetry(swapBin(base, fastBin), { root, wave: 'baseline-fast', outDir });
      ms += r.ms;
      if (r.status === 'unavailable') { broken = r.reason; break; }
      fastByLeg[legKey(l)] = diagMultiset(legDiagnostics(l, r), root);
    }
    if (!broken) {
      const v = (await version(fastBin)) || primary.fast.version;
      fast = multisetRecord(`${primary.fast.kind === 'native-preview' ? 'native-preview' : 'native'}@${v || '?'}`, fastByLeg, Object.keys(fastByLeg));
      fast.bin = fastBin; fastMs = ms;
    } else warnings.push(`fast compiler unusable for the baseline (${broken}); \`ts-opt check\` will treat every error as new`);
  }

  const authEngine = primary?.authoritative ? ver(primary.authoritative) : 'tsc@?';
  const authoritative = multisetRecord(authEngine, byLeg, tcKeys);
  const tcMs = legResults.filter((e) => e.id === 'typecheck').reduce((a, e) => a + e.ms, 0);

  // ---- metrics --------------------------------------------------------------------------------------------------------------
  const metrics = {};
  if (want('coverage') || want('metrics') || !wanted) {
    try { Object.assign(metrics, await currentTypeMetrics(root, d, run)); } catch (e) { metrics.type_soundness = null; metrics.type_error = String(e.message); }
  }
  if (want('knip') || want('cycles') || !wanted) {
    const k = await knipIssues(root, d, ['--exclude', 'cycles']);
    metrics.knip = k.ok ? { engine: `knip@${k.version}`, ...knipCounts(k.issues), ms: k.ms } : { unavailable: k.reason };
    metrics.cycles = await currentCycles(root, d, run);
  }

  // ---- statuses, red-baseline policy -------------------------------------------------------------------------------------
  const failing = legResults.filter((e) => e.status === 'fail');
  const redIds = [...new Set(failing.map((e) => e.id))];
  const allowed = new Set(allowRed);
  const testE = legResults.filter((e) => e.id === 'test');
  const noTest = !testE.length || testE.every((e) => e.status === 'unavailable' || e.status === 'not-applicable');
  if (allowed.has('test') && noTest) warnings.push('a missing test suite cannot be unlocked by --allow-red-baseline; only waves B and 4 are schedulable');
  const complete = !wanted;
  const diagHash = authoritative.hash;
  const untrusted = redIds.filter((id) => (id === 'test' || id === 'build') && allowed.has(id));
  const blocked = redIds.filter((id) => !allowed.has(id));
  const baselineStatus = redIds.length ? 'red' : complete ? 'green' : (run.gate?.baseline_status || 'unknown');

  const available = new Set();
  if (legResults.some((e) => e.id === 'typecheck' && e.status !== 'unavailable')) available.add('typecheck');
  if (legResults.some((e) => e.id === 'test' && (e.status === 'pass' || (e.status === 'fail' && !untrusted.includes('test'))))) available.add('test');
  const schedulable = schedulableWaves(available);

  const baseline = { at: nowIso(), head: d.git?.head || null, complete, legs: legResults, metrics, authoritative_engine: authEngine, fast_engine: fast?.engine || null, timings: { typecheck_ms: tcMs, total_ms: Date.now() - t0, fast_ms: fastMs } };
  const fastCheckMs = fastMs ?? (tcMs || null);

  mkdirp(join(runDir(root, runId), 'raw'));
  writeAtomic(diagFile(root, runId), JSON.stringify({ schema: 'ts-optimize/baseline-diagnostics@1', captured: baseline.at, authoritative, fast }, null, 2) + '\n');
  updateRun(root, runId, (r) => {
    for (const a of adoptions) { const cur = r.gate.legs[a.index]; if (cur) { cur.variant = a.adopted.variant; cur.cmd = a.adopted.cmd; if (a.adopted.clean_cmd) cur.clean_cmd = a.adopted.clean_cmd; } }
    r.gate.baseline = baseline;
    r.gate.baseline_status = baselineStatus;
    if (!blocked.length && redIds.length) {
      r.gate.red_baseline = { legs: redIds, diag_hash: diagHash, ...(untrusted.length ? { untrusted } : {}) };
      r.gate.accepted_risk = { by: 'user', at: nowIso(), statement: `--allow-red-baseline ${redIds.join(',')}` };
    } else if (complete && !redIds.length) { r.gate.red_baseline = null; r.gate.accepted_risk = null; }
    if (r.fast_check) {
      r.fast_check.baseline_ms = fastCheckMs;
      if (fastCheckMs > 20_000 && r.fast_check.enabled !== false) { r.fast_check.enabled = false; r.fast_check.disabled_reason = `baseline fast time ${Math.round(fastCheckMs / 1000)} s > 20 s`; }
    }
  });

  if (blocked.length) {
    const e = failing.find((x) => x.id === blocked[0]);
    const first = (authoritative.count && blocked[0] === 'typecheck') ? ` (${authoritative.count} error(s))` : '';
    throw new TsOptError(EXIT.PRECONDITION, `red baseline: leg ${blocked.join(', ')} fails before any edit${first}${e?.tail_file ? `; output: ${e.tail_file}` : ''}`,
      `fix it first, or pass --allow-red-baseline ${blocked.join(',')} only if the user accepts the risk (the leg then passes iff it adds nothing new)`);
  }

  let saved = null;
  if (save) saved = saveBaselineJson(root, { d, run, legResults, authoritative, metrics, warnings, head: d.git?.head || null });

  return {
    status: baselineStatus,
    legs: legResults,
    timings: baseline.timings,
    fast_check_baseline_ms: fastCheckMs,
    authoritative: { engine: authoritative.engine, count: authoritative.count, hash: authoritative.hash },
    fast: fast ? { engine: fast.engine, count: fast.count, hash: fast.hash, ms: fastMs } : null,
    metrics,
    schedulable_waves: schedulable,
    red_baseline: redIds.length ? { legs: redIds, diag_hash: diagHash, untrusted } : null,
    saved,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// .ts-optimize/baseline.json (doc 04 §8). A ratchet compares like with like and never lowers a floor silently.
function saveBaselineJson(root, { run, legResults, authoritative, metrics, warnings, head }) {
  const file = join(root, '.ts-optimize', 'baseline.json');
  const prev = isFile(file) ? readJsonc(file) : null;
  const old = prev && prev.ok ? prev.value : null;
  const roots = {};
  const cwds = [...new Set(legResults.filter((e) => e.id === 'typecheck' && e.cwd).map((e) => e.cwd))];
  for (const cwd of cwds.length ? cwds : ['.']) {
    const tcs = legResults.filter((e) => e.id === 'typecheck' && e.cwd === cwd);
    const dec = legResults.find((e) => e.id === 'declaration-emit' && e.cwd === cwd);
    const entry = {
      typecheck: { engine: authoritative.engine, errors: tcs.reduce((a, e) => a + (e.errors || 0), 0), diag_hash: authoritative.hash, ms: tcs.reduce((a, e) => a + e.ms, 0) },
      ...(dec ? { declaration_emit: { status: dec.status } } : {}),
    };
    if (cwd === '.' || cwds.length === 1 || cwd === cwds[0]) {
      if (metrics.type_soundness) entry.type_soundness = metrics.type_soundness;
      if (metrics.escape_hatch) entry.escape_hatch = metrics.escape_hatch;
      if (metrics.cycles?.ids) entry.cycles = { engine: metrics.cycles.engine, count: metrics.cycles.count, ids: metrics.cycles.ids };
      if (metrics.knip && !metrics.knip.unavailable) entry.knip = { files: metrics.knip.files, exports: metrics.knip.exports, types: metrics.knip.types, dependencies: metrics.knip.dependencies };
    }
    roots[cwd] = entry;
  }
  // ratchet: keep the old floor where the new value is worse or the metric differs in a way that cannot be compared
  if (old && old.roots) {
    for (const [k, nw] of Object.entries(roots)) {
      const o = old.roots[k]; if (!o) continue;
      if (o.type_soundness && nw.type_soundness) {
        if (o.type_soundness.metric !== nw.type_soundness.metric) warnings.push(`baseline ${k}: type-soundness engine changed (${o.type_soundness.metric} -> ${nw.type_soundness.metric}); floor re-captured`);
        else {
          const worse = nw.type_soundness.lower_is_better ? nw.type_soundness.value > o.type_soundness.value : nw.type_soundness.value < o.type_soundness.value;
          if (worse) { nw.type_soundness = o.type_soundness; warnings.push(`baseline ${k}: type_soundness would be lower than the saved floor; floor kept`); }
        }
      }
      if (o.escape_hatch && nw.escape_hatch && Object.keys(nw.escape_hatch).some((f) => f !== 'metric' && nw.escape_hatch[f] > (o.escape_hatch[f] ?? Infinity))) { nw.escape_hatch = o.escape_hatch; warnings.push(`baseline ${k}: escape_hatch counts are worse than the saved floor; floor kept`); }
      if (o.cycles && nw.cycles && o.cycles.engine === nw.cycles.engine && nw.cycles.count > o.cycles.count) { nw.cycles = o.cycles; warnings.push(`baseline ${k}: more cycles than the saved floor; floor kept`); }
      if (o.knip && nw.knip && Object.keys(nw.knip).some((f) => nw.knip[f] > (o.knip[f] ?? Infinity))) { nw.knip = o.knip; warnings.push(`baseline ${k}: Knip counts are higher than the saved floor; floor kept`); }
      if (o.typecheck && nw.typecheck && nw.typecheck.errors > o.typecheck.errors && o.typecheck.engine === nw.typecheck.engine) { nw.typecheck = o.typecheck; warnings.push(`baseline ${k}: typecheck errors would rise above the saved floor; floor kept`); }
    }
  }
  const t = legResults.find((e) => e.id === 'test' && e.cwd);
  const b = legResults.find((e) => e.id === 'build' && e.cwd);
  const cmdOf = (id) => (run.gate.legs.find((l) => l.id === id)?.cmd || []).join(' ');
  const doc = {
    schema: 'ts-optimize/baseline@1', captured: nowIso(), head,
    roots,
    tests: t ? { cmd: cmdOf('test'), exit: t.exit, collected: t.collected ?? null, ms: t.ms } : null,
    build: b ? { cmd: cmdOf('build'), exit: b.exit, ms: b.ms } : null,
  };
  writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
  return '.ts-optimize/baseline.json';
}
