const { group, test, assertEqual, assertTrue } = require('./framework');

// Whole-poem analysis (stanzas, continuous letters, scheme names) and the
// "Active note" extraction.
module.exports = function testsPoem(m) {
  const frost = "Nature's first green is gold,\nHer hardest hue to hold.\nHer early leaf's a flower;\nBut only so an hour.\n\n"
    + 'Then leaf subsides to leaf,\nSo Eden sank to grief,\nSo dawn goes down to day,\nNothing gold can stay.';

  group('Poem — stanzas and rhyme letters', () => {
    test('two stanzas, blank line kept as a separator', () => {
      const p = m.analyzePoem(frost, m.idx, null, true);
      assertEqual(p.stanzas.length, 2);
      assertEqual(p.lines.filter((l) => l.empty).length, 1);
    });
    test('continuous letters: AABB then CCDD', () => {
      const p = m.analyzePoem(frost, m.idx, null, true);
      assertEqual(p.stanzas.map((s) => s.letters.join('')).join(' '), 'AABB CCDD');
    });
    test('restart per stanza: AABB then AABB', () => {
      const p = m.analyzePoem(frost, m.idx, null, false);
      assertEqual(p.stanzas.map((s) => s.letters.join('')).join(' '), 'AABB AABB');
    });
    test('scheme names', () => {
      assertEqual(m.nameRhymeScheme(['A', 'A', 'B', 'B']), 'couplets (AABB)');
      assertEqual(m.nameRhymeScheme(['A', 'B', 'A', 'B']), 'cross rhyme (ABAB)');
      assertEqual(m.nameRhymeScheme(['A', 'B', 'B', 'A']), 'enclosed rhyme (ABBA)');
      assertEqual(m.nameRhymeScheme(['A', 'B', 'C', 'A']), null);
    });
  });

  group('Active note — poem extraction', () => {
    const note = ['---', 'form: villanelle', '---', '# Draft', '', 'Some notes **before**, with a [[link|reference]].', '',
      '```poem', 'Line one of the poem', 'line two', '```', '', '- idea: change the end', '> working quote'].join('\n');
    test('selection first', () => {
      const r = m.extractPoemFromNote(note, '**Bold** start');
      assertEqual(r.source, 'selection');
      assertEqual(r.text, 'Bold start');
    });
    test('else the first ```poem block only', () => {
      const r = m.extractPoemFromNote(note, '');
      assertEqual(r.source, 'poem block');
      assertEqual(r.text, 'Line one of the poem\nline two');
    });
    test('else the whole note, frontmatter and Markdown removed', () => {
      const r = m.extractPoemFromNote(note.replace('```poem', '```text'), '');
      assertEqual(r.source, 'whole note');
      assertTrue(!r.text.includes('form:') && !r.text.includes('**') && !r.text.includes('[['), r.text);
      assertTrue(r.text.includes('Some notes before, with a reference.'), 'link text kept');
    });
  });
};
