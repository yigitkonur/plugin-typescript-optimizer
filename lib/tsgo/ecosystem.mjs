// Ecosystem scan (doc 05 §7/§8.3 step 4): dependency names, package.json scripts, config files and JS-compiler-API imports
// matched against catalog/ecosystem-compat.json. Pure over text; the caller reads files.
import { coerce, satisfies } from '../core/semver.mjs';
import { extractImports, packageOfSpecifier } from './imports.mjs';
import { lineText, parseLocated, prop } from './jsonloc.mjs';

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** config files whose text is searched with `script_patterns` (runners are wired in through these, not through imports) */
export const RUNNER_CONFIG_RE = /(^|\/)(\.mocharc(\.[a-z]+)?|jest\.config\.[cm]?[jt]s|jest\.config\.json|webpack\.config\.[cm]?[jt]s|nodemon\.json|\.swcrc|babel\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|package\.json)$/;

function resolveEntry(entry, version) {
  if (!entry.version_rules) return entry;
  const v = coerce(version || '');
  const rule = v ? entry.version_rules.find((r) => satisfies(v, r.range)) : null;
  if (!rule) return { ...entry, status: 'unknown-version', broken: false, status_text: `${entry.tool}: version not determinable` };
  return { ...entry, status: rule.status, broken: rule.broken, status_text: rule.status_text, remedy: rule.remedy, basis: rule.basis };
}

/**
 * matchEcosystem({manifests, sources, configs, data, versionOf, legs})
 *  manifests: [{file, text, package}]   package.json files (package = TS package path they belong to)
 *  sources:   [{file, text, package}]   JS/TS source files (imports are extracted)
 *  configs:   [{file, text, package}]   runner config files searched with script_patterns
 *  versionOf(name, manifestFile) -> installed or declared version string | null
 *  legs: Set of gate leg ids present in the repo ('lint', 'test', 'build'…)
 * -> hits [{id, tool, rule, status, status_text, broken, remedy, basis, severity, package, bridge, evidence:[{kind,file,line,snippet,detail}]}]
 * One hit per (entry, package); evidence is capped by the caller when rendering.
 */
export function matchEcosystem({ manifests = [], sources = [], configs = [], data, versionOf: versionOfRaw = () => null, legs = new Set() }) {
  const versionOf = (name, file) => (name ? versionOfRaw(name, file) : null); // entries such as the bare `typescript` import have no dependency name
  const entries = data?.entries || [];
  const byPkg = new Map(); // `${entry.id}\0${package}` -> hit
  const hit = (entry, pkg, version) => {
    const k = `${entry.id}\0${pkg}`;
    let h = byPkg.get(k);
    if (!h) {
      const r = resolveEntry(entry, version);
      h = {
        id: entry.id, tool: entry.tool, rule: entry.rule ?? null, status: r.status, status_text: r.status_text, broken: !!r.broken, remedy: r.remedy ?? null,
        basis: r.basis ?? null, bridge: entry.bridge || 'none', leg: entry.leg || null, package: pkg, version: version || null,
        severity: r.broken ? (entry.leg && legs.has(entry.leg) ? 'hard' : 'warn') : 'advisory', evidence: [],
      };
      byPkg.set(k, h);
    }
    return h;
  };
  const byDep = new Map();
  for (const e of entries) for (const p of e.packages || []) byDep.set(p, e);

  for (const m of manifests) {
    const root = parseLocated(m.text);
    if (!root || root.type !== 'object') continue;
    for (const sec of DEP_SECTIONS) {
      const node = prop(root, sec)?.node;
      if (!node || node.type !== 'object') continue;
      for (const [name, p] of node.props) {
        const e = byDep.get(name);
        if (!e) continue;
        const version = versionOf(name, m.file) || (p.node.type === 'string' ? p.node.value : null);
        const h = hit(e, m.package, version);
        h.evidence.push({ kind: 'dependency', file: m.file, line: p.line, snippet: lineText(m.text, p.line), detail: `${name}@${p.node.type === 'string' ? p.node.value : '?'} (${sec})`, key: name });
      }
    }
    const scripts = prop(root, 'scripts')?.node;
    if (scripts && scripts.type === 'object') {
      for (const [sname, p] of scripts.props) {
        if (p.node.type !== 'string') continue;
        for (const e of entries) for (const pat of e.script_patterns || []) {
          if (!new RegExp(pat).test(p.node.value)) continue;
          const h = hit(e, m.package, versionOf((e.packages || [])[0], m.file));
          h.evidence.push({ kind: 'script', file: m.file, line: p.line, snippet: lineText(m.text, p.line), detail: `scripts.${sname}` });
        }
      }
    }
  }
  for (const c of configs) {
    if (/(^|\/)package\.json$/.test(c.file)) continue; // scripts already handled
    const lines = c.text.split(/\r?\n/);
    for (const e of entries) for (const pat of e.script_patterns || []) {
      const re = new RegExp(pat);
      const i = lines.findIndex((l) => re.test(l) && !/^\s*(\/\/|\*|#)/.test(l));
      if (i < 0) continue;
      const h = hit(e, c.package, versionOf((e.packages || [])[0], c.file));
      h.evidence.push({ kind: 'config', file: c.file, line: i + 1, snippet: lines[i].trim().slice(0, 300), detail: 'runner config' });
    }
  }
  const byImport = new Map();
  for (const e of entries) for (const s of e.imports || []) byImport.set(s, e);
  if (byImport.size) {
    for (const s of sources) {
      for (const imp of extractImports(s.text)) {
        const e = byImport.get(packageOfSpecifier(imp.spec));
        if (!e) continue;
        const h = hit(e, s.package, versionOf((e.packages || [])[0], s.file));
        h.evidence.push({ kind: 'import', file: s.file, line: imp.line, snippet: lineText(s.text, imp.line), detail: imp.spec });
      }
    }
  }
  const out = [...byPkg.values()];
  for (const h of out) h.evidence.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return out.sort((a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
}
