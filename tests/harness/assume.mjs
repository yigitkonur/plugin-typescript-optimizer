#!/usr/bin/env node
// node tests/harness/assume.mjs <n> "<result text>"  -> fills the Result column of AGENTS.md's verification table
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './fixture.mjs';

const [n, result] = process.argv.slice(2);
const f = join(REPO, 'AGENTS.md');
let hit = false;
const out = readFileSync(f, 'utf8').split('\n').map((l) => {
  if (!l.startsWith(`| ${n} | `)) return l;
  hit = true;
  const cols = l.slice(2, -2).split(' | ');
  return `| ${cols.slice(0, 4).join(' | ')} | ${result.replace(/\|/g, '\\|')} |`;
}).join('\n');
if (!hit) { console.error('row not found'); process.exit(1); }
writeFileSync(f, out);
