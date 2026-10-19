// Readers for raw/ records.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runDir } from './store.mjs';

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export const readCandidates = (root, id) => readJsonl(join(runDir(root, id), 'raw', 'candidates.jsonl'));
export function readVerdicts(root, id) {
  const dir = join(runDir(root, id), 'raw', 'verdicts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => readJsonl(join(dir, f)).map((v) => ({ ...v, _file: f })));
}
export function readChunks(root, id) {
  const dir = join(runDir(root, id), 'raw', 'chunks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
