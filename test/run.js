#!/usr/bin/env node
// Runs every test against the real main.js. Usage: node test/run.js
// (after node build.js). Exit code 0 if everything passes, 1 otherwise.

const { loadEngine } = require('./load-engine');
const { summary } = require('./framework');

console.log('Loading the engine (main.js)…');
const engine = loadEngine();
if (!engine.idx) console.log('Warning: cmudict.dict not found at the repository root — CMUdict tests will fail.');

require('./test-syllables')(engine);
require('./test-rhymes')(engine);
require('./test-poem')(engine);
require('./test-forms')(engine);
require('./test-sonorities')(engine);
require('./test-online')(engine);
require('./test-dictionary')(engine);
require('./test-cmudict')(engine);
require('./test-base-data')(engine);
require('./test-view')(engine);

summary();
