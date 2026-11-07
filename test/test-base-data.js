const fs = require('fs');
const path = require('path');
const { group, test, assertEqual, assertTrue } = require('./framework');

// Published base data (poetry-notebook-base.json.gz): file checks, merge
// into Inspiration / Random, download validation.
module.exports = function testsBaseData(m) {
  const file = path.join(__dirname, '..', 'poetry-notebook-base.json.gz');
  const bytes = fs.readFileSync(file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  group('Base data — file', () => {
    test('parses, has a legend, themes and rare words', async () => {
      const base = await m.parseBaseData(ab);
      assertTrue(base._legend && base._legend.includes('Roget') && base._legend.includes('WordNet'), 'legend');
      assertTrue(base.themes.length > 900, String(base.themes.length));
      assertTrue(base.rareWords.length > 5000, String(base.rareWords.length));
    });
    test('every word has a note; theme words are in CMUdict; rare words are, or flagged estimated', async () => {
      const base = await m.parseBaseData(ab);
      const themeWords = [].concat(...base.themes.map((t) => t.words));
      assertEqual(themeWords.filter((w) => !m.idx.has(w.word) || !w.note).map((w) => w.word).slice(0, 5).join(), '', 'themes');
      assertEqual(base.rareWords.filter((w) => !w.note || (!m.idx.has(w.word) && !w.estimated)).map((w) => w.word).slice(0, 5).join(), '', 'rare');
    });
    test('words with an innocent main meaning are kept (sense-level filtering)', async () => {
      const base = await m.parseBaseData(ab);
      const all = new Set(base.rareWords.map((w) => w.word).concat(...base.themes.map((t) => t.words.map((w) => w.word))));
      ['jade', 'drab', 'wicked', 'nestling'].forEach((w) => assertTrue(all.has(w), w));
    });
    test('download URL matches the release that ships the file', () => {
      assertTrue(m.BASE_DATA_URL.endsWith('/poetry-notebook-base.json.gz'), m.BASE_DATA_URL);
    });
  });

  group('Base data — register', () => {
    test('slurs removed, vulgar/sexual words kept with a tag', async () => {
      const base = await m.parseBaseData(ab);
      const all = base.rareWords.concat(...base.themes.map((t) => t.words)).map((w) => w.word);
      ['negro', 'coolie', 'pygmy', 'redskin'].forEach((w) => assertTrue(!all.includes(w), w));
      const tagged = base.rareWords.filter((w) => (w.tags || []).some((t) => t === 'sexual' || t === 'vulgar'));
      assertTrue(tagged.length > 20, String(tagged.length));
      assertTrue(tagged.some((w) => w.word === 'concupiscence'), 'concupiscence tagged');
      assertTrue(base.rareWords.some((w) => w.word === 'constancy' && !(w.tags || []).includes('sexual')) || !base.rareWords.some((w) => w.word === 'constancy'), 'constancy not tagged');
    });
  });

  group('Base data — merged into the tabs', () => {
    test('Inspiration: "sea" opens the Ocean theme, built-in theme still first', async () => {
      m.setBaseData(await m.parseBaseData(ab));
      const themes = m.findInspiration('sea', {});
      assertEqual(themes[0].theme, 'Sea & water');
      assertTrue(themes.some((t) => t.theme === 'Ocean'), themes.map((t) => t.theme).join());
    });
    test('Random: thousands of words, one entry per word, archaic tag kept', async () => {
      m.setBaseData(await m.parseBaseData(ab));
      const pool = m.poolWithMeta({ rareWords: [{ word: 'perchance', note: 'my own note' }] });
      assertTrue(pool.length > 2500, String(pool.length));
      const keys = pool.map((w) => w.word.toLowerCase());
      assertEqual(keys.length, new Set(keys).size, 'duplicates');
      const p = pool.find((w) => w.word === 'perchance');
      assertEqual(p.note, 'my own note', 'personal entry wins over the base');
      assertTrue(pool.some((w) => w.tags.includes('archaic')), 'archaic tag');
      assertEqual(p.userTags.length, 0, 'base tags are not user tags');
    });
    test('without base data, only built-in vocabulary', () => {
      m.setBaseData(null);
      assertTrue(m.poolWithMeta({}).length < 200);
    });
  });

  group('Base data — download', () => {
    test('valid file: written as is to the plugin folder', async () => {
      const written = {};
      const app = { vault: { configDir: '.obsidian', adapter: { writeBinary: async (p, b) => { written[p] = b.byteLength; } } } };
      globalThis.__fakeRequest = async () => ({ status: 200, arrayBuffer: ab });
      const base = await m.downloadBaseData(app, { id: 'poetry-notebook' });
      assertTrue(base.themes.length > 900);
      assertEqual(written['.obsidian/plugins/poetry-notebook/poetry-notebook-base.json.gz'], bytes.length);
    });
    test('not a base file: rejected, nothing written', async () => {
      const written = {};
      const app = { vault: { configDir: '.obsidian', adapter: { writeBinary: async (p) => { written[p] = 1; } } } };
      const zlib = require('zlib');
      const bad = zlib.gzipSync(Buffer.from('{"hello":1}'));
      globalThis.__fakeRequest = async () => ({ status: 200, arrayBuffer: bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength) });
      let threw = false;
      try { await m.downloadBaseData(app, { id: 'poetry-notebook' }); } catch (e) { threw = true; }
      assertTrue(threw && Object.keys(written).length === 0);
    });
  });
};
