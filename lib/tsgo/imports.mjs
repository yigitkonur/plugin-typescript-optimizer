// Source reading for the static pass: file listing, bounded reads, import-specifier extraction. All treat repo text as data.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPruned, listFiles } from '../core/files.mjs';

export const SOURCE_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const MAX_BYTES = 1024 * 1024;

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]{1,200})\1/g;

/** [{spec, line, col}] for import/export-from/require/dynamic import specifiers; lines that are comments are skipped */
export function extractImports(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= m.index) lo = mid; else hi = mid - 1; }
    const lineStart = starts[lo];
    const lead = text.slice(lineStart, m.index);
    if (/^\s*(?:\/\/|\/\*|\*)/.test(lead)) continue;
    out.push({ spec: m[2], line: lo + 1, col: m.index - lineStart + 1 });
  }
  return out;
}

/** 'ts-morph/foo' -> 'ts-morph', '@a/b/c' -> '@a/b' */
export function packageOfSpecifier(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const prunedPath = (f) => f.split('/').some((seg, i, a) => i < a.length - 1 && isPruned(seg));

/** repo-relative posix paths of JS/TS source files (git index first), without pruned directories and .d.ts files */
export async function listSourceFiles(root, inGit) {
  const files = await listFiles(root, ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.vue', '*.svelte', '*.astro'], { inGit, maxDepth: 8 });
  return files.filter((f) => SOURCE_RE.test(f) && !/\.d\.[cm]?ts$/.test(f) && !prunedPath(f)).sort();
}

/** read files with bounded concurrency; skips unreadable, binary and > 1 MB files. -> [{file, text}] */
export async function readFiles(root, files, { concurrency = 64 } = {}) {
  const out = new Array(files.length);
  for (let i = 0; i < files.length; i += concurrency) {
    await Promise.all(files.slice(i, i + concurrency).map(async (f, k) => {
      try {
        const text = await readFile(join(root, f), 'utf8');
        if (text.length > MAX_BYTES || text.slice(0, 4000).includes('\0')) return;
        out[i + k] = { file: f, text };
      } catch { /* unreadable file: skipped */ }
    }));
  }
  return out.filter(Boolean);
}
