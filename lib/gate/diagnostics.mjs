// TypeScript diagnostics: parse `--pretty false` output (classic and native compilers) into records (doc 05 §9.1).
/** `file(line,col): error TSnnnn: message` (--pretty false), continuation lines indented */
export function parseDiagnostics(out) {
  const diags = [];
  for (const line of out.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);
    if (m) diags.push({ file: m[1].replace(/\\/g, '/'), line: Number(m[2]), col: Number(m[3]), severity: m[4], code: m[5], message: m[6] });
    else if (diags.length && /^\s+/.test(line)) diags[diags.length - 1].message += ' ' + line.trim();
  }
  return diags;
}


// TS5xxx/TS6xxx config-level diagnostics have no file position: `error TS5108: Option 'target=ES5' has been removed.`
export function parseConfigDiagnostics(out) {
  const diags = [];
  for (const line of String(out).split('\n')) {
    const m = /^(error|warning) (TS\d+): (.*)$/.exec(line.trim());
    if (m) diags.push({ file: '', line: 0, col: 0, severity: m[1], code: m[2], message: m[3] });
  }
  return diags;
}
