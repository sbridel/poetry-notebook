const { group, test, assertEqual, assertTrue, assertFalse } = require('./framework');

// Rhyme keys, local rhyme search, rhyme scheme letters.
module.exports = function testsRhymes(m) {
  const key = (w) => m.rhymeKeyForWord(w, m.idx);

  group('Rhymes — keys', () => {
    test('perfect rhymes share a key', () => {
      assertEqual(key('night'), key('light'));
      assertEqual(key('flower'), key('power'));
    });
    test('non-rhymes differ', () => {
      assertTrue(key('night') !== key('day'));
      assertEqual(key('gold'), key('hold'), 'gold / hold rhyme');
    });
    test('unknown word has no key', () => assertEqual(key('zorblaxity'), null));
  });

  group('Rhymes — local search', () => {
    test('"night" finds light and flight, not night itself', () => {
      const r = m.searchLocalRhymes('night', m.idx, {});
      const words = r.perfect.map((x) => x.word);
      assertTrue(words.includes('light'), 'light');
      assertTrue(words.includes('flight'), 'flight');
      assertFalse(words.includes('night'), 'night itself');
    });
    test('letter filter', () => {
      const r = m.searchLocalRhymes('night', m.idx, { letter: 'fl' });
      assertTrue(r.perfect.length > 0 && r.perfect.every((x) => x.word.startsWith('fl')));
    });
    test('near rhymes are kept apart from perfect ones', () => {
      const r = m.searchLocalRhymes('night', m.idx, {});
      const perfect = new Set(r.perfect.map((x) => x.word));
      assertTrue(r.near.length > 0 && r.near.every((x) => !perfect.has(x.word)));
    });
  });

  group('Rhymes — scheme', () => {
    test('ABAB', () => {
      const r = m.detectRhymeScheme(['the day', 'the night', 'away', 'the light'], m.idx);
      assertEqual(r.scheme, 'ABAB');
    });
  });
};
