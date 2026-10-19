const fs = require('node:fs');
module.exports = { read: (p) => fs.readFileSync(p, 'utf8') };
exports.extra = 1;
