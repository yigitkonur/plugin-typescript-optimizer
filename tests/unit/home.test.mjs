// TS_OPT_HOME resolution: an explicit TS_OPT_HOME wins; CLAUDE_PLUGIN_DATA counts only when it is this plugin's data dir (a Bash
// environment can carry another plugin's, for example one exported by that plugin's hook); otherwise the XDG cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tsOptHome } from '../../lib/core/home.mjs';

test('TS_OPT_HOME, then our own CLAUDE_PLUGIN_DATA, never another plugin\'s', () => {
  const keep = { ...process.env };
  const xdg = mkdtempSync(join(tmpdir(), 'tsopt-xdg-'));
  try {
    delete process.env.TS_OPT_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    process.env.CLAUDE_PLUGIN_DATA = '/home/u/.claude/plugins/data/codex-openai-codex';
    assert.equal(tsOptHome(), join(xdg, 'ts-optimize'), "another plugin's data dir is ignored");
    process.env.CLAUDE_PLUGIN_DATA = '/home/u/.claude/plugins/data/ts-optimize-claude-ts-optimize-plugin';
    assert.equal(tsOptHome(), process.env.CLAUDE_PLUGIN_DATA);
    process.env.CLAUDE_PLUGIN_DATA = '/home/u/.claude/plugins/data/ts-optimize-inline/';
    assert.equal(tsOptHome(), process.env.CLAUDE_PLUGIN_DATA, '--plugin-dir data dir, trailing slash');
    process.env.TS_OPT_HOME = '/explicit/home';
    assert.equal(tsOptHome(), '/explicit/home');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
    rmSync(xdg, { recursive: true, force: true });
  }
});
