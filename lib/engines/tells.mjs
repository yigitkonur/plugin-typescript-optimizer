// Tier-1 regex tells (doc 05 §7, doc 06 §8/§14). The engine locates, the agent judges: every hit is a *candidate*.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { compileGlob } from '../core/glob.mjs';
import { SFC_EXT, hasGeneratedMarker, isGeneratedPath, isTestPath, packageOf } from '../detect/classify.mjs';
import { extractScripts, lineAt, lineStarts, maskSource } from './mask.mjs';

const MAX_BYTES = 1024 * 1024;
const MAX_PER_RULE_FILE = 100;
const CONCURRENCY = 64;

function compileTells(rules) {
  const out = [];
  for (const rule of rules) {
    for (const t of rule.tells || []) {
      let re;
      try { re = new RegExp(t.regex, 'g' + String(t.flags || '').replace(/[^imsu]/g, '')); } catch { continue; }
      out.push({
        rule, tell: t, re, scan: t.scan || 'code',
        globs: (t.glob && t.glob.length ? t.glob : ['**/*']).map((g) => compileGlob(g, { dot: true })),
        excludes: (t.exclude || []).map((g) => compileGlob(g, { dot: true })),
      });
    }
  }
  return out;
}

const snippetOf = (text, starts, line) => {
  const from = starts[line - 1]; const to = starts[Math.min(line + 4, starts.length - 1)] ?? text.length;
  return text.slice(from, to).replace(/\s+$/, '').slice(0, 400);
};

/**
 * runTells({root, files, rules, packages}) -> {candidates, stats}
 * files: repo-relative posix paths. rules: loaded rule objects (only those with tells are used).
 */
export async function runTells({ root, files, rules, packages = [], skipGenerated = true }) {
  const compiled = compileTells(rules);
  const stats = { files_scanned: 0, files_skipped: 0, hits: 0, errors: 0 };
  if (!compiled.length) return { candidates: [], stats };
  const candidates = [];
  const perRuleTotal = new Map();

  const scanOne = async (file) => {
    // single-file components are TypeScript for glob purposes (their <script> blocks are scanned)
    const vfile = SFC_EXT.test(file) ? file.replace(SFC_EXT, '.ts') : file;
    const applicable = compiled.filter((c) => c.globs.some((g) => g.test(vfile)) && !c.excludes.some((g) => g.test(vfile)));
    if (!applicable.length) return;
    let raw;
    try {
      raw = await readFile(join(root, file), 'utf8');
    } catch { stats.errors++; return; }
    if (raw.length > MAX_BYTES || raw.slice(0, 8000).includes('\0')) { stats.files_skipped++; return; }
    const generated = isGeneratedPath(file) || hasGeneratedMarker(raw.slice(0, 400));
    if (generated && skipGenerated) { stats.files_skipped++; return; }
    stats.files_scanned++;
    const ext = extname(file);
    let text = raw;
    if (SFC_EXT.test(file)) { text = extractScripts(raw, ext); if (text === null) return; }
    const starts = lineStarts(raw);
    let masks = null;
    const pkg = packageOf(file, packages);
    const test = isTestPath(file);
    const seen = new Map();
    for (const c of applicable) {
      let hay = text;
      if (c.scan !== 'raw') { masks ||= maskSource(text); hay = c.scan === 'comments' ? masks.comments : masks.code; }
      c.re.lastIndex = 0;
      let m; let n = 0;
      while ((m = c.re.exec(hay)) !== null) {
        if (m[0] === '') { c.re.lastIndex++; continue; }
        const line = lineAt(starts, m.index);
        const key = `${c.rule.id}:${line}`;
        const prev = seen.get(key);
        if (prev) { if (!prev.tells.includes(c.tell.id)) prev.tells.push(c.tell.id); }
        else {
          const lineStart = starts[line - 1];
          const cand = {
            schema: 'ts-optimize/candidate@1', rule: c.rule.id, domain: c.rule.domain, engine: `tells:${c.tell.id}`, package: pkg,
            file, line, col: m.index - lineStart + 1, symbol: null, grain: c.rule.grain || 'symbol',
            snippet: snippetOf(raw, starts, line), match: m[0].slice(0, 120), tells: [c.tell.id],
            severity_hint: c.rule.severity, batch: c.rule.batch ?? null, wave: c.rule.wave ?? null, fix_mode_hint: c.rule.fix_mode_by_tell?.[c.tell.id] ?? c.rule.fix_mode,
            consumers: [], triage: c.rule.triage || 'agent', path_class: test ? 'test' : 'source',
          };
          seen.set(key, cand);
          candidates.push(cand);
          stats.hits++;
        }
        if (++n >= MAX_PER_RULE_FILE) break;
      }
    }
    for (const cand of seen.values()) perRuleTotal.set(cand.rule, (perRuleTotal.get(cand.rule) || 0) + 1);
  };

  for (let i = 0; i < files.length; i += CONCURRENCY) await Promise.all(files.slice(i, i + CONCURRENCY).map(scanOne));
  candidates.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
  return { candidates, stats };
}
