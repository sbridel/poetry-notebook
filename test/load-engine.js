// Loads the real, built main.js and exposes its engine functions for the
// tests. main.js itself is never modified: a temporary copy gets an extra
// module.exports at the end, and require('obsidian') resolves to
// mock-obsidian.js through a temporary node_modules folder.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAIN = path.join(__dirname, '..', 'main.js');

// Engine functions/tables the tests use. Add a name here rather than
// duplicating code in a test.
const EXPORTS = [
  // syllables / meter
  'lookupWord', 'analyzeLine', 'detectMeter', 'meterLabel', 'heuristicSyllableCount', 'buildCmudictIndex',
  // rhymes
  'rhymeKeyForWord', 'rhymePartsForWord', 'rhymeLengthLabel', 'isIdenticalRhyme', 'nearRhymeType', 'searchLocalRhymes', 'detectRhymeScheme', 'lastWordOfLine', 'classifyRhymeMatch',
  // whole poem, note import, forms
  'analyzePoem', 'nameRhymeScheme', 'extractPoemFromNote', 'checkForm', 'formIdFromName', 'FORMS', 'FORM_GROUPS',
  // sonorities
  'analyzeSonorities', 'buildPhonemeFrequencyBaseline',
  // shared rendering helpers / filters
  'itemText', 'itemRank', 'filterBySyllables', 'filterByRhyme', 'syllablesOfExpression', 'withRelevanceRank',
  // vocabulary pool
  'poolWithMeta', 'filterPool', 'findInspiration', 'allRareWords',
  // online sources (requestUrl is mocked)
  'downloadCmudict', 'CMUDICT_URL', 'downloadBaseData', 'parseBaseData', 'setBaseData', 'BASE_DATA_URL',
  'fetchFreeDictionaryEntry', 'fetchDatamuseRhymes', 'fetchDatamuseSynonymsRanked', 'fetchDatamuseCollocations',
  // classes
  'PoetsNotebookView', 'RhymeModal', 'InspirationModal',
];

function loadEngine() {
  const source = fs.readFileSync(MAIN, 'utf-8');
  const tail = `\nconst __PluginClass = module.exports;\n`
    + `module.exports = { ${EXPORTS.join(', ')}, PluginClass: __PluginClass };\n`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-tests-'));
  const copy = path.join(dir, 'main.js');
  fs.writeFileSync(copy, source + tail);
  const fakeObsidian = path.join(dir, 'node_modules', 'obsidian', 'index.js');
  fs.mkdirSync(path.dirname(fakeObsidian), { recursive: true });
  fs.copyFileSync(require.resolve('./mock-obsidian'), fakeObsidian);
  const engine = require(copy);
  engine.obsidian = require(fakeObsidian);
  fs.rmSync(dir, { recursive: true, force: true });

  // CMUdict from the repository, loaded once for every test file.
  const dict = path.join(__dirname, '..', 'cmudict.dict');
  engine.idx = fs.existsSync(dict) ? engine.buildCmudictIndex(fs.readFileSync(dict, 'utf-8')) : null;
  return engine;
}

module.exports = { loadEngine };
