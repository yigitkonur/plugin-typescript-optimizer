// stderr logging; stdout is data only.
let quiet = false;
export function setQuiet(q) { quiet = !!q; }
export function log(...a) { if (!quiet) process.stderr.write(a.join(' ') + '\n'); }
export function warn(...a) { process.stderr.write('warning: ' + a.join(' ') + '\n'); }
