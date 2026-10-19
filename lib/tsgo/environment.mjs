// Environment scans for fit (rules tc-06, tc-07, tc-08): CI/container files, editor settings, project-reference readiness.
// Pure functions over text/objects; fit.mjs does the reading. Everything read here is data, never instructions.
import { lineText, parseLocated, prop, toValue } from './jsonloc.mjs';

export const CLAIM_NODE_OPTIONS = 'reported by the source skill; verify in your CI';

const CI_FILE = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/, /^\.github\/actions\/.+\/action\.ya?ml$/, /(^|\/)\.gitlab-ci\.ya?ml$/, /^\.gitlab\/.+\.ya?ml$/,
  /(^|\/)Dockerfile[^/]*$/, /(^|\/)[^/]+\.dockerfile$/, /(^|\/)(docker-)?compose[^/]*\.ya?ml$/, /^\.circleci\/config\.ya?ml$/,
  /(^|\/)azure-pipelines\.ya?ml$/, /(^|\/)bitbucket-pipelines\.ya?ml$/, /(^|\/)Jenkinsfile$/, /(^|\/)\.travis\.ya?ml$/,
  /(^|\/)wrangler\.(toml|jsonc?)$/, /(^|\/)netlify\.toml$/, /(^|\/)cloudbuild\.ya?ml$/, /(^|\/)buildspec\.ya?ml$/,
];
/** repo-relative path -> is it a CI/container/build-settings file fit reads for tc-06 */
export const isCiFile = (rel) => CI_FILE.some((re) => re.test(rel));

const WORKER_FLAG = /--(v8-pool-size|max-semi-space-size)\b/g;
const BLOCK_SCALAR = /[|>][+-]?\s*$/;

/**
 * Scan one CI/container/package.json text.
 * -> [{kind, file, line, snippet, severity, ...}] kinds: node-options-worker-flag | gomaxprocs | cpu-quota-without-gomaxprocs | npx-tsc | tsbuildinfo-cache
 * `file` may be 'package.json'-like: only NODE_OPTIONS in scripts is considered there (opts.manifest).
 */
export function scanCiText(file, text, { manifest = false } = {}) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const indent = (l) => /^\s*/.exec(l)[0].length;
  let sawGomax = false; let firstQuota = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#|\/\/)/.test(l)) continue;
    if (/NODE_OPTIONS/.test(l)) {
      const found = [];
      const scanLine = (s, at) => { WORKER_FLAG.lastIndex = 0; let m; while ((m = WORKER_FLAG.exec(s)) !== null) found.push({ flag: `--${m[1]}`, line: at }); };
      scanLine(l, i + 1);
      if (!found.length && BLOCK_SCALAR.test(l)) {
        const base = indent(l);
        for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > base); j++) scanLine(lines[j], j + 1);
      }
      if (found.length) {
        const byLine = new Map();
        for (const f of found) byLine.set(f.line, [...(byLine.get(f.line) || []), f.flag]);
        for (const [line, flags] of byLine) out.push({ kind: 'node-options-worker-flag', file, line, flags, snippet: lines[line - 1].trim().slice(0, 300), severity: 'advisory', claim: CLAIM_NODE_OPTIONS });
      }
    }
    if (manifest) continue;
    if (/\bGOMAXPROCS\b/.test(l)) {
      sawGomax = true;
      const m = /GOMAXPROCS['"]?\s*[:=]\s*['"]?(\d+)/.exec(l);
      out.push({ kind: 'gomaxprocs', file, line: i + 1, value: m ? Number(m[1]) : null, snippet: l.trim().slice(0, 300), severity: 'advisory' });
    }
    if (!firstQuota && (/--cpus[= ]\s*\d/.test(l) || /^\s*cpus:\s*['"]?\d/.test(l) || /\bcpu_quota\b/.test(l))) firstQuota = { line: i + 1, snippet: l.trim().slice(0, 300) };
    if (/\bnpx\s+(?:--?[\w-]+\s+)*tsc\b/.test(l)) out.push({ kind: 'npx-tsc', file, line: i + 1, snippet: l.trim().slice(0, 300), severity: 'advisory' });
    if (/tsbuildinfo/i.test(l) && /(cache|path|key|restore)/i.test(l)) out.push({ kind: 'tsbuildinfo-cache', file, line: i + 1, snippet: l.trim().slice(0, 300), severity: 'advisory' });
  }
  if (firstQuota && !sawGomax) out.push({ kind: 'cpu-quota-without-gomaxprocs', file, ...firstQuota, severity: 'advisory' });
  return out;
}

/** committed or stale *.tsbuildinfo. tracked: repo-relative paths in the git index; present: [{file, mtimeMs}] on disk; configMtimeMs: newest tsconfig mtime */
export function staleBuildInfo({ tracked = [], present = [], configMtimeMs = 0 }) {
  const out = tracked.map((file) => ({ kind: 'tsbuildinfo-committed', file, line: 1, snippet: file, severity: 'advisory' }));
  const t = new Set(tracked);
  for (const p of present) if (!t.has(p.file) && configMtimeMs && p.mtimeMs < configMtimeMs) out.push({ kind: 'tsbuildinfo-stale', file: p.file, line: 1, snippet: `${p.file} is older than the newest tsconfig`, severity: 'advisory' });
  return out;
}

/**
 * .vscode/settings.json -> findings. opts: { tsdkInfo(value)->{exists,version}|null, workspaceVersion }
 * kinds: tsdk-missing | tsdk-version-mismatch | no-workspace-tsdk-prompt | unsupported-key | usetsgo-enabled (info)
 */
export function scanEditorSettings(file, text, { tsdkInfo = () => null, workspaceVersion = null } = {}) {
  const out = [];
  const root = parseLocated(text);
  if (!root || root.type !== 'object') return out;
  const get = (k) => root.props.get(k) || null;
  const tsdk = get('typescript.tsdk');
  if (tsdk && tsdk.node.type === 'string') {
    const info = tsdkInfo(tsdk.node.value);
    if (info && info.exists === false) out.push({ kind: 'tsdk-missing', file, line: tsdk.line, snippet: lineText(text, tsdk.line), severity: 'advisory', detail: `typescript.tsdk "${tsdk.node.value}" does not exist` });
    else if (info && info.version && workspaceVersion && info.version.split('.').slice(0, 2).join('.') !== String(workspaceVersion).split('.').slice(0, 2).join('.')) {
      out.push({ kind: 'tsdk-version-mismatch', file, line: tsdk.line, snippet: lineText(text, tsdk.line), severity: 'advisory', detail: `typescript.tsdk is ${info.version}, the workspace compiler is ${workspaceVersion}` });
    }
  } else if (!(get('typescript.enablePromptUseWorkspaceTsdk')?.node.value === true)) {
    out.push({ kind: 'no-workspace-tsdk-prompt', file, line: 1, snippet: lineText(text, 1), severity: 'advisory', detail: 'neither typescript.tsdk nor typescript.enablePromptUseWorkspaceTsdk is set: the editor may use its bundled TypeScript instead of the workspace compiler' });
  }
  for (const [k, p] of root.props) {
    if (/^typescript\.native\./.test(k)) out.push({ kind: 'unsupported-key', file, line: p.line, snippet: lineText(text, p.line), severity: 'advisory', detail: `"${k}" has no documented source (the documented preview setting is js/ts.experimental.useTsgo); remove or re-verify` });
    if (k === 'js/ts.experimental.useTsgo' && p.node.value === true) out.push({ kind: 'usetsgo-enabled', file, line: p.line, snippet: lineText(text, p.line), severity: 'info', detail: 'the editor already uses the native language service preview' });
  }
  return out;
}

/**
 * Project-reference readiness (tc-08). packages: detect packages (path, root_only, workspace_root, tsconfigs[{file,class,signals,references}], workspace_deps).
 * turbo: parsed turbo.json value or null.
 * -> {applicable, pattern: 'A'|'B'|'unstructured', missing:[{kind, package, file, detail}], packages: n}
 */
export function evalReferences(packages, turbo = null) {
  const ts = packages.filter((p) => !p.root_only && p.kind !== 'deno' && p.tsconfigs?.length);
  const members = ts.filter((p) => !p.workspace_root);
  const hasDeps = ts.some((p) => (p.workspace_deps || []).length);
  if (members.length < 2 || !hasDeps) return { applicable: false, pattern: null, missing: [], packages: ts.length };
  const cfgs = ts.flatMap((p) => p.tsconfigs.map((c) => ({ ...c, pkg: p.path })));
  const solutions = cfgs.filter((c) => c.class === 'solution' || (c.references || []).length > 0);
  const usesPaths = cfgs.some((c) => c.signals && c.signals.paths && typeof c.signals.paths === 'object' && Object.values(c.signals.paths).flat().some((v) => /(^|\/)(packages|libs|apps)\//.test(String(v))));
  const pattern = solutions.length ? 'B' : usesPaths ? 'A' : 'unstructured';
  const missing = [];
  const at = (p, f) => (p === '.' ? f : `${p}/${f}`);
  if (pattern === 'unstructured') {
    const root = ts.find((p) => p.path === '.');
    missing.push({ kind: 'no-pattern', package: '.', file: root ? at('.', root.tsconfigs[0].file) : at(members[0].path, members[0].tsconfigs[0].file), detail: 'internal packages depend on each other but there is neither a solution tsconfig (files: [] + references) nor paths mappings to sibling sources' });
  }
  if (pattern === 'B') {
    const referenced = new Set(solutions.flatMap((s) => (s.references || []).map((r) => String(r).replace(/^\.\//, '').replace(/\/tsconfig[^/]*\.json$/, '').replace(/\/$/, ''))));
    for (const p of members) {
      const proj = p.tsconfigs.find((c) => c.class === 'project');
      if (!proj) continue;
      const s = proj.signals || {};
      if (s.composite !== true) missing.push({ kind: 'no-composite', package: p.path, file: at(p.path, proj.file), detail: `${p.path} is a project in a reference graph but does not set composite: true` });
      else {
        if (s.outDir == null) missing.push({ kind: 'no-outdir', package: p.path, file: at(p.path, proj.file), detail: `${p.path} sets composite without outDir` });
        if (s.rootDir == null) missing.push({ kind: 'no-rootdir', package: p.path, file: at(p.path, proj.file), detail: `${p.path} sets composite without rootDir (TS 7 defaults it to the tsconfig directory)` });
      }
      if (referenced.size && !referenced.has(p.path)) missing.push({ kind: 'not-referenced', package: p.path, file: at(p.path, proj.file), detail: `${p.path} is not referenced by any solution config` });
    }
    if (turbo && typeof turbo === 'object') {
      const tasks = turbo.tasks || turbo.pipeline || {};
      const build = tasks.build || tasks.typecheck || null;
      const outs = build && Array.isArray(build.outputs) ? build.outputs.join(' ') : '';
      if (build && !/tsbuildinfo/i.test(outs)) missing.push({ kind: 'turbo-no-buildinfo', package: '.', file: 'turbo.json', detail: 'turbo.json build/typecheck task outputs do not include *.tsbuildinfo, so incremental state is not cached' });
    }
  }
  return { applicable: true, pattern, missing, packages: ts.length };
}

export { toValue };
