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

