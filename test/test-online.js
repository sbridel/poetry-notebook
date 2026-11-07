const { group, test, assertEqual, assertTrue } = require('./framework');

// Online sources, against canned responses (requestUrl is mocked): checks
// the parsing of each API's JSON, not the services themselves.
module.exports = function testsOnline(m) {
  const respond = (fn) => { globalThis.__fakeRequest = async (o) => fn(o.url); };

  group('Online — Free Dictionary API', () => {
    test('groups definitions by part of speech, merges synonyms', async () => {
      respond(() => ({ status: 200, json: [
        { word: 'night', phonetic: '/naɪt/', meanings: [
          { partOfSpeech: 'noun', synonyms: ['nighttime'], definitions: [{ definition: 'The dark part of the day.', example: 'a dark night', antonyms: ['day'] }] }] },
        { word: 'night', phonetics: [{ text: '/naɪt/' }], meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: 'Darkness.' }] },
          { partOfSpeech: 'adjective', definitions: [{ definition: 'Of the night.' }] }] }] }));
      const e = await m.fetchFreeDictionaryEntry('night');
      assertEqual(e.phonetics.join(), '/naɪt/');
      assertEqual(e.groups.map((g) => `${g.pos}:${g.definitions.length}`).join(' '), 'noun:2 adjective:1');
      assertEqual(e.groups[0].synonyms.join(), 'nighttime');
      assertEqual(e.groups[0].antonyms.join(), 'day');
      assertEqual(e.groups[0].definitions[0].example, 'a dark night');
    });
    test('404 = no entry (null), other errors throw', async () => {
      respond(() => ({ status: 404, json: { title: 'No Definitions Found' } }));
      assertEqual(await m.fetchFreeDictionaryEntry('zzz'), null);
      respond(() => ({ status: 500, json: {} }));
      let threw = false;
      try { await m.fetchFreeDictionaryEntry('zzz'); } catch (e) { threw = true; }
      assertTrue(threw);
    });
  });

  group('Online — Datamuse', () => {
    test('rhymes keep only noun/verb/adjective/adverb tags', async () => {
      respond((url) => {
        assertTrue(url.includes('md=p') && url.includes('rel_rhy=night'), url);
        return { status: 200, json: [{ word: 'light', numSyllables: 1, tags: ['n', 'adj', 'f:12.3'] }, { word: 'quite', numSyllables: 1 }] };
      });
      const r = await m.fetchDatamuseRhymes('night', false, 10);
      assertEqual(r[0].pos.join(), 'n,adj');
      assertEqual(r[1].pos.length, 0);
    });
    test('relevance rescaled to 0-100 against the best score; no score = null', () => {
      const r = m.withRelevanceRank([{ word: 'a', score: 900 }, { word: 'b', score: 450 }, { word: 'c' }]);
      assertEqual(r.map((x) => x.rank).join(), '100,50,');
      assertEqual(r[2].rank, null);
    });
    test('collocations: three queries, three lists', async () => {
      respond((url) => ({ status: 200, json: url.includes('rel_jjb') ? [{ word: 'dark' }] : url.includes('rel_jja') ? [{ word: 'sky' }] : [{ word: 'moon' }] }));
      const c = await m.fetchDatamuseCollocations('night');
      assertEqual([c.describedAs, c.describes, c.triggers].map((l) => l.join()).join(' '), 'dark sky moon');
    });
  });

  group('Filters on word lists', () => {
    test('items can be strings or { word, rank }', () => {
      assertEqual(m.itemText({ word: 'x', rank: 3 }), 'x');
      assertEqual(m.itemText('y'), 'y');
      assertEqual(m.itemRank('y'), null);
    });
    test('syllable filter (1, 5+)', () => {
      assertEqual(m.filterBySyllables(['light', 'radiant', 'incandescently'], '1', m.idx).join(), 'light');
      assertEqual(m.filterBySyllables(['light', 'incandescently'], '5+', m.idx).join(), 'incandescently');
    });
    test('"rhymes with" filter, on the last word of an expression', () => {
      assertEqual(m.filterByRhyme(['bright', 'radiant', 'full of light'], 'night', m.idx).join('|'), 'bright|full of light');
    });
  });
  globalThis.__fakeRequest = null;
};
