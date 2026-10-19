#!/usr/bin/env node
// node tests/harness/deviation.mjs "<where>" "<design says>" "<built>" "<why>"  -> appends a row to AGENTS.md's Deviations table
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './fixture.mjs';

const [where, design, built, why] = process.argv.slice(2).map((s) => (s || '').replace(/\|/g, '\\|'));
const f = join(REPO, 'AGENTS.md');
const lines = readFileSync(f, 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith('## Deviations'));
let end = lines.findIndex((l, k) => k > start + 3 && !l.startsWith('|'));
if (end < 0) end = lines.length;
lines.splice(end, 0, `| ${where} | ${design} | ${built} | ${why} |`);
writeFileSync(f, lines.join('\n'));
