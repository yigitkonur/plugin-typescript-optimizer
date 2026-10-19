#!/usr/bin/env node
// Compare a run's candidates with a fixture's SEEDS.json: node tests/harness/seeds.mjs <Fxx> [runId]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureDir, workDir } from './fixture.mjs';
import { loadRules } from '../../lib/catalog/index.mjs';

export function compareSeeds(id, runId = null, { tolerance = 0 } = {}) {
  const seeds = JSON.parse(readFileSync(join(fixtureDir(id), 'SEEDS.json'), 'utf8'));
  const work = join(workDir(id), '.ts-optimize', 'runs');
  const run = runId || readdirSync(work).sort().pop();
  const cands = readFileSync(join(work, run, 'raw', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const withheldFile = join(work, run, 'raw', 'withheld.jsonl');
  const withheld = existsSync(withheldFile) ? readFileSync(withheldFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const rules = loadRules();
  const mode = JSON.parse(readFileSync(join(work, run, 'run.json'), 'utf8')).mode;
  const inMode = (s) => s.rule === '*' || (rules.get(s.rule)?.modes || []).includes(mode); // a seed for a deep/tsgo rule is not expected in a standard scan
  // file/package/project-grain candidates sit on the first line of the file; the seed's line is where a human would point
  const lineFree = (s) => ['file', 'package', 'project'].includes(rules.get(s.rule)?.grain);
  const hit = (s, list) => list.filter((c) => c.rule === s.rule && c.file === s.file && (s.line === undefined || lineFree(s) || Math.abs(c.line - s.line) <= tolerance));
  const missing = []; const wrongLine = []; const violations = [];
  const skipped = (seeds.must_fire || []).filter((s) => !inMode(s));
  for (const s of (seeds.must_fire || []).filter(inMode)) {
    if (hit(s, cands).length) continue;
    const near = cands.filter((c) => c.rule === s.rule && c.file === s.file);
    (near.length ? wrongLine : missing).push({ ...s, found_lines: near.map((c) => c.line), withheld: hit(s, withheld).length > 0 });
  }
  const triageDismiss = [];
  for (const s of seeds.must_not_fire || []) {
    const h = cands.filter((c) => (s.rule === '*' || c.rule === s.rule) && c.file === s.file && (s.line === undefined || c.line === s.line));
    // engines whose output is judged by the triager (Knip, coverage) may legitimately emit the decoy as a candidate; precision engines must not
    const precision = h.filter((c) => !/^(knip|coverage)/.test(c.engine));
    if (precision.length) violations.push({ ...s, found: precision.map((c) => `${c.rule}@${c.line}`) });
    else if (h.length) triageDismiss.push({ ...s, found: h.map((c) => `${c.rule}@${c.line}`) });
  }
  return { fixture: id, run, candidates: cands.length, must_fire: (seeds.must_fire || []).length - skipped.length, skipped_other_modes: skipped.length, missing, wrongLine, violations, triageDismiss, seeds };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const r = compareSeeds(process.argv[2], process.argv[3]);
  console.log(`${r.fixture} run ${r.run}: ${r.candidates} candidates; must_fire ${r.must_fire}: ${r.must_fire - r.missing.length - r.wrongLine.length} exact, ${r.wrongLine.length} wrong line, ${r.missing.length} missing; must_not_fire violations ${r.violations.length}`);
  for (const m of r.missing) console.log('  MISSING', m.rule, m.file + ':' + m.line, '-', m.what || '', m.withheld ? '(withheld by noise gate)' : '');
  for (const m of r.wrongLine) console.log('  LINE   ', m.rule, m.file + ':' + m.line, 'candidates at', m.found_lines.join(','));
  for (const v of r.triageDismiss) console.log('  TRIAGE MUST DISMISS', v.rule, v.file + ':' + (v.line ?? '*'), '-', v.why || '');
  for (const v of r.violations) console.log('  FALSE-POSITIVE', v.rule, v.file + ':' + (v.line ?? '*'), v.found.join(' '), '-', v.why || '');
  process.exit(r.missing.length || r.violations.length ? 1 : 0);
}
