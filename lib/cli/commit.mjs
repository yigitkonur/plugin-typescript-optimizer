// ts-opt commit <F-id…> [-m "summary"]: the only command that creates finding commits (doc 02 §3.3, doc 03 H3).
// Policy first (lib/gate/commit-policy.mjs), then exactly the changed paths are staged and committed with trailers.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFinding } from '../artifacts/finding.mjs';
import { loadConfig } from '../artifacts/config.mjs';
import { readRun, resolveRunId, runDir, stampLog, writeRun } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { readJsonc } from '../core/fs.mjs';
import { run as runProc } from '../core/proc.mjs';
import { protectedPaths } from '../detect/packs.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { loadRules } from '../catalog/index.mjs';
import { checkCommitPolicy, commitType, parseStatusZ, syntheticAddDiff } from '../gate/commit-policy.mjs';
import { worktreeFingerprint } from '../gate/fingerprint.mjs';
import { getFinding, listFindings } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { declarationPrecheck, reexpressKeepExport } from '../gate/precheck.mjs';
import { recordDivergence } from '../gate/divergence.mjs';

// `-m` is a short flag the shared parser does not know, so run() also reads it from the positionals.
export const spec = { m: 'string', message: 'string' };

const ID_RE = /^F-\d{4,}$/;
const PATH_CHUNK = 300;

export const git = (root, args, o = {}) => runProc(['git', '--literal-pathspecs', ...args], { cwd: root, timeoutMs: 60_000, maxBytes: 64 * 1024 * 1024, ...o });
export const gitOut = async (root, args) => { const r = await git(root, args); return r.code === 0 ? r.stdout.trim() : null; };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const tail = (s, n = 40) => String(s || '').trim().split('\n').slice(-n).join('\n').slice(-3000);

/** replace (or append) one `## <name>` section of a finding body; the last heading wins because the sections are in a fixed order and snippets come earlier */
export function setSection(body, name, text) {
  const head = `\n## ${name}`;
  const at = body.lastIndexOf(head);
  if (at < 0) return body.replace(/\s+$/, '') + `\n\n## ${name}\n\n${text}\n`;
  const next = body.indexOf('\n## ', at + head.length);
  return body.slice(0, at) + `\n## ${name}\n\n${text}\n` + (next < 0 ? '' : body.slice(next));
}
export function getSection(body, name) {
  const head = `\n## ${name}`;
  const at = body.lastIndexOf(head);
  if (at < 0) return '';
  const next = body.indexOf('\n## ', at + head.length);
  return body.slice(at + head.length, next < 0 ? undefined : next).trim();
}

function parseCommitArgs(args, flags) {
  const ids = []; let message = flags.m ?? flags.message ?? null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') { message = args[++i] ?? ''; continue; }
    if (a.startsWith('-m') && a.length > 2 && !a.startsWith('--')) { message = a.slice(2); continue; }
    if (ID_RE.test(a)) ids.push(a);
    else throw new TsOptError(EXIT.USAGE, `unexpected argument "${a}"`, 'usage: ts-opt commit F-0007 [F-0008 …] [-m "summary"]');
  }
  if (!ids.length) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt commit F-0007 [F-0008 …] [-m "summary"]');
  if (message !== null && !String(message).trim()) throw new TsOptError(EXIT.USAGE, '-m needs a non-empty summary');
  // the CLI adds `<type>(ts-optimize): `; a summary that already starts with a conventional-commit prefix would double it
  return { ids: [...new Set(ids)], message: message === null ? null : String(message).replace(/\s+/g, ' ').trim().replace(/^(?:chore|feat|fix|refactor|style|perf|test|docs|build|ci)(?:\([^)]*\))?!?:\s+/i, '').slice(0, 120) };
}

async function buildDiff(root, changed) {
  const tracked = changed.filter((c) => c.status !== '??');
  const paths = [...new Set(tracked.flatMap((c) => [c.path, c.from].filter(Boolean)))];
  let text = '';
  for (const part of chunks(paths, PATH_CHUNK)) {
    const r = await git(root, ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-renames', '-U0', '--', ...part]);
    if (r.code === 0) text += r.stdout;
  }
  for (const c of changed.filter((x) => x.status === '??')) {
    try {
      const abs = join(root, c.path);
      if (statSync(abs).size > 1_000_000) continue;
      const buf = readFileSync(abs);
      if (buf.includes(0)) continue;
      text += syntheticAddDiff(c.path, buf.toString('utf8'));
    } catch { /* vanished while we looked */ }
  }
  return text;
}

/** "native 7.0.2" from runCheck's {kind, version, ...} object or the stored "kind@version" string; the run's compiler snapshot fills a missing version */
function fastLabel(run, check) {
  let name; let version;
  if (check.engine && typeof check.engine === 'object') { name = check.engine.kind; version = check.engine.version; }
  else { [name, version] = String(check.engine || '').split('@'); }
  version = version && version !== '?' ? version : (check.version || null);
  if (!version) {
    const c = run.env?.compilers || {};
    version = (/native|tsgo/i.test(String(name)) ? c.fast?.version : c.authoritative?.version) || null;
  }
  return [name || 'check', version].filter(Boolean).join(' ');
}

function defaultSummary(findings, rules) {
  const names = [...new Set(findings.map((f) => String(rules.get(f.front.rule)?.name || f.front.rule).toLowerCase()))];
  const first = findings[0].front;
  const where = first.location?.file ? ` in ${first.location.file}${first.location.line ? ':' + first.location.line : ''}` : '';
  const more = findings.length > 1 ? ` (+${findings.length - 1} more)` : '';
  return `${names.join(', ')} (${[...new Set(findings.map((f) => f.front.rule))].join(', ')})${where}${more}`.slice(0, 120);
}

export async function run({ cwd, flags, args }, opts = {}) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const { ids, message } = parseCommitArgs(args, flags);
  return withRunLock(root, runId, 'commit', () => commit(root, runId, ids, message, opts));
}

async function commit(root, runId, ids, message, opts) {
  const run0 = readRun(root, runId);
  const { config } = loadConfig(root);
  const findings = ids.map((id) => getFinding(root, runId, id));

  if (run0.state === 'applying' && run0.applying?.branch) {
    const branch = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== run0.applying.branch) throw new TsOptError(EXIT.PRECONDITION, `on branch ${branch}, but run ${runId} applies on ${run0.applying.branch}`, `git switch ${run0.applying.branch}`);
  }
  const st = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (st.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `git status failed: ${tail(st.stderr, 3)}`);
  const changed = parseStatusZ(st.stdout);
  if (!changed.length && run0.state === 'applying') throw new TsOptError(EXIT.PRECONDITION, 'nothing to commit: the working tree has no changes outside .ts-optimize/', 'make the edit first, then run ts-opt commit');

  const d = await detectProject(root);
  const all = listFindings(root, runId);
  const lock = readJsonc(join(runDir(root, runId), 'plan.lock.json'));
  const lockDoc = lock.ok ? lock.value : null;
  const wavesWithWork = new Set();
  if (lockDoc) {
    const lockIds = new Set([...(lockDoc.approved || []), ...(lockDoc.amendments || []).flatMap((a) => a.ids || [])]);
    for (const f of all) if (lockIds.has(f.id) && f.front.wave != null) wavesWithWork.add(String(f.front.wave));
  }
  const rules = loadRules();
  const base = {
    root, run: run0, findings, changed, config, detect: d, lock: lockDoc, wavesWithWork, rules,
    diffText: await buildDiff(root, changed), protectedGlobs: d.typescript ? protectedPaths(root, d) : [],
  };

  // pass 1: everything that is cheap; a check costs seconds, so it only runs once the rest is clean
  const first = checkCommitPolicy(base);
  if (!first.ok) return refuse(ids, first.violations, changed);

  // export-pruning rules also have to survive declaration emit (typecheck alone cannot see a stripped public type)
  const pre = await (opts.precheck || declarationPrecheck)({ root, runId, findings, changed });
  if (pre.violations.length) {
    for (const f of findings) if (['reach-04', 'reach-05'].includes(String(f.front.rule))) reexpressKeepExport(root, runId, f.id, pre.violations);
    return refuse(ids, pre.violations, changed, { restore: [...new Set(changed.map((c) => c.path))] });
  }

  const fingerprint = await worktreeFingerprint(root);
  let check = null;
  const stored = readJsonc(join(root, '.ts-optimize', 'state', 'fast-check.json'));
  if (stored.ok && stored.value && stored.value.fingerprint === fingerprint && stored.value.passed !== false && !(stored.value.new_errors || []).length) {
    check = { ...stored.value, passed: true };
  } else {
    const runCheck = opts.runCheck || (await loadGate('check', 'runCheck'));
    const checkPaths = [...new Set(changed.flatMap((c) => [c.path, c.from].filter(Boolean)))];
    check = await runCheck({ root, runId, paths: checkPaths });
    // the authority decides: a fast-compiler failure the authoritative compiler does not reproduce is logged as a divergence and does not block
    if (!check.passed && check.engine?.kind === 'native' && run0.fast_check?.enabled !== false) {
      const auth = await runCheck({ root, runId, paths: checkPaths, authoritative: true });
      if (auth.passed && auth.engine?.bin !== check.engine?.bin) {
        recordDivergence(root, runId, { wave: String(findings[0].front.wave), fast: check.new_errors?.[0] ? `${check.new_errors[0].file}(${check.new_errors[0].line}) ${check.new_errors[0].code}` : null });
        check = { ...auth, fingerprint: check.fingerprint, divergence: true };
      }
    }
  }
  const second = checkCommitPolicy({ ...base, check, fingerprint });
  if (!second.ok) return refuse(ids, second.violations, changed);

  // stage exactly the changed paths, then commit with trailers; repo hooks run (never --no-verify unless configured)
  const paths = [...new Set(changed.flatMap((c) => [c.path, c.from].filter(Boolean)))];
  // a path that `git rm`/`git mv` already staged is gone from both index and worktree: `git add` would fail on it, and it needs no add
  const toAdd = [...new Set(changed.filter((c) => !(c.status[0] === 'D' && c.status[1] === ' ')).map((c) => c.path))];
  for (const part of chunks(toAdd, PATH_CHUNK)) {
    const r = await git(root, ['add', '-A', '--', ...part]);
    if (r.code !== 0) throw new TsOptError(EXIT.INTERNAL, `git add failed: ${tail(r.stderr, 5)}`);
  }
  const wave = String(findings[0].front.wave);
  const ruleList = [...new Set(findings.map((f) => String(f.front.rule)))];
  const type = commitType(findings);
  const fastLine = `pass (${fastLabel(run0, check)}, ${Math.round(check.ms ?? 0)}ms)`;
  const trailers = { Rule: ruleList, Finding: ids, Run: runId, Wave: wave, 'Fast-check': fastLine };
  const subject = `${type}(ts-optimize): ${message || defaultSummary(findings, rules)}`;
  const text = `${subject}\n\n${[...ruleList.map((r) => `Rule: ${r}`), ...ids.map((i) => `Finding: ${i}`), `Run: ${runId}`, `Wave: ${wave}`, `Fast-check: ${fastLine}`].join('\n')}\n`;
  const commitArgs = ['commit', '-F', '-'];
  if (config.commit?.no_verify === true) commitArgs.push('--no-verify');
  const c = await git(root, commitArgs, { input: text, timeoutMs: 600_000 });
  if (c.code !== 0) {
    const out = tail(`${c.stdout}\n${c.stderr}`);
    const staged = (await gitOut(root, ['diff', '--cached', '--name-only'])) || '';
    return {
      exit: EXIT.GATE,
      result: { committed: false, reason: 'git commit failed (a repo commit hook or git itself refused it)', output: out, ids, staged: staged.split('\n').filter(Boolean) },
      text: `git commit failed; nothing was recorded as applied and the files stay staged.\n${out}`,
      next_actions: [{ cmd: 'ts-opt commit ' + ids.join(' '), why: 'fix what the hook reported (the staged files are kept), then commit again; never bypass the hook' }],
    };
  }

  const sha = (await gitOut(root, ['rev-parse', 'HEAD'])) || '';
  const short = (await gitOut(root, ['rev-parse', '--short', 'HEAD'])) || sha.slice(0, 7);
  const dt = await git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', 'HEAD']);
  const files = dt.code === 0 ? dt.stdout.split('\0').filter(Boolean) : paths;
  const stat = ((await gitOut(root, ['show', '--shortstat', '--format=', 'HEAD'])) || '').trim();
  const at = nowIso();
  const appliedText = [`- commit: \`${short}\` (${subject})`, `- files: ${files.map((f) => '`' + f + '`').join(', ')}`, stat ? `- diff: ${stat}` : null, `- fast-check: ${fastLine}`, `- gate: pending (wave ${wave})`].filter(Boolean).join('\n');
  for (const f of findings) {
    const front = structuredClone(f.front);
    front.state = 'applied';
    front.applied = { commit: short, at }; // `gate` is set when the wave gate passes; the schema types it as a string, so no null placeholder
    let body = setSection(f.body, 'Applied', appliedText);
    const rb = getSection(body, 'Rollback');
    if (rb) body = setSection(body, 'Rollback', rb.replace('<commit>', short).replace(/\s*\(the commit is filled after apply\)/, ''));
    writeFinding(f.path, front, body);
  }
  const fresh = readRun(root, runId);
  if (fresh.applying) { fresh.applying.finding = null; writeRun(root, fresh); }
  const fingerprintAfter = await worktreeFingerprint(root);
  stampLog(root, runId, { ev: 'commit', ids, sha: short, wave, files, fingerprint, fingerprint_after: fingerprintAfter });

  const pending = listFindings(root, runId).filter((f) => f.front.state === 'approved' && String(f.front.wave) === wave).length;
  return {
    result: { sha: short, full_sha: sha, ids, files, trailers, subject },
    text: `committed ${short} ${subject}\n  ${ids.join(', ')} · ${files.length} file(s): ${files.slice(0, 6).join(', ')}${files.length > 6 ? ', …' : ''}\n  fast-check: ${fastLine}`,
    next_actions: pending ? [{ cmd: 'ts-opt findings list --wave ' + wave + ' --state approved', why: `${pending} approved finding(s) remain in wave ${wave}` }] : [{ cmd: `ts-opt gate --wave ${wave}`, why: `every approved finding of wave ${wave} is committed: run the wave gate` }],
  };
}

function refuse(ids, violations, changed, extra = {}) {
  const lines = violations.map((x) => `- [${x.rule}] ${x.detail}${x.paths ? `\n    ${x.paths.slice(0, 12).join('\n    ')}${x.paths.length > 12 ? `\n    … +${x.paths.length - 12} more` : ''}` : ''}`);
  return {
    exit: EXIT.GUARD,
    result: { committed: false, ids, violations, changed: changed.map((c) => c.path) },
    text: `ts-opt commit refused (${violations.length} violation(s)); nothing was staged or committed:\n${lines.join('\n')}`,
    next_actions: extra.restore
      ? [{ cmd: `undo your edit to ${extra.restore.join(', ')}`, why: 'the finding was recorded as "keep export" and skipped; continue with the next approved finding' }]
      : [{ cmd: 'ts-opt proposal add --origin fixer --parent ' + ids[0], why: 'a legitimate extra file or consumer needs its own approved finding; never widen the scope silently' }],
  };
}

async function loadGate(mod, fn) {
  try { return (await import(new URL(`../gate/${mod}.mjs`, import.meta.url).href))[fn]; }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND') throw new TsOptError(EXIT.INTERNAL, 'gate engine is not installed in this plugin build');
    throw e;
  }
}
export { loadGate };
