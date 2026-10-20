#!/usr/bin/env node
// Start a headless session, SIGKILL it as soon as `ts-opt commit` reports a commit (a session that dies mid-wave), for ledger row 3.9.
//   TSOPT_NS=kill node tests/harness/kill-live.mjs F01 "<prompt>" <transcript-name>
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, workDir } from './fixture.mjs';

const [fixture, prompt, name] = process.argv.slice(2);
const cwd = workDir(fixture);
const out = createWriteStream(join(REPO, 'tests', 'transcripts', `${name}.jsonl`));
const child = spawn('claude', ['-p', prompt, '--plugin-dir', REPO, '--model', 'sonnet', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--max-turns', '60', '--permission-mode', 'acceptEdits'], { cwd, env: { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let buf = ''; let killed = false;
const timer = setTimeout(() => { child.kill('SIGKILL'); }, 600_000);
child.stdout.on('data', (d) => {
  out.write(d); buf += d.toString();
  if (!killed && /committed [0-9a-f]{7} /.test(buf)) { killed = true; setTimeout(() => child.kill('SIGKILL'), 300); console.log('[kill] commit seen; killing the session'); }
});
child.on('exit', (code, sig) => { clearTimeout(timer); out.end(); console.log(`[kill] session ended code=${code} signal=${sig} killed=${killed}`); process.exit(killed ? 0 : 1); });
