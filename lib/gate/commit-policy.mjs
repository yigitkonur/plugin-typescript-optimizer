// `ts-opt commit` refusal rules (doc 03 H3 rules 1-6, doc 03 §4 protected paths and edit patterns, doc 06 §6).
// One implementation: the CLI calls checkCommitPolicy(); hooks never duplicate it. Pure apart from reading the rule catalog.
import { WAVE_ORDER, loadRules } from '../catalog/index.mjs';
import { matchGlob } from '../core/glob.mjs';

const posix = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const waveIdx = (w) => { const i = WAVE_ORDER.indexOf(String(w)); return i < 0 ? 99 : i; };
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?)\/)/;

/** lockfile basenames per package manager (doc 03 H3 rule 2) */
export const LOCKFILES = {
  npm: ['package-lock.json', 'npm-shrinkwrap.json'], pnpm: ['pnpm-lock.yaml'], yarn: ['yarn.lock'], bun: ['bun.lock', 'bun.lockb'], deno: ['deno.lock'],
};

// ------------------------------------------------------------------------------------------------ git output parsers
/** `git status --porcelain=v1 -z` -> [{status, path, from?}] with .ts-optimize/ excluded. Renames keep their origin in `from`. */
export function parseStatusZ(stdout) {
  const out = [];
  const parts = String(stdout || '').split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; const x = e[0]; const y = e[1]; const p = e.slice(3);
    let from;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') from = parts[++i];
    if (p === '.ts-optimize' || p.startsWith('.ts-optimize/')) continue;
    out.push(from ? { status: e.slice(0, 2), path: p, from } : { status: e.slice(0, 2), path: p });
  }
  return out;
}

function unquote(s) {
  let p = s.replace(/\t.*$/, '');
  if (p.startsWith('"') && p.endsWith('"')) { try { p = JSON.parse(p); } catch { p = p.slice(1, -1); } }
  return p;
}

/** unified diff (git diff -U0 or any hunk-correct diff) -> Map(file -> {added:[], removed:[], deleted, created}) */
export function parseDiff(text) {
  const files = new Map();
  let cur = null; let oldPath = null; let remOld = 0; let remNew = 0;
  for (const line of String(text || '').split('\n')) {
    if (remOld > 0 || remNew > 0) {
      const c = line[0];
      if (c === '+' && remNew > 0) { cur?.added.push(line.slice(1)); remNew--; continue; }
      if (c === '-' && remOld > 0) { cur?.removed.push(line.slice(1)); remOld--; continue; }
      if (c === ' ') { remOld--; remNew--; continue; }
      if (c === '\\') continue;
      remOld = 0; remNew = 0;
    }
    if (line.startsWith('diff --git ')) { cur = null; oldPath = null; continue; }
    if (line.startsWith('--- ')) { oldPath = unquote(line.slice(4)); continue; }
    if (line.startsWith('+++ ')) {
      const np = unquote(line.slice(4));
      const deleted = np === '/dev/null';
      const created = oldPath === '/dev/null';
      const name = posix((deleted ? oldPath : np).replace(/^[ab]\//, ''));
      cur = files.get(name) || { added: [], removed: [], deleted: false, created: false };
      cur.deleted = deleted; cur.created = created;
      files.set(name, cur);
      continue;
    }
    const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (m) { remOld = m[1] === undefined ? 1 : Number(m[1]); remNew = m[2] === undefined ? 1 : Number(m[2]); }
  }
  return files;
}

/** diff text for a file git does not know yet (every line added) */
export function syntheticAddDiff(path, content) {
  const lines = String(content).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n`;
}

// ------------------------------------------------------------------------------------------------ helpers
const count = (lines, re) => lines.reduce((n, l) => n + (l.match(re) || []).length, 0);
const ruleId = (front) => String(front.rule || '');
export const isChoreRule = (rule) => rule === 'reach-07' || rule.startsWith('tc-');

/** conventional-commit type for a set of findings (doc 03 H3) */
export function commitType(findings) {
  const rules = findings.map((f) => ruleId(f.front));
  if (rules.length && rules.every(isChoreRule)) return 'chore';
  if (findings.length && findings.every((f) => String(f.front.wave) === 'R0')) return 'style';
  return 'refactor';
}

/** strip comments and string contents so keywords in prose do not count as control flow */
function codeOnly(line) {
  const t = line.trim();
  if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
}
const ASSERTION = /\b(?:expect|assert)\w*\s*[.(]|\bassert\b|\.(?:toBe|toEqual|toStrictEqual|toMatch\w*|toThrow\w*|toContain\w*|toHaveBeenCalled\w*|toBe\w+)\b|(?:^|[^\w.$])(?:it|test)(?:\.\w+)?\s*\(/;
const CONTROL_FLOW = /\b(?:if|for|while|catch)\b|\?\?|&&/;

// ------------------------------------------------------------------------------------------------ the policy
/**
 * @param {object} a
 * @param {string} a.root
 * @param {object} a.run            run.json
 * @param {{id:string, front:object}[]} a.findings   the named findings
 * @param {{status:string, path:string, from?:string}[]} a.changed   porcelain entries, .ts-optimize/ excluded
 * @param {object} a.config         loadConfig().config
 * @param {object} a.detect         detect() result (pm, packs)
 * @param {string} [a.diffText]     unified diff of the change set; edit patterns and semantic checks are skipped without it
 * @param {string[]} [a.protectedGlobs]
 * @param {object} [a.check]        {fingerprint, new_errors:[], passed}; omit to skip rule 3 (the CLI evaluates it second, because a check costs seconds)
 * @param {string} [a.fingerprint]  current worktree fingerprint, compared with check.fingerprint
 * @param {object} [a.lock]         plan.lock.json (approved + amendments)
 * @param {Set<string>} [a.wavesWithWork]  waves that have approved findings; an earlier wave without work needs no green gate
 * @param {Map<string,object>} [a.rules]   catalog rules (default: the shipped catalog)
 * @returns {{ok:boolean, violations:{rule:string, detail:string, paths?:string[]}[]}}
 */
export function checkCommitPolicy({ root, run, findings, changed, config, detect, diffText, protectedGlobs = [], check, fingerprint, lock = null, wavesWithWork = null, rules = null }) {
  void root;
  const violations = [];
  const v = (rule, detail, paths) => violations.push(paths && paths.length ? { rule, detail, paths } : { rule, detail });
  const catalog = rules || loadRules();
  const cfg = config || {};
  const commitCfg = cfg.commit || {};
  const ids = findings.map((f) => f.id);
  const ruleIds = [...new Set(findings.map((f) => ruleId(f.front)))];

  // (1) run state, eligibility, wave order
  const cur = run?.applying?.wave ?? null;
  if (run?.state !== 'applying') v('precondition', `run ${run?.id} is ${run?.state}; commits need an applying run (ts-opt run wave begin <id>)`);
  else if (cur === null) v('precondition', 'no wave is in progress (ts-opt run wave begin <id>)');
  if (!findings.length) v('precondition', 'no findings named');
  const lockIds = lock ? new Set([...(lock.approved || []), ...(lock.amendments || []).flatMap((a) => a.ids || [])]) : null;
  const waves = run?.waves || [];
  for (const { id, front } of findings) {
    const bad = [];
    if (front.verdict !== 'confirmed') bad.push(`verdict is ${front.verdict}`);
    if (front.state !== 'approved') bad.push(`state is ${front.state}, needs approved`);
    if (front.confidence === 'speculative') bad.push('confidence is speculative');
    if (front.fix_mode === 'flag-only') bad.push('fix_mode is flag-only');
    if (lockIds && !lockIds.has(id)) bad.push('not in plan.lock.json (approve it with ts-opt plan amend)');
    if (front.wave === null || front.wave === undefined) bad.push('has no wave');
    else if (cur !== null && waveIdx(front.wave) > waveIdx(cur)) bad.push(`belongs to wave ${front.wave}, the current wave is ${cur}`);
    else if (cur !== null && waveIdx(front.wave) < waveIdx(cur)) {
      const w = waves.find((x) => String(x.id) === String(front.wave));
      if (!w || w.gate?.passed !== true) bad.push(`belongs to earlier wave ${front.wave} whose gate is not green`);
    }
    if (bad.length) v('precondition', `${id}: ${bad.join('; ')}`);
  }
  if (cur !== null) {
    for (const w of waves) {
      if (waveIdx(w.id) >= waveIdx(cur) || w.status === 'skipped' || (w.late && w.status !== 'gated')) continue; // a repeat-pass wave that has not run yet is queued behind the regular ones
      if (wavesWithWork && !wavesWithWork.has(String(w.id))) continue;
      if (w.gate?.passed !== true) v('precondition', `earlier wave ${w.id} has no green gate; waves run in causal order (the first wave of a run is exempt)`);
    }
  }
  if (new Set(findings.map((f) => String(f.front.wave))).size > 1) v('precondition', `findings span several waves (${[...new Set(findings.map((f) => f.front.wave))].join(', ')}); commit them separately`);
  if (findings.length > 1) {
    const waveId = String(findings[0].front.wave);
    const bulk = waveId === 'R0' || waveId === 'B';
    const sameRule = ruleIds.length === 1;
    const lowRisk = findings.every((f) => f.front.fix_risk === 'low');
    const max = Number(commitCfg.batch_max) || 25;
    if (waveId === 'R0') { if (!sameRule) v('precondition', 'wave R0 commits are one lint autofix per rule; found rules ' + ruleIds.join(', ')); }
    else if (!bulk) {
      if (commitCfg.granularity !== 'batched') v('precondition', `commit.granularity is "finding": one finding per commit (got ${ids.join(', ')})`);
      else {
        if (!sameRule) v('precondition', `batched commits need one rule (got ${ruleIds.join(', ')})`);
        if (!lowRisk) v('precondition', 'batched commits take low fix_risk findings only');
        if (findings.length > max) v('precondition', `${findings.length} findings exceed commit.batch_max ${max}`);
      }
    }
  }

  // (2) scope: changed paths within the union of touches (+ lockfile / package.json for reach-07 and tc-*)
  const allowed = new Set();
  for (const { front } of findings) for (const t of front.touches || []) { const p = posix(t); allowed.add(p); allowed.add('.quarantine/' + p); }
  const wantsManifest = ruleIds.some(isChoreRule);
  const pm = detect?.pm?.name;
  const lockNames = new Set(wantsManifest ? (LOCKFILES[pm] ? LOCKFILES[pm] : Object.values(LOCKFILES).flat()) : []);
  const inScope = (p) => {
    const q = posix(p);
    if (allowed.has(q)) return true;
    for (const a of allowed) if (a.endsWith('/') && q.startsWith(a)) return true;
    const base = q.split('/').pop();
    return wantsManifest && (base === 'package.json' || lockNames.has(base));
  };
  const outside = [];
  for (const c of changed) for (const p of [c.path, c.from]) if (p && !inScope(p) && !outside.includes(posix(p))) outside.push(posix(p));
  if (outside.length) v('scope', `${outside.length} changed path(s) are outside the named findings' touches; add a finding (ts-opt proposal add) or revert them`, outside);

  // (3) fast check at the current worktree fingerprint
  if (check !== undefined) {
    if (!check) v('precondition', 'no fast-check result for the current worktree; run ts-opt check');
    else if (fingerprint && check.fingerprint !== fingerprint) v('precondition', 'the fast-check result is for a different worktree state; run ts-opt check again');
    else if (check.passed === false || (check.new_errors || []).length) {
      const errs = check.new_errors || [];
      v('precondition', `fast check found ${errs.length} new diagnostic(s): ${errs.slice(0, 5).map((e) => `${e.file}(${e.line}) ${e.code}`).join('; ')}${errs.length > 5 ? '; …' : ''}`);
    }
  }

  // (4) protected paths (deletion or rename) and worker edit patterns
  const allTc = ruleIds.length > 0 && ruleIds.every((r) => r.startsWith('tc-'));
  const globs = [...new Set([...protectedGlobs, ...(cfg.protected || [])])].filter((g) => !(allTc && /(^|\/)(tsconfig|jsconfig|wrangler)/.test(g)));
  const isProtected = (p) => globs.some((g) => matchGlob(g, p));
  const gone = [];
  for (const c of changed) {
    const dead = c.from || (c.status.includes('D') ? c.path : null);
    if (dead && isProtected(posix(dead)) && !gone.includes(posix(dead))) gone.push(posix(dead));
  }
  if (gone.length) v('protected-path', `protected path(s) deleted or renamed: ${gone.join(', ')}`, gone);

  const diff = diffText ? parseDiff(diffText) : null;
  const variants = (detect?.packs || []).find((p) => p.name === 'workerd')?.variants || [];
  if (diff && variants.length) {
    const under = (file) => variants.find((x) => x.dir === '.' || file === x.dir || file.startsWith(x.dir + '/'));
    for (const [file, d] of diff) {
      const variant = under(file);
      if (!variant || !CODE_FILE.test(file)) continue;
      const dec = count(d.removed, /\bctx\.waitUntil\(/g) - count(d.added, /\bctx\.waitUntil\(/g);
      if (dec > 0) v('edit-pattern', `${file}: ctx.waitUntil( occurrences decrease by ${dec} without an equal increase (fire-and-forget work would be cancelled when the response returns)`, [file]);
      if (variant.process_env_populated !== true) {
        const inc = count(d.added, /\bprocess\.env\b/g) - count(d.removed, /\bprocess\.env\b/g);
        if (inc > 0) v('edit-pattern', `${file}: adds process.env in a worker whose runtime does not populate it (process_env_populated=${variant.process_env_populated}); use the env binding`, [file]);
      }
      const isEntry = (variant.entry_files || []).includes(file);
      if (isEntry) {
        if (count(d.removed, /\bexport\s+default\b/g) > count(d.added, /\bexport\s+default\b/g)) v('edit-pattern', `${file}: removes \`export default\` from the worker entry`, [file]);
        const handler = /^\s*(?:async\s+)?(?:fetch|scheduled|queue|email|tail)\s*\(/;
        if (d.removed.filter((l) => handler.test(l)).length > d.added.filter((l) => handler.test(l)).length) v('edit-pattern', `${file}: removes a handler method (fetch|scheduled|queue|email|tail) from the worker entry`, [file]);
      }
      if (count(d.removed, /from\s+['"]cloudflare:(?:workers|test)['"]/g) > count(d.added, /from\s+['"]cloudflare:(?:workers|test)['"]/g)) v('edit-pattern', `${file}: removes an import from cloudflare:workers / cloudflare:test`, [file]);
    }
  }

  // (5) high-risk findings need all three triage answers and evidence
  for (const { id, front } of findings) {
    if (front.fix_risk !== 'high') continue;
    const t = front.triage || {};
    const missing = ['framework_lifecycle', 'dynamic_invocation', 'public_contract'].filter((k) => t[k] === undefined || t[k] === null || t[k] === '');
    const ev = Array.isArray(t.evidence) ? t.evidence.filter(Boolean) : [];
    if (missing.length || !ev.length) v('risk-evidence', `${id} is fix_risk high: needs all three triage answers${missing.length ? ` (missing ${missing.join(', ')})` : ''} and at least one evidence entry${ev.length ? '' : ' (none recorded)'}`);
  }

  // (5b) the gate may never be bent: no net new suppression directives; the lint bridge never removes an export (that is wave 3's decision)
  if (diff) {
    const SUPPRESS = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|biome-ignore|oxlint-disable/g;
    const grew = [];
    for (const [file, d] of diff) if (CODE_FILE.test(file) && count(d.added, SUPPRESS) > count(d.removed, SUPPRESS)) grew.push(file);
    if (grew.length) v('suppression', `adds suppression directives (@ts-ignore, @ts-expect-error, eslint-disable, biome-ignore …); a red gate is never fixed by hiding the diagnostic`, grew);
    if (ruleIds.includes('reach-06')) {
      const lost = [];
      for (const [file, d] of diff) if (count(d.removed, /^\s*export\b/g) > count(d.added, /^\s*export\b/g)) lost.push(file);
      if (lost.length) v('edit-pattern', `the lint bridge removed an exported declaration; un-exporting and deleting exports belongs to wave 3, restore the export`, lost);
    }
  }

  // (6) semantics-preserving rules (doc 06 §6)
  const semantic = findings.filter((f) => catalog.get?.(ruleId(f.front))?.semantic_invariance === true);
  if (semantic.length && diff) {
    const touched = [...diff.keys()];
    const unit = 5 * semantic.length;
    if (touched.length > unit) v('semantic-invariance', `${touched.length} files changed; a refactor unit is at most 5 files (split into sequential findings)`, touched);
    const assertions = [];
    for (const [file, d] of diff) {
      if (!TEST_FILE.test(file)) continue;
      const hits = [...d.removed, ...d.added].filter((l) => ASSERTION.test(l));
      if (hits.length) assertions.push(`${file}: ${hits.slice(0, 2).map((l) => l.trim().slice(0, 80)).join(' | ')}`);
    }
    if (assertions.length) v('semantic-invariance', `test assertion lines changed (a changed expectation is a redesign, not a refactor): ${assertions.join('; ')}`, assertions.map((a) => a.split(':')[0]));
    if (!semantic.every((f) => f.front.allows_new_control_flow === true)) {
      const moved = new Map();
      for (const d of diff.values()) for (const l of d.removed) { const k = l.trim(); moved.set(k, (moved.get(k) || 0) + 1); }
      const flow = [];
      for (const [file, d] of diff) {
        if (!CODE_FILE.test(file)) continue;
        for (const l of d.added) {
          const k = l.trim();
          if (moved.get(k) > 0) { moved.set(k, moved.get(k) - 1); continue; } // a moved line is not new control flow
          if (CONTROL_FLOW.test(codeOnly(l))) flow.push(`${file}: ${k.slice(0, 80)}`);
        }
      }
      if (flow.length) v('semantic-invariance', `added control flow (if/for/while/catch, ??, &&) in a semantics-preserving refactor; set allows_new_control_flow: true on the finding only if the design calls for it: ${flow.slice(0, 5).join(' | ')}${flow.length > 5 ? ` (+${flow.length - 5} more)` : ''}`, [...new Set(flow.map((x) => x.split(': ')[0]))]);
    }
  }
  return { ok: violations.length === 0, violations };
}
