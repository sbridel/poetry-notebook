const { group, test, assertEqual, assertTrue } = require('./framework');

// Fixed-form checklist (Form menu).
module.exports = function testsForms(m) {
  const rule = (res, start) => res.rules.find((r) => r.label.startsWith(start));

  const sonnet18 = `Shall I compare thee to a summer's day?
Thou art more lovely and more temperate:
Rough winds do shake the darling buds of May,
And summer's lease hath all too short a date;
Sometime too hot the eye of heaven shines,
And often is his gold complexion dimm'd;
And every fair from fair sometime declines,
By chance or nature's changing course untrimm'd;
But thy eternal summer shall not fade,
Nor lose possession of that fair thou ow'st;
Nor shall Death brag thou wander'st in his shade,
When in eternal lines to time thou grow'st:
So long as men can breathe or eyes can see,
So long lives this, and this gives life to thee.`;

  // Edward Lear, A Book of Nonsense (1846).
  const limerick = "There was an Old Man with a beard,\nWho said, 'It is just as I feared!\nTwo Owls and a Hen,\nFour Larks and a Wren,\nHave all built their nests in my beard!'";

  // Synthetic villanelle following the form exactly (A1 / A2 rhyme together).
  const A1 = 'I keep the river running through the night';
  const A2 = 'and every lamp along the bank burns bright';
  const villanelle = [
    A1, 'the water hums a song it cannot keep', A2, '',
    'the boats go by and vanish out of sight', 'the willows lean above the shallow deep', A1, '',
    'the heron stands as still as candle white', 'the reeds are bending low and half asleep', A2, '',
    'the moon comes up and turns the meadow light', 'the shadows of the hills begin to creep', A1, '',
    'the owls are calling softly in their flight', 'the fields are quiet and the banks are steep', A2, '',
    'so let the current carry what it might', 'the valley holds the secrets it will keep', A1, A2,
  ].join('\n');

  group('Forms — Shakespearean sonnet (Sonnet 18)', () => {
    const res = m.checkForm(sonnet18, 'shakespearean', m.idx);
    test('14 lines', () => assertTrue(rule(res, '14 lines').ok));
    test('syllable rule met (one line within one, flagged as a point to check)', () => {
      assertTrue(rule(res, '10 syllables').ok);
      const near = rule(res, 'Syllable count within one');
      assertTrue(near && near.advice, 'advice rule present');
    });
    test('temperate / date: not a full rhyme, line 4 flagged', () => {
      const r = rule(res, 'Rhyme scheme');
      assertTrue(!r.ok && r.lines.includes(4), JSON.stringify(r.lines));
    });
    test("archaic endings not in CMUdict are only a point to check", () => {
      const r = rule(res, 'Every rhyme word known');
      assertTrue(r && r.advice && r.lines.includes(10));
    });
    test('free = no checklist', () => assertEqual(m.checkForm(sonnet18, 'free', m.idx), null));
  });

  group('Forms — limerick, haiku, villanelle', () => {
    test('Lear limerick: scheme and syllables met', () => {
      const res = m.checkForm(limerick, 'limerick', m.idx);
      assertTrue(rule(res, 'Rhyme scheme').ok, 'scheme');
      assertTrue(rule(res, 'Syllables per line').ok, 'syllables');
    });
    test('haiku 5-7-5', () => {
      const res = m.checkForm('An old silent pond\nA frog jumps into the pond\nSplash! Silence again', 'haiku', m.idx);
      assertTrue(rule(res, 'Syllables per line').ok);
    });
    test('haiku with a 6-syllable line fails', () => {
      const res = m.checkForm('An old and silent pond\nA frog jumps into the pond\nSplash! Silence again', 'haiku', m.idx);
      const r = rule(res, 'Syllables per line');
      assertTrue(!r.ok && r.lines.join() === '1');
    });
    test('villanelle: stanzas, scheme and both refrains', () => {
      const res = m.checkForm(villanelle, 'villanelle', m.idx);
      assertTrue(rule(res, '19 lines').ok, '19 lines');
      assertTrue(rule(res, 'Stanzas').ok, 'stanzas');
      assertTrue(rule(res, 'Rhyme scheme').ok, 'scheme ' + JSON.stringify(rule(res, 'Rhyme scheme').lines));
      assertTrue(rule(res, 'Refrain A1').ok && rule(res, 'Refrain A2').ok, 'refrains');
    });
    test('villanelle: a changed refrain is flagged as a point to check', () => {
      const res = m.checkForm(villanelle.replace(/\n(I keep the river running through the night)\n\nthe owls/, '\nI keep the river turning through the night\n\nthe owls'), 'villanelle', m.idx);
      const r = rule(res, 'Refrain A1');
      assertTrue(!r.ok && r.advice && r.lines.join() === '12', JSON.stringify(r.lines));
    });
  });

  group('Forms — names and menu', () => {
    test('form: property accepts id or name', () => {
      assertEqual(m.formIdFromName('Villanelle'), 'villanelle');
      assertEqual(m.formIdFromName('Shakespearean sonnet'), 'shakespearean');
      assertEqual(m.formIdFromName('terza rima'), 'terzaRima');
      assertEqual(m.formIdFromName('nope'), null);
    });
    test('every form in the menu exists', () => {
      m.FORM_GROUPS.forEach((g) => g.ids.forEach((id) => assertTrue(m.FORMS[id], id)));
    });
  });
};

module.exports.identical = function testsFormsIdentical(m) {
  group('Forms — identical rhymes', () => {
    test('limerick with a repeated rhyme word: flagged as a point to check', () => {
      const res = m.checkForm("There was an Old Man with a beard,\nWho said, 'It is just as I feared!\nTwo Owls and a Hen,\nFour Larks and a Wren,\nHave all built their nests in my beard!'", 'limerick', m.idx);
      const r = res.rules.find((x) => x.label.startsWith('No identical rhymes'));
      assertTrue(r && !r.ok && r.advice && r.lines.join() === '5', JSON.stringify(r && r.lines));
    });
  });
};
