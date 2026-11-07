const { group, test, assertEqual, assertTrue } = require('./framework');

// Personal dictionary writes (plugin methods) and the Random pool.
module.exports = function testsDictionary(m) {
  const makePlugin = () => {
    const written = {};
    const app = { vault: { adapter: { write: async (p, t) => { written[p] = t; } } }, workspace: {} };
    const p = new m.PluginClass(app, { dir: 'x' });
    p.settings = { onlineSources: [] };
    p.saveSettings = async () => {};
    p.personalDictionary = { synonyms: {} };
    p.personalDictionaryPath = 'poets-notebook-dictionary.json';
    return { p, written };
  };

  group('Personal dictionary', () => {
    test('addRareWord adds once, keeps the first note, merges tags', async () => {
      const { p, written } = makePlugin();
      await p.addRareWord('Petrichor', '', ['smell'], { quiet: true });
      await p.addRareWord('petrichor', 'rain smell', ['favorite'], { quiet: true });
      assertEqual(p.personalDictionary.rareWords.length, 1);
      assertEqual(p.personalDictionary.rareWords[0].note, 'rain smell');
      assertEqual(p.personalDictionary.wordMeta.petrichor.tags.join(), 'smell,favorite');
      assertTrue(written['poets-notebook-dictionary.json'].includes('petrichor'));
    });
    test('addThemeWords creates the theme with its triggers, skips duplicates', async () => {
      const { p } = makePlugin();
      assertEqual(await p.addThemeWords('Mountains', ['mountain'], [{ word: 'crag' }, { word: 'tor', note: 'rocky peak' }]), 2);
      assertEqual(await p.addThemeWords('mountains', ['peak'], [{ word: 'Crag' }, { word: 'scree' }]), 1);
      const t = p.personalDictionary.vocabularyThemes[0];
      assertEqual(t.triggers.join(), 'mountain,peak');
      assertEqual(t.words.map((w) => w.word).join(), 'crag,tor,scree');
      assertEqual(m.findInspiration('peaks', p.personalDictionary).length, 1, 'trigger with plural');
    });
    test('setOnlineSource remembers ticked tabs', async () => {
      const { p } = makePlugin();
      await p.setOnlineSource('rhymes', true);
      await p.setOnlineSource('synonyms', true);
      await p.setOnlineSource('rhymes', false);
      assertEqual(p.settings.onlineSources.join(), 'synonyms');
    });
  });

  group('Random pool', () => {
    test('built-in words plus personal ones, excluded words hidden', () => {
      const dict = { rareWords: [{ word: 'petrichor' }], wordMeta: { petrichor: { tags: ['smell'], excluded: true } } };
      const pool = m.poolWithMeta(dict);
      assertTrue(pool.length > 50, 'built-in words present');
      const base = { includeTags: new Set(), excludeTags: new Set(), includeMode: 'or', onlyLiked: false, onlyExcluded: false };
      assertTrue(!m.filterPool(pool, base).some((w) => w.word === 'petrichor'), 'excluded hidden');
      assertEqual(m.filterPool(pool, { ...base, onlyExcluded: true }).map((w) => w.word).join(), 'petrichor');
    });
  });
};
