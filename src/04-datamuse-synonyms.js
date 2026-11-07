// ============================================================
// Datamuse: synonyms
// ============================================================
async function fetchDatamuseSynonyms(word) {
  const url = `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word.toLowerCase())}&max=50`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  return Array.isArray(data) ? data.map((d) => d.word) : [];
}

async function fetchDatamuseAntonyms(word) {
  const url = `https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word.toLowerCase())}&max=50`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  return Array.isArray(data) ? data.map((d) => d.word) : [];
}


// Generic Datamuse query returning [{ word, score }] (score may be
// undefined). `params` is a query string such as "rel_jjb=night".
async function fetchDatamuse(params, max) {
  const url = `https://api.datamuse.com/words?${params}&max=${max || 50}`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  return Array.isArray(data) ? data.filter((d) => d && d.word).map((d) => ({ word: d.word, score: d.score })) : [];
}

// Datamuse scores are relative (not percentages): rescale each list to
// 0-100 against its best score, so the Synonyms tab can offer the same
// relevance threshold as the French plugin's CNRTL source. Words without
// a score get rank null (never hidden by the threshold).
function withRelevanceRank(items) {
  const max = Math.max(0, ...items.map((i) => (typeof i.score === 'number' ? i.score : 0)));
  return items.map((i) => ({
    word: i.word,
    rank: (typeof i.score === 'number' && max > 0) ? Math.round((100 * i.score) / max) : null,
  }));
}

async function fetchDatamuseSynonymsRanked(word) {
  return withRelevanceRank(await fetchDatamuse(`rel_syn=${encodeURIComponent(word.toLowerCase())}`, 50));
}
async function fetchDatamuseAntonymsRanked(word) {
  return withRelevanceRank(await fetchDatamuse(`rel_ant=${encodeURIComponent(word.toLowerCase())}`, 50));
}

// Collocations for the Inspiration tab (English counterpart of the CNRTL
// collocations used by the French plugin):
//   describedAs — adjectives often used with the word as a noun (night → dark, starry)
//   describes   — nouns the word often qualifies as an adjective (dark → night, room)
//   triggers    — words statistically found near it in text
async function fetchDatamuseCollocations(word) {
  const w = encodeURIComponent(word.toLowerCase());
  const [describedAs, describes, triggers] = await Promise.all([
    fetchDatamuse(`rel_jjb=${w}`, 40),
    fetchDatamuse(`rel_jja=${w}`, 40),
    fetchDatamuse(`rel_trg=${w}`, 40),
  ]);
  const words = (l) => l.map((i) => i.word);
  return { describedAs: words(describedAs), describes: words(describes), triggers: words(triggers) };
}
