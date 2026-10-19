// ts-opt verdict add|status — the only writer of raw/verdicts (doc 04 §12).
import { appendFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { readCandidates, readChunks, readVerdicts } from '../artifacts/candidates.mjs';
import { mkdirp, isFile } from '../core/fs.mjs';
import { loadRules } from '../catalog/index.mjs';
import { runDir, readRun, writeRun, resolveRunId } from '../artifacts/store.mjs';
import { findRoot } from '../detect/root.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { existsSync } from 'node:fs';

export const spec = { chunk: 'string', candidate: 'string', verdict: 'string', confidence: 'string', q1: 'string', q2: 'string', q3: 'string', evidence: 'multi', reason: 'string', touch: 'multi', 'depends-on': 'multi', codify: 'string', recommendation: 'string', 'defer-missing': 'boolean', 'change-note': 'string' };
const YN = ['yes', 'no', 'unknown'];
const bad = (msg) => new TsOptError(EXIT.USAGE, msg);

export async function run({ cwd, flags, args }) {
  const sub = args[0];
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  if (sub === 'add') return add(root, id, flags);
  if (sub === 'status') return status(root, id, flags);
  throw bad('usage: ts-opt verdict add|status');
}

function add(root, id, f) {
  const cands = readCandidates(root, id);
  const c = cands.find((x) => x.id === f.candidate);
  if (!c) throw bad(`unknown candidate ${f.candidate}`);
  if (!['confirmed', 'false-positive', 'deferred'].includes(f.verdict)) throw bad('--verdict must be confirmed|false-positive|deferred');
  const conf = f.confidence || (f.verdict === 'confirmed' ? 'likely' : 'likely');
  if (!['certain', 'likely', 'speculative'].includes(conf)) throw bad('--confidence must be certain|likely|speculative');
  const q = [f.q1 || 'unknown', f.q2 || 'unknown', f.q3 || 'unknown'];
  for (const x of q) if (!YN.includes(x)) throw bad('--q1/--q2/--q3 must be yes|no|unknown');
  const rule = loadRules().get(c.rule);

  let chunk = f.chunk || 'inline';
  if (f.chunk) {
    const ch = readChunks(root, id).find((x) => x.id === f.chunk);
    if (!ch) throw bad(`unknown chunk ${f.chunk}`);
    if (!ch.candidates.includes(c.id)) throw bad(`candidate ${c.id} does not belong to chunk ${f.chunk}`);
  }
  if (readVerdicts(root, id).some((v) => v.candidate === c.id)) throw bad(`candidate ${c.id} already has a verdict`);
  if (q.includes('yes') && f.verdict === 'confirmed') throw bad('a "yes" answer to Q1–Q3 means the candidate must not be confirmed (framework lifecycle, dynamic invocation or public contract)');
  if (f.verdict === 'false-positive' && !f.codify && !(f.reason && f.reason.trim())) throw bad('false-positive needs --codify or a --reason naming the engine behaviour');
  const evidence = f.evidence || [];
  if (evidence.length > 8) throw bad('at most 8 --evidence entries');
  for (const e of evidence) if (e.length > 300) throw bad('each --evidence entry must be <= 300 characters');
  if (f.verdict === 'confirmed' && rule?.fix_risk === 'high' && (q.includes('unknown') || !evidence.length)) throw bad('confirmed for a fix_risk: high rule needs Q1–Q3 answered and at least one --evidence');
  if (conf === 'certain' && f.verdict === 'confirmed' && q.some((x) => x !== 'no')) throw bad('"certain" confidence requires Q1–Q3 all "no"');
  const touches = [];
  for (const t of f.touch || []) {
    const abs = resolve(root, t);
    if (abs !== root && !abs.startsWith(root + sep)) throw bad(`--touch ${t} is outside the repository`);
    if (!existsSync(abs)) throw bad(`--touch ${t} does not exist`);
    touches.push(relative(root, abs).split(sep).join('/'));
  }
  if (f.recommendation && !['STRONG', 'WORTH_EXPLORING', 'SPECULATIVE'].includes(f.recommendation)) throw bad('--recommendation must be STRONG|WORTH_EXPLORING|SPECULATIVE');
  const rec = { schema: 'ts-optimize/verdict@1', candidate: c.id, verdict: f.verdict, confidence: conf, q1: q[0], q2: q[1], q3: q[2], evidence, reason: f.reason || '', touches, depends_on: f['depends-on'] || [], recommendation: f.recommendation || null, codify: f.codify || null, change_note: (f['change-note'] || '').slice(0, 400) || null, chunk };
  const dir = join(runDir(root, id), 'raw', 'verdicts');
  mkdirp(dir);
  appendFileSync(join(dir, `${chunk}.jsonl`), JSON.stringify(rec) + '\n');
  return { result: { recorded: c.id, verdict: f.verdict }, text: `recorded ${c.id}: ${f.verdict} (${conf})` };
}

function status(root, id, f) {
  const cands = readCandidates(root, id).filter((c) => c.triage !== 'deterministic');
  const verdicts = readVerdicts(root, id);
  const judged = new Set(verdicts.map((v) => v.candidate));
  let pending = cands.filter((c) => !judged.has(c.id));
  let deferredMissing = 0;
  if (f['defer-missing'] && pending.length) {
    const dir = join(runDir(root, id), 'raw', 'verdicts'); mkdirp(dir);
    for (const c of pending) {
      appendFileSync(join(dir, 'deferred-missing.jsonl'), JSON.stringify({ schema: 'ts-optimize/verdict@1', candidate: c.id, verdict: 'deferred', confidence: 'speculative', q1: 'unknown', q2: 'unknown', q3: 'unknown', evidence: [], reason: f.reason || 'triage incomplete', touches: [], depends_on: [], recommendation: null, codify: null, chunk: 'deferred-missing' }) + '\n');
      deferredMissing++;
    }
    pending = [];
  }
  const byChunk = {};
  for (const ch of readChunks(root, id)) byChunk[ch.id] = { total: ch.candidates.length, judged: ch.candidates.filter((x) => judged.has(x) || deferredMissing).length };
  const result = { judged: judged.size + deferredMissing, pending: pending.length, pending_ids: pending.slice(0, 50).map((c) => c.id), by_chunk: byChunk, deferred_missing: deferredMissing, needs_judgement: cands.length };
  return { result, text: `${result.judged}/${cands.length} judged, ${result.pending} pending${deferredMissing ? `, ${deferredMissing} deferred (missing)` : ''}${pending.length ? ': ' + pending.slice(0, 8).map((c) => c.id).join(' ') + (pending.length > 8 ? ' …' : '') : ''}` };
}
export { isFile, readRun, writeRun };
