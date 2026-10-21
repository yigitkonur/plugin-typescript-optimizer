// The wave gate (doc 05 §9, references/gate-spec.md). runGate() runs the legs a wave requires and decides pass/fail.
// A typecheck leg passes iff it produces no fingerprint beyond the baseline multiset (so an accepted red baseline passes while
// introducing nothing new); test/build get one retry; extras (cycles, coverage, install-frozen, knip, diff-accounting) are below.
// Nothing here edits config or tests to make a leg pass.
import { join } from 'node:path';
import { readRun, runDir, stampLog } from '../artifacts/store.mjs';
import { listFindings } from './findings.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, readJsonc } from '../core/fs.mjs';
import { compileGlob } from '../core/glob.mjs';
import { run as runProc } from '../core/proc.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { currentCycles, currentTypeMetrics, gateDir, knipIssues, readBaselineDiagnostics, wavesCatalog } from './baseline.mjs';
import { delta, legDiagnostics, legKey, parseCollected, runLeg, runWithRetry, snap, updateRun } from './exec.mjs';
import { diagFingerprint, diagMultiset, newFingerprints, worktreeFingerprint } from './fingerprint.mjs';
import { recordDivergence } from './divergence.mjs';

const ORDER = ['typecheck', 'build-refs', 'declaration-emit', 'lint', 'test', 'build', 'cycles', 'coverage', 'install-frozen', 'knip', 'diff-accounting'];
const NOT_RUN_STATES = new Set(['rejected', 'skipped', 'suppressed', 'stale', 'superseded', 'reverted']);

const sum = (parts, k) => parts.reduce((a, p) => a + (p[k] || 0), 0);

function aggregate(parts) {
  const fail = parts.find((p) => p.status === 'fail');
  // an unavailable part is never hidden by a passing sibling: one workspace nobody could check is unchecked code
  const status = fail ? 'fail' : parts.some((p) => p.status === 'unavailable') ? 'unavailable' : parts.some((p) => p.status === 'pass') ? 'pass' : 'not-applicable';
  const shown = fail || parts.find((p) => p.status === status) || parts[0] || {};
  const out = { status, ms: sum(parts, 'ms'), flaky: parts.some((p) => p.flaky), variant: shown.variant ?? parts[0]?.variant ?? null, tail: shown.tail || '' };
  for (const k of ['reason', 'tail_file', 'exit', 'timed_out', 'untrusted', 'note', 'notes']) if (shown[k] !== undefined && shown[k] !== null) out[k] = shown[k];
  const nf = parts.flatMap((p) => p.new_fingerprints || []);
  if (nf.length) out.new_fingerprints = nf;
  for (const k of ['collected', 'baseline_errors', 'remaining', 'accounted', 'remaining_items', 'new_cycles', 'metric', 'untraced', 'commits', 'baseline', 'current', 'cmd']) if (shown[k] !== undefined) out[k] = shown[k];
  if (parts.length > 1) out.parts = parts.map((p) => ({ cwd: p.cwd ?? null, status: p.status, ms: p.ms, ...(p.flaky ? { flaky: true } : {}) }));
  return out;
}

function lintLeg(root, d) {
  const pj = readJsonc(join(root, 'package.json'));
  const s = pj.ok && pj.value && pj.value.scripts && pj.value.scripts.lint;
  return s && d.pm?.run ? { id: 'lint', cwd: '.', cmd: [...d.pm.run, 'lint'], timeout_s: 600 } : null;
}

const INSTALL = {
  npm: { lock: ['package-lock.json', 'npm-shrinkwrap.json'], cmd: ['npm', 'ci', '--dry-run', '--ignore-scripts'] },
  pnpm: { lock: ['pnpm-lock.yaml'], cmd: ['pnpm', 'install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'] },
  'yarn-berry': { lock: ['yarn.lock'], cmd: ['yarn', 'install', '--immutable', '--mode=skip-build'] }, // yarn 4 rejects --immutable with --mode=update-lockfile
  yarn: { lock: ['yarn.lock'], cmd: ['yarn', 'install', '--frozen-lockfile', '--ignore-scripts'] },
  bun: { lock: ['bun.lock', 'bun.lockb'], cmd: ['bun', 'install', '--frozen-lockfile', '--dry-run'] },
};

/** fix waves, tsgo tiers and the post-flight wave all use the same catalog entry shape */
function waveDef(wave) {
  const w = wavesCatalog().waves.find((x) => x.id === String(wave));
  if (!w) throw new TsOptError(EXIT.USAGE, `unknown wave "${wave}"`, `waves: ${wavesCatalog().waves.map((x) => x.id).join(', ')}`);
  return w;
}

export async function runGate({ root, runId, wave, legs = null, quiet = false, record = true }) {
  const t0 = Date.now();
  const run = readRun(root, runId);
  const w = waveDef(wave);
  const outDir = gateDir(root, runId);
  let d = null;
  const getD = async () => (d ||= await detectProject(root));
  const bd = readBaselineDiagnostics(root, runId);
  const bm = run.gate?.baseline?.metrics || {};
  const redBaseline = run.gate?.red_baseline || null;
  const untrusted = new Set(redBaseline?.untrusted || []);
  const fpBefore = await worktreeFingerprint(root);

  const runLegs = run.gate?.legs || [];
  const unavailableReason = (id) => (run.gate?.unavailable || []).find((u) => u.id === id)?.reason || null;
  const has = (id) => runLegs.some((l) => l.id === id);
  const conditions = {
    declaration_signal: () => has('declaration-emit'),
    composite: () => runLegs.some((l) => l.id === 'typecheck' && ['noemit-b', 'emit-and-clean'].includes(l.variant)),
    lint_script: async () => !!lintLeg(root, await getD()),
    test_script: () => has('test'),
    build_script: () => has('build'),
  };

  // ---- which legs does this wave require? -------------------------------------------------------------------------------
  const results = {}; // id -> aggregated result
  const required = [];
  for (const id of w.gate) {
    const cond = w.gate_if?.[id];
    if (cond && conditions[cond] && !(await conditions[cond]())) {
      if (!legs || legs.includes(id)) results[id] = { status: 'not-applicable', ms: 0, flaky: false, variant: null, tail: '', reason: `condition ${cond} not met` };
      continue;
    }
    if (legs && !legs.includes(id)) continue;
    required.push(id);
  }
  required.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  const adoptions = [];
  const rebaselined = {};

  for (const id of required) {
    const parts = [];
    const missing = (reason, status = 'unavailable') => parts.push({ status, ms: 0, reason });

    if (id === 'typecheck' || id === 'declaration-emit') {
      const mine = runLegs.map((l, index) => ({ l, index })).filter((x) => x.l.id === id);
      if (!mine.length) missing(unavailableReason(id) || (id === 'typecheck' ? 'no typecheck leg detected' : 'no declaration/composite/types signal'), id === 'typecheck' ? 'unavailable' : 'not-applicable');
      for (const { l, index } of mine) {
        const r = await runLeg(l, { root, wave, outDir });
        if (r.adopted) adoptions.push({ index, adopted: r.adopted });
        if (r.status === 'unavailable') { parts.push({ ...r, cwd: l.cwd }); continue; }
        const diags = legDiagnostics(l, r);
        const base = bd?.authoritative?.by_leg?.[legKey(l)] || {};
        const cur = diagMultiset(diags, root);
        const fresh = newFingerprints(base, cur);
        const baseCount = Object.values(base).reduce((a, b) => a + b, 0);
        const part = { ...r, cwd: l.cwd, baseline_errors: baseCount };
        if (r.status === 'fail') {
          if (r.timed_out || r.tree_changed) part.status = 'fail';
          else if (!fresh.length && diags.length) part.status = 'pass'; // only errors the baseline already had
          if (fresh.length) {
            const fps = new Map(fresh.map((f) => [f.fingerprint, f]));
            const shown = []; const seen = new Set();
            for (const dg of diags) {
              const fp = diagFingerprint(dg, root);
              if (fps.has(fp) && !seen.has(fp)) { seen.add(fp); shown.push({ ...fps.get(fp), file: dg.file, line: dg.line, code: dg.code, message: dg.message }); }
            }
            part.new_fingerprints = shown.slice(0, 30);
          }
        }
        parts.push(part);
      }
      // the authority passed: did the fast compiler agree? A fast failure on a tree the authority accepts is a divergence (doc 05 §8.2)
      if (id === 'typecheck' && record && !legs && run.fast_check?.enabled !== false && parts.length && parts.every((p) => p.status === 'pass' && !(p.new_fingerprints || []).length)) {
        try {
          const dd = await getD();
          if (dd.compilers?.authoritative?.kind !== 'native' && dd.compilers?.fast) {
            const { runCheck } = await import('./check.mjs');
            const fc = await runCheck({ root, runId });
            if (!fc.passed) recordDivergence(root, runId, { wave: w.id, fast: fc.new_errors?.[0] ? `${fc.new_errors[0].file}(${fc.new_errors[0].line}) ${fc.new_errors[0].code}` : null });
          }
        } catch { /* the probe is advisory: a failing probe never changes the gate */ }
      }
    } else if (id === 'build-refs') {
      const comp = runLegs.filter((l) => l.id === 'typecheck' && ['noemit-b', 'emit-and-clean'].includes(l.variant));
      if (!comp.length) missing('no composite/solution typecheck leg', 'not-applicable');
      for (const l of comp) {
        const bin = l.cmd[0];
        const cfg = l.cmd.find((a, i) => ['-b', '--build'].includes(l.cmd[i - 1]) && !a.startsWith('-'));
        const leg = { id: 'build-refs', cwd: l.cwd, timeout_s: l.timeout_s, variant: 'emit-and-clean', cmd: [bin, '-b', ...(cfg ? [cfg] : []), '--pretty', 'false'], clean_cmd: [bin, '-b', ...(cfg ? [cfg] : []), '--clean'] };
        parts.push({ ...(await runLeg(leg, { root, wave, outDir })), cwd: l.cwd });
      }
    } else if (id === 'lint') {
      const leg = lintLeg(root, await getD());
      if (!leg) missing('no lint script', 'not-applicable'); else parts.push(await runLeg(leg, { root, wave, outDir }));
    } else if (id === 'test' || id === 'build') {
      const mine = runLegs.filter((l) => l.id === id);
      if (!mine.length) missing(unavailableReason(id) || `no ${id} script`, id === 'test' ? 'unavailable' : 'not-applicable');
      for (const l of mine) {
        const r = await runWithRetry(l, { root, wave, outDir });
        const part = { ...r, cwd: l.cwd };
        if (id === 'test' && r.status === 'pass') {
          const n = parseCollected(l.runner, r.tail);
          if (n !== null) part.collected = n;
          if (n === 0) { part.status = 'fail'; part.reason = 'the test script ran but collected 0 tests; a green run that collected nothing proves nothing'; }
        }
        if (part.status === 'fail' && untrusted.has(id)) part.untrusted = true;
        parts.push(part);
      }
    } else if (id === 'cycles') {
      const base = bm.cycles;
      if (!base || !base.ids) missing(`no cycles baseline${base?.reason ? ` (${base.reason})` : ''}; run \`ts-opt baseline\``);
      else {
        const t = Date.now();
        const cur = await currentCycles(root, await getD(), run);
        if (!cur.ids) missing(cur.reason || 'cycle detection unavailable');
        else if (cur.engine !== base.engine) {
          rebaselined.cycles = { engine: cur.engine, count: cur.count, ids: cur.ids };
          parts.push({ status: 'pass', ms: Date.now() - t, note: `cycle engine changed (${base.engine} -> ${cur.engine}); cycles re-baselined at ${cur.count}` });
        } else {
          const known = new Set(base.ids);
          const fresh = cur.ids.filter((x) => !known.has(x));
          parts.push({ status: fresh.length ? 'fail' : 'pass', ms: Date.now() - t, baseline: base.count, current: cur.count, new_cycles: fresh, ...(fresh.length ? { reason: `${fresh.length} new import cycle(s)` } : {}) });
        }
      }
    } else if (id === 'coverage') {
      const base = bm.type_soundness;
      if (!base) missing('no coverage baseline; run `ts-opt baseline`');
      else {
        const t = Date.now();
        try {
          const cur = await currentTypeMetrics(root, await getD(), run);
          const nw = cur.type_soundness;
          if (nw.metric !== base.metric) {
            rebaselined.type_soundness = nw; rebaselined.escape_hatch = cur.escape_hatch;
            parts.push({ status: 'pass', ms: Date.now() - t, metric: nw.metric, note: `metric engine changed (${base.metric} -> ${nw.metric}); coverage re-baselined` });
          } else if (nw.metric.startsWith('escape-hatch')) {
            const bh = bm.escape_hatch || {};
            const worse = Object.keys(cur.escape_hatch).filter((k) => k !== 'metric' && cur.escape_hatch[k] > (bh[k] ?? Infinity));
            parts.push({ status: worse.length ? 'fail' : 'pass', ms: Date.now() - t, metric: nw.metric, baseline: base.value, current: nw.value, ...(worse.length ? { reason: `escape hatches increased: ${worse.map((k) => `${k} ${bh[k]} -> ${cur.escape_hatch[k]}`).join(', ')}` } : {}) });
          } else {
            // the ratchet is on the number of untyped identifiers: deleting well-typed code lowers the percentage without adding a single `any`
            const counts = [base.covered, base.total, nw.covered, nw.total].every((x) => Number.isFinite(x));
            const untypedBase = counts ? base.total - base.covered : null; const untypedNow = counts ? nw.total - nw.covered : null;
            const lower = counts ? untypedNow > untypedBase : nw.value < base.value - 0.005;
            const reason = counts ? `untyped identifiers rose from ${untypedBase} to ${untypedNow} (${nw.metric} ${base.value} -> ${nw.value})` : `${nw.metric} fell from ${base.value} to ${nw.value}`;
            parts.push({ status: lower ? 'fail' : 'pass', ms: Date.now() - t, metric: nw.metric, baseline: base.value, current: nw.value, ...(counts ? { untyped_baseline: untypedBase, untyped_current: untypedNow } : {}), ...(lower ? { reason } : {}) });
          }
        } catch (e) { missing(`coverage metric failed: ${e.message}`); }
      }
    } else if (id === 'install-frozen') {
      const dd = await getD();
      const pm = dd.pm;
      const key = pm?.name === 'yarn' ? (pm.pnp || Number(String(pm.version || '1').split('.')[0]) >= 2 ? 'yarn-berry' : 'yarn') : pm?.name;
      const spec = INSTALL[key];
      if (!spec) missing(`no frozen-install check for package manager "${pm?.name || 'none'}"`, 'not-applicable');
      else if (!spec.lock.some((f) => isFile(join(root, f)))) missing(`no lockfile (${spec.lock.join(' | ')})`, 'not-applicable');
      else {
        const before = await snap(root);
        const r = await runLeg({ id: 'install-frozen', cwd: '.', cmd: spec.cmd, timeout_s: 600 }, { root, wave, outDir });
        const changed = delta(before, await snap(root));
        if (changed.length) { r.status = 'fail'; r.reason = `the frozen install changed the working tree: ${changed.slice(0, 5).join(', ')}`; }
        parts.push({ ...r, cmd: spec.cmd.join(' ') });
      }
    } else if (id === 'knip') {
      const t = Date.now();
      const k = await knipIssues(root, await getD(), ['--exclude', 'cycles']);
      if (!k.ok) missing(k.reason);
      else {
        const ws = run.scope?.workspaces || [];
        const exc = (run.scope?.exclude || []).map((g) => compileGlob(g, { dot: true }));
        const inc = (run.scope?.include || []).map((g) => compileGlob(g, { dot: true }));
        const inScope = (f) => (!ws.length || ws.some((p) => p === '.' || f === p || f.startsWith(p + '/'))) && !exc.some((r) => r.test(f)) && (!inc.length || inc.some((r) => r.test(f)));
        // findings the user did not (or could not) apply are decisions, not leftovers
        const accounted = new Set();
        try {
          for (const f of listFindings(root, runId)) if (NOT_RUN_STATES.has(f.front.state)) {
            const loc = f.front.location || {};
            accounted.add(`${loc.file}\0${loc.symbol || ''}`);
            for (const m of f.front.members || []) accounted.add(`${loc.file}\0${m.symbol || ''}`);
          }
          const idx = readJsonc(join(runDir(root, runId), 'findings', 'index.json'));
          for (const row of idx.ok ? idx.value.findings || [] : []) if (NOT_RUN_STATES.has(row.state)) accounted.add(`${row.file}\0${row.symbol || ''}`);
        } catch { /* no findings dir */ }
        const left = k.issues.filter((i) => inScope(i.file) && !i.file.startsWith('.quarantine/')); // quarantined files are parked on purpose
        const remaining = left.filter((i) => !accounted.has(`${i.file}\0${i.name || ''}`));
        parts.push({ status: remaining.length ? 'fail' : 'pass', ms: Date.now() - t, remaining: remaining.length, accounted: left.length - remaining.length, remaining_items: remaining.slice(0, 15).map((i) => ({ type: i.type, file: i.file, name: i.name })), ...(remaining.length ? { reason: `${remaining.length} Knip finding(s) remain in scope` } : {}) });
      }
    } else if (id === 'diff-accounting') {
      const t = Date.now();
      const base = run.applying?.base || run.repo?.head;
      if (!run.repo?.git || !base) missing('not a git repository or no run base', 'not-applicable');
      else {
        const lg = await runProc(['git', 'log', '--no-merges', '--format=%H%x1f%s%x1f%B%x1e', `${base}..HEAD`], { cwd: root, timeoutMs: 30_000 });
        if (lg.code !== 0) missing(`git log ${base}..HEAD failed: ${(lg.stderr || '').trim().split('\n')[0]}`);
        else {
          const known = new Set(listFindings(root, runId).map((f) => f.id));
          const traced = (body) => /^Finding:\s*\S+/m.test(body || '') || [...String(body || '').matchAll(/^Reverts-Finding:\s*(F-\d+)\s*$/gm)].some((m) => known.has(m[1])); // a revert of a finding of this run is accounted for
          const commits = lg.stdout.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => { const [sha, subject, body] = c.split('\x1f'); return { sha, subject, traced: traced(body) }; });
          const untraced = [];
          for (const c of commits.filter((x) => !x.traced)) {
            const files = await runProc(['git', 'show', '--name-only', '--format=', c.sha], { cwd: root, timeoutMs: 20_000 });
            const paths = files.stdout.split('\n').filter(Boolean);
            if (!(paths.length && paths.every((p) => p === '.ts-optimize' || p.startsWith('.ts-optimize/')))) untraced.push(`${c.sha.slice(0, 7)} ${c.subject}`);
          }
          parts.push({ status: untraced.length ? 'fail' : 'pass', ms: Date.now() - t, commits: commits.length, untraced, ...(untraced.length ? { reason: `${untraced.length} commit(s) without a Finding: trailer` } : {}) });
        }
      }
    }
    results[id] = aggregate(parts);
  }

  // ---- verdict -------------------------------------------------------------------------------------------------------------
  const needs = new Set(['typecheck', ...(w.needs || [])]);
  const blocking = [];
  for (const id of required) {
    const r = results[id];
    if (r.status === 'fail') { if (r.untrusted && !needs.has(id)) r.note = 'red baseline leg without a trustworthy fingerprint (untrusted); not a blocker for this wave'; else blocking.push(id); }
    else if (r.status === 'unavailable' && needs.has(id)) blocking.push(id);
  }
  const passed = blocking.length === 0;
  const fingerprint = await worktreeFingerprint(root);
  const ms = Date.now() - t0;
  const outLegs = {};
  for (const id of [...ORDER.filter((x) => results[x]), ...Object.keys(results).filter((x) => !ORDER.includes(x))]) {
    const r = { ...results[id] };
    if (quiet) { delete r.tail; delete r.parts; }
    outLegs[id] = r;
  }
  const out = { wave: w.id, passed, legs: outLegs, fingerprint, ms, ...(blocking.length ? { failed_legs: blocking } : {}), ...(fingerprint !== fpBefore ? { tree_changed: true } : {}) };

  if (record) {
    updateRun(root, runId, (r) => {
      for (const a of adoptions) { const cur = r.gate.legs[a.index]; if (cur) { cur.variant = a.adopted.variant; cur.cmd = a.adopted.cmd; if (a.adopted.clean_cmd) cur.clean_cmd = a.adopted.clean_cmd; } }
      if (Object.keys(rebaselined).length && r.gate.baseline) r.gate.baseline.metrics = { ...(r.gate.baseline.metrics || {}), ...rebaselined };
      // a --legs subset is a probe (bisect, debugging): it never stands in for the wave's gate record or moves the run state
      if (!legs) {
        const entry = (r.waves || []).find((x) => String(x.id) === w.id);
        const g = { passed, at: nowIso(), fingerprint, legs: Object.fromEntries(Object.entries(outLegs).map(([k, v]) => [k, v.status])), ms, ...(outLegs['diff-accounting']?.untraced?.length ? { untraced: outLegs['diff-accounting'].untraced } : {}) };
        if (entry) entry.gate = g;
        if (w.id === 'P') {
          r.post_flight = g; // finish needs the latest post-flight, at the worktree it is finishing
          if (passed && r.state === 'applying') r.state = 'verifying';
          else if (!passed && r.state === 'verifying') r.state = 'applying';
        }
      }
    });
    stampLog(root, runId, { ev: 'gate', wave: w.id, legs: Object.fromEntries(Object.entries(outLegs).map(([k, v]) => [k, v.status])), ms, flaky: Object.entries(outLegs).filter(([, v]) => v.flaky).map(([k]) => k), ...(legs ? { partial: true } : {}) });
  }
  return out;
}
