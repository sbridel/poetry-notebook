const { group, test, assertEqual, assertTrue } = require('./framework');

// Syllable counts, sources and meter (CMUdict-based engine).
module.exports = function testsSyllables(m) {
  const count = (w) => m.lookupWord(w, m.idx, null).syllableCount;
  const source = (w) => m.lookupWord(w, m.idx, null).source;

  group('Syllables — word counts', () => {
    test('CMUdict words', () => {
      assertEqual(count('summer'), 2, 'summer');
      assertEqual(count('beautiful'), 3, 'beautiful');
      assertEqual(count('night'), 1, 'night');
      assertEqual(source('summer'), 'cmudict');
    });
    test('poetic overrides (fire, our = 1)', () => {
      assertEqual(count('fire'), 1, 'fire');
      assertEqual(count('our'), 1, 'our');
      assertEqual(source('fire'), 'override');
    });
    test("archaic -'d elision (plann'd = planned)", () => {
      assertEqual(count("plann'd"), 1, "plann'd");
      assertEqual(source("plann'd"), 'cmudict');
    });
    test('unknown word falls back to the heuristic', () => {
      assertEqual(source('zorblaxity'), 'heuristic');
      assertTrue(count('zorblaxity') >= 3, 'zorblaxity');
    });
  });

  group('Syllables — lines and meter', () => {
    test("Sonnet 18, line 1: 10 syllables, iambic pentameter", () => {
      const a = m.analyzeLine("Shall I compare thee to a summer's day?", m.idx, null);
      assertEqual(a.totalSyllables, 10);
      const meter = m.detectMeter(a.stressSeq, a.rigidSeq);
      assertEqual(m.meterLabel(meter), 'iambic pentameter');
    });
    test('meter label reads "foot type + count"', () => {
      assertEqual(m.meterLabel({ name: 'trimeter trochaic', confidence: 'exact' }), 'trochaic trimeter');
      assertEqual(m.meterLabel({ name: 'irregular / mixed', confidence: 'none' }), 'irregular');
      assertEqual(m.meterLabel({ name: null, confidence: 'unknown' }), null);
    });
  });
};
