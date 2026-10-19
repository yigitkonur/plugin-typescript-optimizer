// ts-opt validate [path]: schema-check the artifacts of a run (or one file). Exit 8 on any problem (doc 04 §1.3).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { readJsonl } from '../artifacts/candidates.mjs';
import { checkSchemaId, validate } from '../artifacts/schema.mjs';
import { ART, resolveRunId, runDir } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, readJsonc } from '../core/fs.mjs';
import { splitFrontMatter } from '../core/yaml-subset.mjs';
import { findRoot } from '../detect/root.mjs';

export const spec = {};

const KIND_BY_FILE = { 'run.json': 'run', 'plan.lock.json': 'plan-lock', 'index.json': 'findings-index', 'suppressions.json': 'suppressions', 'baseline.json': 'baseline', 'config.json': 'config' };

function checkValue(label, kind, value, problems) {
  const id = checkSchemaId(value);
  if (!id.ok) { problems.push({ file: label, path: '/schema', message: id.reason === 'incompatible' ? `incompatible schema version @${id.version} (supported @${id.supported}); update the plugin` : `schema id ${id.reason}` }); if (id.reason === 'incompatible') return; }
  const r = validate(kind, value);
  for (const e of r.errors) problems.push({ file: label, path: e.path, message: e.message });
}

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const problems = []; let files = 0;
  const rel = (p) => relative(root, p).split('\\').join('/');
  const jsonFile = (f, kind) => { files++; const r = readJsonc(f); if (!r.ok) problems.push({ file: rel(f), path: '', message: `unparsable: ${r.error}` }); else checkValue(rel(f), kind, r.value, problems); };
  const mdFile = (f, kind) => { files++; try { checkValue(rel(f), kind, splitFrontMatter(readFileSync(f, 'utf8')).data, problems); } catch (e) { problems.push({ file: rel(f), path: '', message: `front matter: ${e.message}` }); } };

  if (args[0]) {
    const f = resolve(cwd, args[0]);
    if (!isFile(f)) throw new TsOptError(EXIT.NOTHING, `no such file: ${args[0]}`);
    const b = basename(f);
    if (/^F-\d+\.md$/.test(b)) mdFile(f, 'finding');
    else if (b === 'plan.md') mdFile(f, 'plan');
    else if (KIND_BY_FILE[b]) jsonFile(f, KIND_BY_FILE[b]);
    else throw new TsOptError(EXIT.USAGE, `don't know how to validate ${b}`);
  } else {
    const art = join(root, ART);
    if (!existsSync(art)) throw new TsOptError(EXIT.NOTHING, 'no .ts-optimize/ here — nothing to validate');
    for (const f of ['suppressions.json', 'baseline.json', 'config.json']) if (isFile(join(art, f))) jsonFile(join(art, f), KIND_BY_FILE[f]);
    let id; try { id = resolveRunId(root, flags.run); } catch { id = null; }
    if (id) {
      const rd = runDir(root, id);
      jsonFile(join(rd, 'run.json'), 'run');
      if (isFile(join(rd, 'plan.lock.json'))) jsonFile(join(rd, 'plan.lock.json'), 'plan-lock');
      if (isFile(join(rd, 'plan.md'))) mdFile(join(rd, 'plan.md'), 'plan');
      const fd = join(rd, 'findings');
      if (isFile(join(fd, 'index.json'))) jsonFile(join(fd, 'index.json'), 'findings-index');
      if (existsSync(fd)) for (const f of readdirSync(fd).filter((n) => /^F-\d+\.md$/.test(n)).sort()) mdFile(join(fd, f), 'finding');
      const cf = join(rd, 'raw', 'candidates.jsonl');
      if (isFile(cf)) { files++; readJsonl(cf).forEach((c, i) => checkValue(`${rel(cf)}:${i + 1}`, 'candidate', c, problems)); }
      const vd = join(rd, 'raw', 'verdicts');
      if (existsSync(vd)) for (const f of readdirSync(vd).filter((n) => n.endsWith('.jsonl'))) { files++; readJsonl(join(vd, f)).forEach((v, i) => checkValue(`${rel(join(vd, f))}:${i + 1}`, 'verdict', v, problems)); }
      const chd = join(rd, 'raw', 'chunks');
      if (existsSync(chd)) for (const f of readdirSync(chd).filter((n) => n.endsWith('.json'))) jsonFile(join(chd, f), 'chunk');
    }
  }
  const text = problems.length ? problems.slice(0, 40).map((p) => `${p.file} ${p.path}: ${p.message}`).join('\n') + `\n${problems.length} problem(s) in ${files} file(s)` : `ok: ${files} artifact file(s) valid`;
  if (problems.length) {
    const err = new TsOptError(EXIT.ARTIFACT, `${problems.length} artifact problem(s)`, text);
    err.result = { files, problems };
    throw err;
  }
  return { result: { files, problems }, text };
}
