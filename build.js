// Assembles src/*.js (in filename order) into main.js by plain concatenation.
// Usage: node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const out = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
fs.writeFileSync(path.join(__dirname, 'main.js'), out);
console.log(`main.js built from ${files.length} files (${out.length} chars)`);
