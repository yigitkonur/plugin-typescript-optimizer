import fs from 'node:fs';
export default function read(p) { return fs.readFileSync(p, 'utf8'); }
// module.exports = {};
const s = 'module.exports = {}';
