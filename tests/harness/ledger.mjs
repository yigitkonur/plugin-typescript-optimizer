#!/usr/bin/env node
// node tests/harness/ledger.mjs <row> <status> "<ran>" "<saw>"   -> fills tests/LEDGER.md row (pipes/newlines escaped, saw truncated)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './fixture.mjs';

const [row, status, ran, saw] = process.argv.slice(2);
if (!row || !status) { console.error('usage: ledger.mjs <row> <✓|✗|UNVERIFIED …> "<ran>" "<saw>"'); process.exit(2); }
const f = join(REPO, 'tests', 'LEDGER.md');
const esc = (s = '', n = 600) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, n);
let hit = false;
const out = readFileSync(f, 'utf8').split('\n').map((l) => {
  if (!l.startsWith(`| ${row} |`)) return l;
  hit = true;
  // columns: row | expect | ran | saw | status ; expect may not contain an unescaped " | " (generated from doc 10)
  const cols = l.slice(2, -2).split(' | ');
  const expect = cols.slice(1, cols.length - 3).join(' | ');
  return `| ${row} | ${expect} | ${esc(ran)} | ${esc(saw)} | ${status} |`;
}).join('\n');
if (!hit) { console.error(`row ${row} not found`); process.exit(1); }
writeFileSync(f, out);
