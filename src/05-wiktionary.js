// ============================================================
// Wiktionary (English) — definitions + etymology, on demand only.
// Uses the plain-text `extracts` endpoint (explaintext=1) rather than raw
// wikitext or the rendered-HTML `definition` endpoint, so there's no wiki
// template syntax or HTML tags to strip. This endpoint's plaintext format
// is documented and stable (section headers rendered as "== Title ==" /
// "=== Subtitle ==="), but this plugin's author could not reach the live
// API from the sandbox used to build it — this parser is written against
// documented examples, not a live-tested fetch. If definitions look wrong
// or empty for words that clearly have a Wiktionary entry, that's the
// first place to look.
// ============================================================
const WIKTIONARY_POS_HEADERS = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'numeral', 'particle',
  'proper noun', 'article',
]);

function parseWiktionaryExtract(extract) {
  const lines = extract.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(=+)\s*(.+?)\s*\1$/);
    if (m && m[1].length === 2) {
      if (m[2].trim().toLowerCase() === 'english') {
        start = i + 1;
      } else if (start !== -1) {
        end = i;
        break;
      }
    }
  }
  if (start === -1) return { etymology: null, definitions: [] };
  const section = lines.slice(start, end);

  let etymology = null;
  const definitions = [];
  let currentHeader = null;
  let buffer = [];

  const flush = () => {
    if (currentHeader) {
      const headerLower = currentHeader.toLowerCase();
      const content = buffer.map((l) => l.trim()).filter(Boolean);
      if (headerLower.startsWith('etymology')) {
        etymology = content.join(' ');
      } else if (WIKTIONARY_POS_HEADERS.has(headerLower) && content.length > 0) {
        definitions.push({ pos: currentHeader, lines: content });
      }
    }
    buffer = [];
  };

  for (const line of section) {
    const m = line.match(/^(=+)\s*(.+?)\s*\1$/);
    if (m) {
      flush();
      currentHeader = m[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  return { etymology, definitions };
}

async function fetchWiktionaryEntry(word) {
  const url = `https://en.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&prop=extracts&explaintext=1&format=json&formatversion=2`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  const page = data && data.query && data.query.pages && data.query.pages[0];
  if (!page || page.missing || !page.extract) return null;
  return parseWiktionaryExtract(page.extract);
}


// Free Dictionary API (dictionaryapi.dev): no key, built on Wiktionary,
// returns clean JSON — phonetics, parts of speech, definitions with
// examples, synonyms/antonyms. Used first by the Definitions tab; the
// Wiktionary extract parser above stays as the second source.
// Returns null when the word has no entry.
async function fetchFreeDictionaryEntry(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`;
  const res = await requestUrl({ url, throw: false });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const data = res.json;
  if (!Array.isArray(data) || data.length === 0) return null;
  const phonetics = new Set();
  const origins = [];
  const byPos = new Map();
  for (const entry of data) {
    if (entry.phonetic) phonetics.add(entry.phonetic);
    (entry.phonetics || []).forEach((p) => p && p.text && phonetics.add(p.text));
    if (entry.origin) origins.push(entry.origin);
    for (const m of (entry.meanings || [])) {
      const pos = m.partOfSpeech || 'other';
      if (!byPos.has(pos)) byPos.set(pos, { pos, definitions: [], synonyms: new Set(), antonyms: new Set() });
      const g = byPos.get(pos);
      (m.synonyms || []).forEach((s) => g.synonyms.add(s));
      (m.antonyms || []).forEach((s) => g.antonyms.add(s));
      for (const d of (m.definitions || [])) {
        if (!d.definition) continue;
        g.definitions.push({ text: d.definition, example: d.example || '' });
        (d.synonyms || []).forEach((s) => g.synonyms.add(s));
        (d.antonyms || []).forEach((s) => g.antonyms.add(s));
      }
    }
  }
  return {
    phonetics: [...phonetics],
    origin: origins.join(' '),
    groups: [...byPos.values()].map((g) => ({ ...g, synonyms: [...g.synonyms], antonyms: [...g.antonyms] })),
  };
}
