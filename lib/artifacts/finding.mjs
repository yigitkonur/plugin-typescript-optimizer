// Finding files: YAML-subset front matter + fixed body sections (doc 04 §3).
import { readFileSync } from 'node:fs';
import { splitFrontMatter, stringifyYaml } from '../core/yaml-subset.mjs';
import { writeAtomic } from '../core/fs.mjs';

export const FINDING_KEYS = ['schema', 'id', 'fingerprint', 'run', 'rule', 'rule_version', 'domain', 'batch', 'wave', 'severity', 'fix_risk', 'confidence', 'recommendation', 'verdict', 'state', 'fix_mode', 'engines', 'package', 'location', 'members', 'touches', 'depends_on', 'origin', 'triage', 'suppressed_by', 'superseded_by', 'applied', 'verified_on', 'candidate_fingerprints'];

export function renderFinding(front, body) {
  return '---\n' + stringifyYaml(front, { keyOrder: FINDING_KEYS }) + '---\n' + body.replace(/\s+$/, '') + '\n';
}
export function writeFinding(file, front, body) { writeAtomic(file, renderFinding(front, body)); }

export function readFinding(file) {
  const t = readFileSync(file, 'utf8');
  const { data, body } = splitFrontMatter(t);
  const sections = {};
  let cur = null;
  for (const line of body.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { cur = m[1]; sections[cur] = []; } else if (cur) sections[cur].push(line);
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].join('\n').trim();
  return { front: data, body, sections };
}

// fence longer than any backtick run in the data, so a snippet can never close it
export function fenced(text, lang = 'ts') {
  const runs = (text.match(/`+/g) || []).map((r) => r.length);
  const fence = '`'.repeat(Math.max(3, ...runs.map((n) => n + 1)));
  return `${fence}${lang}\n${text}\n${fence}`;
}
// strip control characters and cap, so artifacts stay plain text
export const clean = (s, n = 400) => String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, n);

export function fillTemplate(tpl, f) {
  const sub = {
    file: f.location.file, symbol: f.location.symbol || f.location.file, members: (f.members || []).map((m) => m.symbol || m.line).join(', ') || f.location.symbol || '',
    touches: f.touches.join(', '), consumers: f.touches.filter((t) => t !== f.location.file).join(', ') || '(none recorded)', package: f.package,
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in sub ? sub[k] : m));
}
