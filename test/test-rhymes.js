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

// English rhyme finesse: length, identical rhyme, near-rhyme type.
module.exports.finesse = function testsRhymeFinesse(m) {
  const parts = (w) => m.rhymePartsForWord(w, m.idx);
  group('Rhymes — finesse', () => {
    test('length: masculine / feminine / triple', () => {
      assertEqual(m.rhymeLengthLabel(parts('night').length), 'masculine');
      assertEqual(m.rhymeLengthLabel(parts('dancing').length), 'feminine');
      assertEqual(m.rhymeLengthLabel(parts('tenderly').length), 'triple');
    });
    test('identical rhyme: night / knight, light / delight — not night / light', () => {
      assertTrue(m.isIdenticalRhyme(parts('night'), parts('knight')), 'night/knight');
      assertTrue(m.isIdenticalRhyme(parts('light'), parts('delight')), 'light/delight');
      assertFalse(m.isIdenticalRhyme(parts('night'), parts('light')), 'night/light');
    });
    test('near-rhyme type: lake / fate assonance, shape / keep consonance', () => {
      assertEqual(m.nearRhymeType(parts('lake'), parts('fate')), 'assonance');
      assertEqual(m.nearRhymeType(parts('shape'), parts('keep')), 'consonance');
    });
    test('search: knight flagged identical for "night", light not', () => {
      const r = m.searchLocalRhymes('night', m.idx, {});
      assertTrue(r.perfect.find((x) => x.word === 'knight').identical, 'knight');
      assertFalse(r.perfect.find((x) => x.word === 'light').identical, 'light');
      assertEqual(r.length, 1);
    });
    test('poem: the second "night" ending is flagged identical', () => {
      const p = m.analyzePoem('I walk alone at night\nThe stars are burning bright\nA knight rides through the night', m.idx, null, true);
      assertEqual(p.lines[1].identicalWith, undefined);
      assertEqual(p.lines[2].identicalWith, 0);
    });
  });
};
