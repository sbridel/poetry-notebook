const { group, test, assertTrue } = require('./framework');

// Sonorities panel (alliteration, internal assonance, consonant web, echo endings).
module.exports = function testsSonorities(m) {
  const baseline = m.buildPhonemeFrequencyBaseline(m.idx);
  group('Sonorities', () => {
    test('alliteration on S detected with exact sounds', () => {
      const r = m.analyzeSonorities('Silent sea and sullen sky\nSoftly sinking, softly sigh', m.idx, baseline, { excludeStopwords: true, seuilMin: 3, mode: 'exact' });
      assertTrue(r.alliteration.some((e) => e.son === 'S' && e.count >= 3), JSON.stringify(r.alliteration.map((e) => e.son)));
    });
    test('each pattern carries occurrences with line numbers', () => {
      const r = m.analyzeSonorities('Silent sea and sullen sky\nSoftly sinking, softly sigh', m.idx, baseline, { excludeStopwords: true, seuilMin: 3, mode: 'simple' });
      const e = r.alliteration[0];
      assertTrue(e && e.occurrences.every((o) => o.word && o.line >= 1));
    });
    test('empty text gives empty lists', () => {
      const r = m.analyzeSonorities('', m.idx, baseline, { excludeStopwords: true, seuilMin: 3, mode: 'simple' });
      assertTrue(r.alliteration.length === 0 && r.internalAssonance.length === 0);
    });
  });
};
