import { runTells } from './tells.mjs';

export const name = 'tells';
export const handles = (rule) => (rule.tells || []).length > 0;
export const available = () => ({ ok: true });

export async function run(ctx) {
  const { candidates, stats } = await runTells({ root: ctx.root, files: ctx.files, rules: ctx.rules, packages: ctx.detect.packages });
  return { candidates, notes: stats };
}
