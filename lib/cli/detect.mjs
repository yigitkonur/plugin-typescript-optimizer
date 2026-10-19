import { detect } from '../detect/index.mjs';
import { formatBrief } from '../detect/brief.mjs';

export const spec = { brief: 'boolean', refresh: 'boolean' };

export async function run({ cwd, flags }) {
  const d = await detect(cwd, { refresh: !!flags.refresh });
  // `detect` always exits 0: an aborted skill injection must never cancel the skill.
  return { result: d, text: formatBrief(d), exit: 0 };
}
