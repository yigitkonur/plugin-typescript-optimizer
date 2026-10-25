#!/usr/bin/env node
// Automatic release for a Claude Code plugin repo: run by CI on every green push to the default branch.
//   node .github/scripts/release.mjs [--dry-run]
// 1. Find the last release tag (<prefix>X.Y.Z). 2. If a user-facing file changed since it, pick the bump from the commit subjects
// (feat → minor, breaking → minor while 0.x else major, anything else → patch), rewrite the version in every manifest, put a section
// into CHANGELOG.md, commit "chore(release): …", tag, push and create the GitHub release. 3. A version somebody already raised by
// hand (manifest ahead of the tag) is released as it is. Docs/tests/CI-only changes release nothing.
// Config: .github/release.json  { "plugin": "ts-optimize", "tagPrefix": "ts-optimize--v", "manifests": [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"], "ignore": ["regex", ...] }
// Zero dependencies; Node >= 18.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();
const git = (...a) => sh('git', a);

const cfg = JSON.parse(readFileSync('.github/release.json', 'utf8'));
const IGNORE = [
  /^\.github\//, /^docs\//, /^tests?\//, /^evals?\//, /^README/i, /^CHANGELOG/i, /^LICENSE/i, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^\.gitignore$/, /^\.gitattributes$/,
  ...(cfg.ignore || []).map((r) => new RegExp(r)),
];
const semver = (v) => String(v).split('.').map(Number);
const cmp = (a, b) => { const [x, y] = [semver(a), semver(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const log = (m) => console.log(`[release] ${m}`);
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

const versionOf = (file) => JSON.parse(readFileSync(file, 'utf8')).version ?? JSON.parse(readFileSync(file, 'utf8')).metadata?.version;
const cur = versionOf(cfg.manifests[0]);
if (!/^\d+\.\d+\.\d+$/.test(cur || '')) throw new Error(`${cfg.manifests[0]}: version "${cur}" is not X.Y.Z`);

const tags = git('tag', '--list', `${cfg.tagPrefix}*`).split('\n').filter(Boolean).map((t) => t.slice(cfg.tagPrefix.length)).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(cmp);
const last = tags.at(-1) || null;
log(`manifest ${cur}, last tag ${last ? cfg.tagPrefix + last : '(none)'}`);

let next = null; let notes = null;
if (last === null || cmp(cur, last) > 0) {
  next = cur; // the version was raised by hand: release exactly that
  notes = null;
  log(`manifest is ahead of the last tag: releasing ${next} as it is`);
} else {
  const base = `${cfg.tagPrefix}${last}`;
  const files = git('diff', '--name-only', `${base}..HEAD`).split('\n').filter(Boolean);
  const facing = files.filter((f) => !IGNORE.some((r) => r.test(f)));
  if (!facing.length) { log(`no user-facing change since ${base} (${files.length} file(s), all docs/tests/CI): nothing to release`); out('released', 'false'); process.exit(0); }
  const subjects = git('log', '--no-merges', '--format=%s', `${base}..HEAD`).split('\n').filter((s) => s && !/^chore\(release\)/.test(s));
  const breaking = subjects.some((s) => /^\w+(\([^)]*\))?!:/.test(s)) || git('log', '--format=%B', `${base}..HEAD`).includes('BREAKING CHANGE');
  const feat = subjects.some((s) => /^feat(\([^)]*\))?:/.test(s));
  const [maj, min, pat] = semver(cur);
  const level = breaking ? (maj === 0 ? 'minor' : 'major') : feat ? 'minor' : 'patch';
  next = level === 'major' ? `${maj + 1}.0.0` : level === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
  log(`${facing.length} user-facing file(s) changed (${facing.slice(0, 5).join(', ')}${facing.length > 5 ? ', …' : ''}); ${level} bump → ${next}`);
  const group = { Added: [], Fixed: [], Changed: [] };
  for (const s of subjects) {
    const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s);
    const [type, text] = m ? [m[1], m[2]] : ['', s];
    if (/^(docs|test|tests|ci|ledger|style|build)$/.test(type)) continue; // not something a user of the plugin sees
    (type === 'feat' ? group.Added : type === 'fix' ? group.Fixed : group.Changed).push(text.replace(/^./, (c) => c.toUpperCase()));
  }
  notes = Object.entries(group).filter(([, v]) => v.length).map(([k, v]) => `### ${k}\n\n${v.map((x) => `- ${x}`).join('\n')}`).join('\n\n');
}

if (DRY) { log(`dry run: would release ${cfg.tagPrefix}${next}${notes ? `\n${notes}` : ''}`); process.exit(0); }

if (next !== cur) {
  for (const f of cfg.manifests) {
    const text = readFileSync(f, 'utf8');
    const re = new RegExp(`("version"\\s*:\\s*")${cur.replace(/\./g, '\\.')}(")`, 'g');
    const n = (text.match(re) || []).length;
    if (!n) throw new Error(`${f}: no "version": "${cur}" to replace`);
    writeFileSync(f, text.replace(re, `$1${next}$2`));
  }
  for (const f of cfg.manifests) if (versionOf(f) !== next) throw new Error(`${f}: version is not ${next} after the bump`);
}
const date = new Date().toISOString().slice(0, 10);
if (notes && existsSync('CHANGELOG.md')) {
  const md = readFileSync('CHANGELOG.md', 'utf8');
  const at = md.search(/^## /m);
  const section = `## ${next} - ${date}\n\n${notes}\n\n`;
  writeFileSync('CHANGELOG.md', at < 0 ? `${md.trimEnd()}\n\n${section}` : md.slice(0, at) + section + md.slice(at));
}
let body = notes;
if (!body && existsSync('CHANGELOG.md')) {
  const m = new RegExp(`^## ${next.replace(/\./g, '\\.')}\\b.*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(readFileSync('CHANGELOG.md', 'utf8'));
  body = m ? m[1].trim() : '';
}

const tag = `${cfg.tagPrefix}${next}`;
if (next !== cur || notes) {
  git('add', '-A');
  git('commit', '-m', `chore(release): ${cfg.plugin} v${next} [skip ci]`);
}
git('tag', tag);
try { git('push', 'origin', 'HEAD', tag); } catch {
  git('pull', '--rebase', 'origin', git('rev-parse', '--abbrev-ref', 'HEAD')); // main moved while CI ran
  git('tag', '-f', tag);
  git('push', 'origin', 'HEAD', tag);
}
sh('gh', ['release', 'create', tag, '--title', `${cfg.plugin} ${next}`, '--notes', `## ${cfg.plugin} ${next}\n\n${body || ''}`.trim(), '--latest']);
log(`released ${tag}`);
out('released', 'true'); out('version', next);
