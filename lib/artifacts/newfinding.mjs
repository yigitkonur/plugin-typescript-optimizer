// Findings created after ingest: fixer proposals (an extra consumer discovered while applying) and cascade findings (rescan).
import { join } from 'node:path';
import { writeFinding } from './finding.mjs';
import { fingerprintOf } from './fingerprint.mjs';
import { bodyOf } from './ingest.mjs';
import { eligible, waveName } from './plan.mjs';
import { runDir } from './store.mjs';
import { WAVE_ORDER, loadRules } from '../catalog/index.mjs';
import { nowIso } from '../core/clock.mjs';
import { isFile, readJsonc, readText, writeAtomic } from '../core/fs.mjs';
import { listFindings } from '../gate/findings.mjs';

export function nextFindingId(root, runId) {
  const max = Math.max(0, ...listFindings(root, runId).map((f) => Number(f.id.slice(2))));
  return `F-${String(max + 1).padStart(4, '0')}`;
}

/** insert an unchecked line into plan.md under "## Wave <w>" (creating the section in causal order) */
export function insertPlanLine(text, wave, line) {
  const lines = text.split('\n');
  const head = `## Wave ${wave} — `;
  const at = lines.findIndex((l) => l.startsWith(head));
  if (at >= 0) {
    let end = at + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end++;
    let last = end - 1;
    while (last > at && !lines[last].trim()) last--;
    lines.splice(last + 1, 0, line);
    return lines.join('\n');
  }
  // new section before the first later wave (or before "Not part of any wave")
  const myIdx = WAVE_ORDER.indexOf(String(wave));
  let ins = lines.findIndex((l) => { const m = /^## Wave (\S+) — /.exec(l); return m && WAVE_ORDER.indexOf(m[1]) > myIdx; });
  if (ins < 0) ins = lines.findIndex((l) => l.startsWith('## Not part of any wave'));
  if (ins < 0) ins = lines.length;
  lines.splice(ins, 0, `${head}${waveName(wave)}`, line, '');
  return lines.join('\n');
}

/**
 * addFinding({root, runId, detect, cand, rule, origin, wave, touches, reason, evidence, members, extra})
 * -> front matter of the created finding. The finding starts `open`: it needs approval (plan check / plan amend) before it can be committed.
 */
export function addFinding({ root, runId, detect, cand, allFingerprints = null, origin, wave = undefined, touches = [], reason, evidence = [], members = [], confidence = 'likely', fixMode = null, recommendation = null }) {
  const rule = loadRules().get(cand.rule);
  const id = nextFindingId(root, runId);
  const w = wave === undefined ? (rule.wave ?? null) : wave; // an explicit null means "no wave" (not scheduled)
  const front = {
    schema: 'ts-optimize/finding@1', id, fingerprint: cand.fingerprint || fingerprintOf({ rule: cand.rule, package: cand.package || '.', file: cand.file, symbol: cand.symbol || null, snippet: `${origin}:${id}` }), run: runId, rule: cand.rule, rule_version: rule.version ?? 1, domain: rule.domain, batch: rule.batch ?? null,
    wave: w === null ? null : String(w), severity: cand.severity_hint || rule.severity, fix_risk: cand.fix_risk_hint || rule.fix_risk, confidence, recommendation, verdict: 'confirmed', state: 'open',
    fix_mode: fixMode || rule.fix_mode, engines: [cand.engine || 'proposal'], package: cand.package || '.', location: { file: cand.file, line: cand.line || 1, symbol: cand.symbol || null },
    members, touches: [...new Set([cand.file, ...touches])].sort(), depends_on: [], origin,
    triage: { framework_lifecycle: 'unknown', dynamic_invocation: 'unknown', public_contract: 'unknown', evidence },
    suppressed_by: null, superseded_by: null, applied: null, verified_on: nowIso().slice(0, 10), candidate_fingerprints: allFingerprints?.length ? allFingerprints : cand.fingerprint ? [cand.fingerprint] : [],
  };
  const body = bodyOf({ cand: { snippet: cand.snippet || '', engine: cand.engine || origin, context: cand.context }, rule, v: { reason, change_note: null }, front, members: null }, runId, detect);
  writeFinding(join(runDir(root, runId), 'findings', `${id}.md`), front, body);
  const idxFile = join(runDir(root, runId), 'findings', 'index.json');
  if (isFile(idxFile)) {
    const idx = readJsonc(idxFile).value;
    idx.findings.push({ id, fingerprint: front.fingerprint, rule: front.rule, domain: front.domain, wave: front.wave, severity: front.severity, fix_risk: front.fix_risk, fix_mode: front.fix_mode, verdict: front.verdict, state: front.state, package: front.package, file: cand.file, line: front.location.line, depends_on: [] });
    idx.counts.total = idx.findings.length; idx.counts.by_state = {}; idx.counts.by_severity = { hard: 0, warn: 0, advisory: 0 };
    for (const r of idx.findings) { idx.counts.by_state[r.state] = (idx.counts.by_state[r.state] || 0) + 1; idx.counts.by_severity[r.severity]++; }
    writeAtomic(idxFile, JSON.stringify(idx, null, 2) + '\n');
  }
  const planFile = join(runDir(root, runId), 'plan.md');
  if (isFile(planFile) && eligible(front)) {
    const line = `- [ ] ${id} ${front.rule} \`${front.location.file}${front.location.symbol ? '#' + front.location.symbol : ''}\` — ${rule.name} (risk **${front.fix_risk}**, ${front.fix_mode}; ${origin}: needs your approval)`;
    writeAtomic(planFile, insertPlanLine(readText(planFile), front.wave, line));
  }
  return front;
}
