import { loadRules } from '../catalog/index.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';

export const spec = {};
export async function run({ args }) {
  const rules = loadRules();
  if (!args[0]) return { result: { rules: [...rules.keys()] }, text: [...rules.values()].map((r) => `${r.id.padEnd(9)} ${r.domain.padEnd(13)} ${r.name}`).join('\n') };
  const r = rules.get(args[0]);
  if (!r) throw new TsOptError(EXIT.NOTHING, `no rule ${args[0]}`);
  const { sections, tells, file, ...meta } = r;
  return { result: { ...meta, sections }, text: `# ${r.id} — ${r.name}\n\n` + Object.entries(sections).map(([k, v]) => `## ${k}\n${v}`).join('\n\n') };
}
