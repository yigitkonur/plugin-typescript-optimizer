// findings ingest: candidates + verdicts + suppressions + seams -> findings/, index.json, SUMMARY.md, plan.md (doc 04 §3.6).
import { join } from 'node:path';
import { workBranch } from './config.mjs';
import { readCandidates, readVerdicts } from './candidates.mjs';
import { fingerprintOf } from './fingerprint.mjs';
import { clean, fenced, fillTemplate, writeFinding } from './finding.mjs';
import { eligible, renderPlan } from './plan.mjs';
import { ART, OPEN_STATES, runDir, setOpenRun, writeRun } from './store.mjs';
import { renderSummary, scoreOf } from './summary.mjs';
import { DOMAIN_ORDER, WAVE_ORDER, catalogJson, loadRules } from '../catalog/index.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, mkdirp, readJsonc, writeAtomic } from '../core/fs.mjs';
import { readdirSync, rmSync } from 'node:fs';

const SEV = { hard: 0, warn: 1, advisory: 2 };
const MODE_WAVES = { sweep: ['R0', '1'], standard: ['R0', '1', '2', '3', 'B', '4', '5'], deep: ['R0', 'R', '1', '2', '3', 'B', '4', '5'], tsgo: ['T1', 'T2', 'T3', 'T4'] };
const NO_TEST_WAVES = ['B', '4'];
const YN = { yes: 'yes', no: 'no', unknown: 'unknown' };

function gateLineOf(detect) {
  const L = detect.gate.legs; const un = detect.gate.unavailable;
  const leg = (id) => { const l = L.find((x) => x.id === id); return l ? (l.argv ? `${id} (${l.argv.join(' ')})` : id) : null; };
  const parts = [L.some((l) => l.id === 'typecheck') ? 'typecheck' : null, leg('test'), leg('build')].filter(Boolean);
  const decl = L.some((l) => l.id === 'declaration-emit') ? 'declaration-emit applies' : 'declaration-emit not applicable';
  const missing = un.length ? ` Unavailable: ${un.map((u) => `${u.id} (${u.reason})`).join('; ')}.` : '';
  return `Gate: ${parts.join(' → ') || 'none'}; ${decl}.${missing}`;
}

export function ingest({ root, runId, detect, run, config, mode }) {
  const rd = runDir(root, runId);
  const rules = loadRules();
  const cands = readCandidates(root, runId);
  const verdicts = new Map(readVerdicts(root, runId).map((v) => [v.candidate, v]));
  const needReading = cands.filter((c) => c.triage !== 'deterministic');
  const unjudged = needReading.filter((c) => !verdicts.has(c.id));
  if (unjudged.length) throw new TsOptError(EXIT.PRECONDITION, `${unjudged.length} candidate(s) have no verdict (first: ${unjudged.slice(0, 5).map((c) => c.id).join(', ')})`, 'record them with `ts-opt verdict add`, or mark leftovers with `ts-opt verdict status --defer-missing --reason "triage incomplete"`');

  const hasTest = detect.gate.legs.some((l) => l.id === 'test');
  const schedulable = new Set((MODE_WAVES[mode] || MODE_WAVES.standard).filter((w) => hasTest || NO_TEST_WAVES.includes(w) || String(w).startsWith('T')));
  const notScheduled = [];
  if (!hasTest) notScheduled.push('No test leg: only waves B and 4 (zero-runtime type edits) are schedulable; a green gate cannot prove runtime safety without tests.');
  const today = nowIso().slice(0, 10);
  const lintUsable = !!detect.lint?.usable;

  const rescanFile = join(rd, 'raw', 'rescan.json');
  const rescan = isFile(rescanFile) ? readJsonc(rescanFile).value : null;
  const remained = new Set(rescan?.remained || []);
  const drafts = []; const dismissed = []; const agentSupp = [];
  // candidates a codified overlay made the engine stop reporting are confirmed false positives (doc 06 §9.1 tier 2)
  for (const c of rescan?.vanished || []) {
    const v0 = verdicts.get(c.id);
    dismissed.push({ candidate: c.id, rule: c.rule, file: c.file, line: c.line, reason: 'codified in the Knip overlay: the engine no longer reports it' + (v0?.reason ? ` (${clean(v0.reason, 160)})` : ''), codify: v0?.codify || null, fingerprint: c.fingerprint });
  }
  for (const c of cands) {
    const rule = rules.get(c.rule);
    if (!rule) continue;
    let v = verdicts.get(c.id);
    // a false positive whose codification did not remove the finding is not settled: it goes back to the human
    if (v && v.verdict === 'false-positive' && v.codify && remained.has(c.id)) v = { ...v, verdict: 'deferred', confidence: 'speculative', reason: `${v.reason || ''} (codification did not remove the finding)`.trim() };
    v = v || { verdict: 'confirmed', confidence: rule.triage === 'deterministic' ? 'certain' : 'likely', q1: 'unknown', q2: 'unknown', q3: 'unknown', evidence: [`engine: ${c.engine}`], reason: 'deterministic rule: engine output is the evidence', touches: [], depends_on: [], recommendation: null, codify: null };
    if (v.verdict === 'false-positive') {
      dismissed.push({ candidate: c.id, rule: c.rule, file: c.file, line: c.line, reason: clean(v.reason, 300), codify: v.codify || null, fingerprint: c.fingerprint });
      if (v.confidence === 'certain' && v.codify) agentSupp.push({ rule: c.rule, file: c.file, fingerprint: c.fingerprint, reason: clean(v.reason, 200), codify: v.codify, evidence: v.evidence });
      continue;
    }
    let severity = c.severity_hint || rule.severity;
    const dg = rule.downgrade_in || {};
    if (c.path_class === 'test' && dg.tests) severity = dg.tests === 'advisory' ? 'advisory' : dg.tests;
    let fixMode = v.verdict === 'deferred' ? 'flag-only' : (c.fix_mode_hint === 'assisted' && rule.fix_mode === 'auto' ? 'assisted' : rule.fix_mode); // a tell can only make a rule more conservative
    if (fixMode === 'auto' && (rule.engines || []).includes('L') && !lintUsable) fixMode = 'assisted';
    const wave = rule.wave && schedulable.has(String(rule.wave)) ? String(rule.wave) : null;
    const touches = [...new Set([c.file, ...(v.touches || []), ...(c.consumers || [])])].sort();
    drafts.push({
      cand: c, rule, v, severity, fixMode, wave, touches,
      front: {
        schema: 'ts-optimize/finding@1', id: null, fingerprint: c.fingerprint, run: runId, rule: c.rule, rule_version: rule.version ?? 1, domain: c.domain,
        batch: rule.batch ?? null, wave, severity, fix_risk: c.fix_risk_hint || rule.fix_risk, confidence: v.verdict === 'deferred' ? 'speculative' : c.tier_degraded && v.confidence === 'certain' ? 'likely' : v.confidence,
        recommendation: v.recommendation || null, verdict: v.verdict, state: 'open', fix_mode: fixMode, engines: [c.engine], package: c.package,
        location: { file: c.file, line: c.line, symbol: c.symbol || null }, members: (c.members || []).map((m) => (typeof m === 'string' ? { file: m, line: null, symbol: null } : m)), touches, depends_on: [],
        origin: c.origin || 'scan',
        triage: { framework_lifecycle: YN[v.q1] || 'unknown', dynamic_invocation: YN[v.q2] || 'unknown', public_contract: YN[v.q3] || 'unknown', evidence: (v.evidence || []).map((e) => clean(e, 300)) },
        suppressed_by: null, superseded_by: null, applied: null, verified_on: today,
        candidate_fingerprints: [c.fingerprint],
      },
    });
  }

  // grain "file" rules (reach-02/04/05, …): one finding per file whose `members` list every symbol (doc 04 §3.1).
  // tc-04 / tc-05 (alias scheme, runner replacement) are one edit of the package's package.json however many tools and scripts hit,
  // so they are one finding per package: members carry the evidence sites.
  // struct-07 (duplicate utility) is one consolidation per helper name: members are the copies, touches the copies and every call site
  const PKG_GROUPED = new Set(['tc-04', 'tc-05', 'struct-07']);
  const groupKey = (c) => (c.rule === 'struct-07' ? `${c.rule}\0${c.package}\0name:${c.symbol}` : `${c.rule}\0${c.package}\0*`);
  const grouped = new Map();
  const solo = [];
  for (const dr of drafts) {
    const pkgGroup = PKG_GROUPED.has(dr.cand.rule) && dr.v.verdict === 'confirmed';
    if (pkgGroup) { const k = groupKey(dr.cand); (grouped.get(k) || grouped.set(k, []).get(k)).push(dr); }
    else if ((dr.rule.grain === 'file') && dr.cand.symbol && dr.v.verdict === 'confirmed') {
      const k = `${dr.cand.rule}\0${dr.cand.package}\0${dr.cand.file}`;
      (grouped.get(k) || grouped.set(k, []).get(k)).push(dr);
    } else solo.push(dr);
  }
  const merged = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => a.cand.file.localeCompare(b.cand.file) || a.cand.line - b.cand.line);
    const first = list[0];
    const pkgGroup = PKG_GROUPED.has(first.cand.rule);
    if (pkgGroup && first.cand.rule !== 'struct-07') {
      const pj = first.cand.package && first.cand.package !== '.' ? `${first.cand.package}/package.json` : 'package.json';
      const anchor = list.find((x) => x.cand.file === pj) || first;
      list.splice(list.indexOf(anchor), 1); list.unshift(anchor);
    }
    if (list.length === 1 && !pkgGroup) { first.front.members = [{ line: first.cand.line, symbol: first.cand.symbol }]; merged.push(first); continue; }
    const head = list[0];
    const f = head.front;
    f.members = list.slice(0, 50).map((x) => (pkgGroup ? { file: x.cand.file, line: x.cand.line, symbol: x.cand.symbol } : { line: x.cand.line, symbol: x.cand.symbol }));
    f.location = { file: head.cand.file, line: head.cand.line, symbol: null };
    f.touches = [...new Set(list.flatMap((x) => x.touches))].sort();
    f.candidate_fingerprints = list.map((x) => x.cand.fingerprint);
    f.fingerprint = fingerprintOf({ rule: head.cand.rule, package: head.cand.package, file: head.cand.file, symbol: head.cand.rule === 'struct-07' ? `name:${head.cand.symbol}` : '*', snippet: '' });
    f.confidence = list.some((x) => x.front.confidence === 'likely') ? 'likely' : f.confidence;
    f.severity = list.some((x) => x.severity === 'hard') ? 'hard' : f.severity;
    f.triage.evidence = [...new Set(list.flatMap((x) => x.front.triage.evidence.map((e) => `${x.cand.symbol}: ${e}`)))].slice(0, 12).map((e) => clean(e, 300));
    head.touches = f.touches;
    head.severity = f.severity;
    head.members = list;
    head.cand = { ...head.cand, snippet: list.map((x) => x.cand.snippet).join('\n').slice(0, 400), symbol: first.cand.rule === 'struct-07' ? first.cand.symbol : null };
    merged.push(head);
  }
  drafts.length = 0;
  drafts.push(...solo, ...merged);

  // overflow: cap per domain, ranked by score
  const cap = config.thresholds?.max_findings_per_domain ?? 400;
  const overflow = [];
  let kept = [];
  for (const dom of DOMAIN_ORDER) {
    const list = drafts.filter((d) => d.front.domain === dom).sort((a, b) => scoreOf(b.front) - scoreOf(a.front) || a.cand.file.localeCompare(b.cand.file) || a.cand.line - b.cand.line);
    kept.push(...list.slice(0, cap));
    overflow.push(...list.slice(cap));
  }

  // deterministic order and ids
  const wIdx = (w) => (w === null ? 99 : WAVE_ORDER.indexOf(w));
  kept.sort((a, b) => wIdx(a.front.wave) - wIdx(b.front.wave) || DOMAIN_ORDER.indexOf(a.front.domain) - DOMAIN_ORDER.indexOf(b.front.domain) || SEV[a.front.severity] - SEV[b.front.severity] || a.cand.file.localeCompare(b.cand.file) || a.cand.line - b.cand.line || a.cand.rule.localeCompare(b.cand.rule));
  kept.forEach((d, i) => { d.front.id = `F-${String(i + 1).padStart(4, '0')}`; });
  const byCand = new Map(kept.map((d) => [d.cand.id, d]));
  for (const d of kept) d.front.depends_on = (d.v.depends_on || []).map((cid) => byCand.get(cid)?.front.id).filter(Boolean);

  // seams: the lower-priority rule at the same location is superseded by the primary
  const seams = catalogJson('seams.json');
  const pairs = Array.isArray(seams) ? seams : (seams?.seams || []);
  for (const s of pairs) {
    for (const loser of kept.filter((d) => d.front.rule === s.superseded && d.front.state === 'open')) {
      const winner = kept.find((d) => d.front.rule === s.primary && d.front.location.file === loser.front.location.file && (rules.get(s.primary)?.grain === 'file' || d.front.location.line === loser.front.location.line));
      if (winner) { loser.front.state = 'superseded'; loser.front.superseded_by = winner.front.id; loser.front.wave = null; }
    }
  }

  // a tc-01 finding that removes `baseUrl` must run after the tc-02 import rewrites (they still need baseUrl to resolve until rewritten)
  for (const d of kept) {
    if (d.front.rule !== 'tc-01' || d.front.state !== 'open' || !(d.front.members || []).some((m) => m.symbol === 'baseUrl')) continue;
    const before = kept.filter((o) => o.front.rule === 'tc-02' && o.front.state === 'open' && o.front.package === d.front.package && o.front.location.file !== d.front.location.file).map((o) => o.front.id);
    d.front.depends_on = [...new Set([...(d.front.depends_on || []), ...before])];
  }

  // write findings
  const fdir = join(rd, 'findings');
  mkdirp(fdir);
  for (const f of readdirSync(fdir)) if (/^F-\d+\.md$/.test(f) || f === 'index.json') rmSync(join(fdir, f), { force: true });
  for (const d of kept) writeFinding(join(fdir, `${d.front.id}.md`), d.front, bodyOf(d, runId, detect));
  const findings = kept.map((d) => d.front);

  // suppressions made by the agent
  const supFile = join(root, ART, 'suppressions.json');
  const sup = isFile(supFile) ? readJsonc(supFile).value || { schema: 'ts-optimize/suppressions@1', entries: [] } : { schema: 'ts-optimize/suppressions@1', entries: [] };
  sup.entries ||= [];
  const addedSupp = [];
  for (const a of agentSupp) {
    if (sup.entries.some((e) => e.fingerprint === a.fingerprint)) continue;
    const e = { id: `S-${String(sup.entries.length + 1).padStart(3, '0')}`, fingerprint: a.fingerprint, rule: a.rule, file: a.file, reason: a.reason, evidence: a.evidence || [], by: 'ts-triager', confirmed_by_user: false, date: today, expires: new Date(Date.parse(today) + 90 * 864e5).toISOString().slice(0, 10), codified_in: a.codify };
    sup.entries.push(e); addedSupp.push(e);
  }
  if (addedSupp.length) writeAtomic(supFile, JSON.stringify(sup, null, 2) + '\n');
  const suppressedList = (readJsonc(join(rd, 'raw', 'suppressed.json')).value) || [];

  // index
  const counts = { total: findings.length, by_state: {}, by_severity: { hard: 0, warn: 0, advisory: 0 } };
  for (const f of findings) { counts.by_state[f.state] = (counts.by_state[f.state] || 0) + 1; counts.by_severity[f.severity]++; }
  const index = {
    schema: 'ts-optimize/findings-index@1', run: runId, generated: nowIso(), counts,
    findings: findings.map((f) => ({ id: f.id, fingerprint: f.fingerprint, rule: f.rule, domain: f.domain, wave: f.wave, severity: f.severity, fix_risk: f.fix_risk, fix_mode: f.fix_mode, verdict: f.verdict, state: f.state, package: f.package, file: f.location.file, line: f.location.line, depends_on: f.depends_on })),
    dismissed, suppressed: suppressedList, overflow: overflow.map((d) => ({ rule: d.cand.rule, file: d.cand.file, line: d.cand.line, score: scoreOf(d.front) })),
  };
  writeAtomic(join(fdir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  if (overflow.length) writeAtomic(join(rd, 'overflow.md'), ['# Findings beyond the per-domain cap', '', ...overflow.sort((a, b) => scoreOf(b.front) - scoreOf(a.front)).map((d) => `- ${d.cand.rule} \`${d.cand.file}:${d.cand.line}\``), ''].join('\n'));

  // plan + summary
  const gateLine = gateLineOf(detect);
  const rulesById = rules;
  writeAtomic(join(rd, 'plan.md'), renderPlan({ run: runId, mode, baseBranch: run.repo.default_branch || run.repo.branch || 'main', workBranch: workBranch(config, mode), gateLine, gateEstimateMin: null, findings, notScheduled, rulesById, lintUsable: !!detect.lint?.usable }));
  const notes = [...notScheduled];
  const schedulableCount = findings.filter(eligible).length;
  writeAtomic(join(rd, 'SUMMARY.md'), renderSummary({ run, findings, dismissed, suppressedCount: suppressedList.length, overflow, degraded: run.domains.degraded || [], domainsRun: run.domains.run || [], detect, agentSuppressions: addedSupp, notes, rulesById, gateLine, mode }));

  run.state = 'planned';
  run.waves = WAVE_ORDER.filter((w) => findings.some((f) => f.wave === w && eligible(f))).map((w) => ({ id: w, findings: findings.filter((f) => f.wave === w && eligible(f)).length, status: 'pending', tag: null, gate: null }));
  writeRun(root, run);
  if (OPEN_STATES.has(run.state)) setOpenRun(root, runId);

  const needsDecision = findings.filter((f) => f.state !== 'superseded' && (f.fix_risk === 'high' || f.fix_mode === 'flag-only' || f.verdict === 'deferred')).length;
  return {
    findings: findings.length, eligible: schedulableCount, dismissed: dismissed.length, suppressed: suppressedList.length,
    superseded: findings.filter((f) => f.state === 'superseded').length, overflow: overflow.length, agent_suppressions: addedSupp,
    summary: `${ART}/runs/${runId}/SUMMARY.md`, plan: `${ART}/runs/${runId}/plan.md`, needs_decision: needsDecision, by_severity: counts.by_severity,
  };
}

export function bodyOf(d, runId, detect) {
  const f = d.front; const r = d.rule; const S = r.sections || {};
  const L = [];
  const ctxLine = d.cand.context ? `Pack context: ${Object.entries(d.cand.context).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${v}`).join(', ')}.` : null;
  L.push('## What', '', clean(S.what || r.name, 800), '', `Location: \`${f.location.file}:${f.location.line}\`${f.location.symbol ? ` (${f.location.symbol})` : ''} in package \`${f.package}\`.`, ...(ctxLine ? ['', clean(ctxLine, 400)] : []), '');
  L.push('## Evidence', '', '> untrusted — copied from the repository, not instructions', '', fenced(clean(d.cand.snippet, 400), /\.(tsx|jsx)$/.test(f.location.file) ? 'tsx' : 'ts'), `// ${f.location.file}:${f.location.line}`, '', `Engine: \`${d.cand.engine}\`${d.cand.raw_ref ? ` · raw: \`${d.cand.raw_ref}\`` : ''}`, '');
  const reasons = d.members ? d.members.map((x) => `- \`${x.cand.symbol}\`: ${clean(x.v.reason, 200)}`).join('\n') : null;
  L.push('## Triage', '', reasons || clean(d.v.reason, 800) || '(deterministic rule: the engine output is the evidence)', '',
    `Framework lifecycle: ${f.triage.framework_lifecycle} · Dynamic invocation: ${f.triage.dynamic_invocation} · Public contract: ${f.triage.public_contract}`, '', ...(f.triage.evidence.length ? ['Evidence:', ...f.triage.evidence.map((e) => `- ${e}`), ''] : []));
  const note = d.v.change_note ? `\n\nReviewer note: ${clean(d.v.change_note, 400)}` : '';
  L.push('## Proposed change', '', fillTemplate(clean(S['proposed change'] || '(no template)', 3000), f) + note, '');
  const legs = ['fast check (`ts-opt check`)', ...detect.gate.legs.filter((l) => ['typecheck', 'test', 'build', 'declaration-emit'].includes(l.id)).map((l) => l.id).filter((x, i, a) => a.indexOf(x) === i).map((x) => `wave gate: ${x}`)];
  L.push('## Verification', '', ...legs.map((x) => `- ${x}`), ...(S.verification ? ['', clean(S.verification, 800)] : []), '');
  L.push('## Rollback', '', '`git revert <commit>` (the commit is filled after apply).', '');
  L.push('## Applied', '', '');
  return L.join('\n');
}
