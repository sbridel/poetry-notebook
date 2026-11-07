// ============================================================
// SONORITIES — alliteration, consonant web (every position, not just
// initial), internal assonance, echo endings (mid-line rhyme echoes).
// Unlike the French plugin's Sonorités module, this reads phonemes
// straight from CMUdict — no orthographic heuristic is needed for the
// vast majority of the ~135k covered words (no silent-letter rules, no
// doubled-consonant collapse, no "-tion softens to [s]" exception list:
// CMUdict already resolved all of that). A word missing from CMUdict is
// simply skipped for alliteration/consonant web/assonance (spelling-only
// English pronunciation is too unreliable to guess at safely); echo
// endings fall back to the heuristic syllable/rhyme machinery already
// used elsewhere in this file for out-of-dictionary words.
// ============================================================

function isVowelPhoneme(ph) { return /\d$/.test(ph); }
function stripStress(ph) { return ph.replace(/\d$/, ''); }

const STOPS_VOICELESS = new Set(['P', 'T', 'K']);
const STOPS_VOICED = new Set(['B', 'D', 'G']);
const FRICATIVES_VOICELESS = new Set(['F', 'TH', 'S', 'SH', 'HH']);
const FRICATIVES_VOICED = new Set(['V', 'DH', 'Z', 'ZH']);
const AFFRICATES_VOICELESS = new Set(['CH']);
const AFFRICATES_VOICED = new Set(['JH']);
const NASAL_CONSONANTS = new Set(['M', 'N', 'NG']);
const LIQUID_CONSONANTS = new Set(['L', 'R']);
const GLIDE_CONSONANTS = new Set(['W', 'Y']);

function consonantFamilySimple(ph) {
  if (STOPS_VOICELESS.has(ph) || STOPS_VOICED.has(ph)) return 'Stops';
  if (FRICATIVES_VOICELESS.has(ph) || FRICATIVES_VOICED.has(ph)) return 'Fricatives';
  if (AFFRICATES_VOICELESS.has(ph) || AFFRICATES_VOICED.has(ph)) return 'Affricates';
  if (NASAL_CONSONANTS.has(ph)) return 'Nasals';
  if (LIQUID_CONSONANTS.has(ph)) return 'Liquids';
  if (GLIDE_CONSONANTS.has(ph)) return 'Glides';
  return ph;
}
function consonantFamilyExtended(ph) {
  if (STOPS_VOICELESS.has(ph)) return 'Voiceless stops';
  if (STOPS_VOICED.has(ph)) return 'Voiced stops';
  if (FRICATIVES_VOICELESS.has(ph)) return 'Voiceless fricatives';
  if (FRICATIVES_VOICED.has(ph)) return 'Voiced fricatives';
  if (AFFRICATES_VOICELESS.has(ph)) return 'Voiceless affricate';
  if (AFFRICATES_VOICED.has(ph)) return 'Voiced affricate';
  if (NASAL_CONSONANTS.has(ph)) return 'Nasals';
  if (LIQUID_CONSONANTS.has(ph)) return 'Liquids';
  if (GLIDE_CONSONANTS.has(ph)) return 'Glides';
  return ph;
}
// Simplified 3-way vowel split (mirrors the French plugin's claires/
// sombres/ouverte) and a more granular 6-way split by height/diphthong
// status for "extended" mode.
const VOWEL_FAMILY_SIMPLE = {
  IY: 'Front vowels', IH: 'Front vowels', EH: 'Front vowels', AE: 'Front vowels', EY: 'Front vowels',
  UW: 'Back vowels', UH: 'Back vowels', OW: 'Back vowels', AO: 'Back vowels', AA: 'Back vowels',
  AH: 'Central/diphthongs', ER: 'Central/diphthongs', AY: 'Central/diphthongs', AW: 'Central/diphthongs', OY: 'Central/diphthongs',
};
const VOWEL_FAMILY_EXTENDED = {
  IY: 'High front', IH: 'High front',
  EH: 'Mid/low front', AE: 'Mid/low front', EY: 'Mid/low front',
  UW: 'High back', UH: 'High back',
  OW: 'Mid/low back', AO: 'Mid/low back', AA: 'Mid/low back',
  AH: 'Central', ER: 'Central',
  AY: 'Diphthongs', AW: 'Diphthongs', OY: 'Diphthongs',
};

function initialConsonantOfEntry(entry) {
  for (const ph of entry.phonemes) {
    if (isVowelPhoneme(ph)) return null; // word starts with a vowel sound: no alliteration possible
    return stripStress(ph);
  }
  return null;
}

function allConsonantsOfEntry(entry) {
  return entry.phonemes
    .map((ph, i) => ({ ph: stripStress(ph), i, vowel: isVowelPhoneme(ph) }))
    .filter((x) => !x.vowel);
}

function allVowelsOfEntry(entry) {
  return entry.phonemes
    .map((ph, i) => ({ ph: stripStress(ph), i }))
    .filter((_, idx) => isVowelPhoneme(entry.phonemes[idx]));
}

const STOPWORDS_EN = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'that', 'this', 'these', 'those', 'as', 'by',
  'or', 'but', 'so', 'if', 'not', 'no', 'do', 'does', 'did', 'has', 'have', 'had', 'i', 'you',
  'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their', 'from', 'into', 'up',
]);

// Builds a phoneme-frequency baseline directly from the loaded CMUdict —
// unlike the French plugin (stuck citing a 1985 study for lack of a
// better accessible source), this recomputes on the ~135k words actually
// loaded, so it's always current and needs no citation. Two tables, same
// reasoning as the French plugin's ATTAQUE/TOUTES split: word-initial
// position behaves very differently from "anywhere in the word" for some
// phonemes, so alliteration and the consonant web need separate baselines.
function buildPhonemeFrequencyBaseline(cmudictIndex) {
  if (!cmudictIndex) return { initial: {}, all: {}, vowelsAll: {} };
  const initialCounts = {};
  const allCounts = {};
  const vowelCounts = {};
  let totalInitial = 0, totalAll = 0, totalVowels = 0;
  for (const [, entries] of cmudictIndex) {
    const entry = entries[0];
    const cons = allConsonantsOfEntry(entry);
    const vows = allVowelsOfEntry(entry);
    if (cons.length > 0 && !isVowelPhoneme(entry.phonemes[0])) {
      const ph = cons[0].ph;
      initialCounts[ph] = (initialCounts[ph] || 0) + 1;
      totalInitial++;
    }
    cons.forEach((c) => { allCounts[c.ph] = (allCounts[c.ph] || 0) + 1; totalAll++; });
    vows.forEach((v) => { vowelCounts[v.ph] = (vowelCounts[v.ph] || 0) + 1; totalVowels++; });
  }
  const toPercent = (counts, total) => {
    const out = {};
    for (const k in counts) out[k] = (counts[k] / total) * 100;
    return out;
  };
  return {
    initial: toPercent(initialCounts, totalInitial),
    all: toPercent(allCounts, totalAll),
    vowelsAll: toPercent(vowelCounts, totalVowels),
  };
}

// Baseline for a family-grouped table: sums the member phonemes' real
// baseline percentages, computed from the same per-phoneme table (no
// double counting, since each phoneme belongs to exactly one family).
function familyBaseline(perPhonemeBaseline, familyMapObjectOrFn) {
  const out = {};
  for (const ph in perPhonemeBaseline) {
    const fam = typeof familyMapObjectOrFn === 'function'
      ? familyMapObjectOrFn(ph)
      : familyMapObjectOrFn[ph];
    if (!fam) continue;
    out[fam] = (out[fam] || 0) + perPhonemeBaseline[ph];
  }
  return out;
}

function ratioFrequency(baselineTable, son, observedPercent) {
  const base = baselineTable[son];
  if (!base) return null;
  return observedPercent / base;
}

// mode: 'exact' | 'simple' | 'extended'
function familyKeyForConsonant(ph, mode) {
  if (mode === 'simple') return consonantFamilySimple(ph);
  if (mode === 'extended') return consonantFamilyExtended(ph);
  return ph;
}
function familyKeyForVowel(ph, mode) {
  if (mode === 'simple') return VOWEL_FAMILY_SIMPLE[ph] || ph;
  if (mode === 'extended') return VOWEL_FAMILY_EXTENDED[ph] || ph;
  return ph;
}

function analyzeAlliteration(lines, cmudictIndex, baseline, opts) {
  const excludeStop = !opts || opts.excludeStopwords !== false;
  const seuil = (opts && opts.seuilMin) || 2;
  const mode = (opts && opts.mode) || 'exact';
  const bySon = new Map();
  lines.forEach((line, idxLine) => {
    tokenizeLine(line).forEach((wordRaw) => {
      const wl = wordRaw.toLowerCase().replace(/'/g, '');
      if (!wl || (excludeStop && STOPWORDS_EN.has(wl))) return;
      const entry = resolveCmudictEntry(wordRaw, cmudictIndex);
      if (!entry) return;
      const ph = initialConsonantOfEntry(entry);
      if (!ph) return;
      const key = familyKeyForConsonant(ph, mode);
      if (!bySon.has(key)) bySon.set(key, []);
      bySon.get(key).push({ word: wl, line: idxLine + 1 });
    });
  });
  const baseTable = mode === 'exact' ? baseline.initial
    : familyBaseline(baseline.initial, mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
  const total = Array.from(bySon.values()).reduce((n, l) => n + l.length, 0);
  return Array.from(bySon.entries())
    .map(([son, occurrences]) => ({
      son, occurrences, count: occurrences.length,
      ratio: total > 0 ? ratioFrequency(baseTable, son, (occurrences.length / total) * 100) : null,
    }))
    .filter((e) => e.count >= seuil)
    .sort((a, b) => b.count - a.count);
}

function analyzeConsonantWeb(lines, cmudictIndex, baseline, opts) {
  const excludeStop = !opts || opts.excludeStopwords !== false;
  const seuil = (opts && opts.seuilMin) || 2;
  const mode = (opts && opts.mode) || 'exact';
  const bySon = new Map();
  lines.forEach((line, idxLine) => {
    tokenizeLine(line).forEach((wordRaw) => {
      const wl = wordRaw.toLowerCase().replace(/'/g, '');
      if (!wl || (excludeStop && STOPWORDS_EN.has(wl))) return;
      const entry = resolveCmudictEntry(wordRaw, cmudictIndex);
      if (!entry) return;
      const seen = new Set(); // count a word once per son, even if repeated inside it
      allConsonantsOfEntry(entry).forEach((c) => {
        const key = familyKeyForConsonant(c.ph, mode);
        if (seen.has(key)) return;
        seen.add(key);
        if (!bySon.has(key)) bySon.set(key, []);
        bySon.get(key).push({ word: wl, line: idxLine + 1 });
      });
    });
  });
  const baseTable = mode === 'exact' ? baseline.all
    : familyBaseline(baseline.all, mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
  const total = Array.from(bySon.values()).reduce((n, l) => n + l.length, 0);
  return Array.from(bySon.entries())
    .map(([son, occurrences]) => ({
      son, occurrences, count: occurrences.length,
      ratio: total > 0 ? ratioFrequency(baseTable, son, (occurrences.length / total) * 100) : null,
    }))
    .filter((e) => e.count >= seuil)
    .sort((a, b) => b.count - a.count);
}

function analyzeInternalAssonance(lines, cmudictIndex, baseline, opts) {
  const excludeStop = !opts || opts.excludeStopwords !== false;
  const seuil = (opts && opts.seuilMin) || 2;
  const mode = (opts && opts.mode) || 'exact';
  const bySon = new Map();
  lines.forEach((line, idxLine) => {
    tokenizeLine(line).forEach((wordRaw) => {
      const wl = wordRaw.toLowerCase().replace(/'/g, '');
      if (!wl || (excludeStop && STOPWORDS_EN.has(wl))) return;
      const entry = resolveCmudictEntry(wordRaw, cmudictIndex);
      if (!entry) return;
      const seen = new Set();
      allVowelsOfEntry(entry).forEach((v) => {
        const key = familyKeyForVowel(v.ph, mode);
        if (seen.has(key)) return;
        seen.add(key);
        if (!bySon.has(key)) bySon.set(key, []);
        bySon.get(key).push({ word: wl, line: idxLine + 1 });
      });
    });
  });
  const baseTable = mode === 'exact' ? baseline.vowelsAll
    : familyBaseline(baseline.vowelsAll, mode === 'simple' ? (ph => VOWEL_FAMILY_SIMPLE[ph]) : (ph => VOWEL_FAMILY_EXTENDED[ph]));
  const total = Array.from(bySon.values()).reduce((n, l) => n + l.length, 0);
  return Array.from(bySon.entries())
    .map(([son, occurrences]) => ({
      son, occurrences, count: occurrences.length,
      ratio: total > 0 ? ratioFrequency(baseTable, son, (occurrences.length / total) * 100) : null,
    }))
    .filter((e) => e.count >= seuil)
    .sort((a, b) => b.count - a.count);
}

// Echo endings: the rhyming part (rhymeKeyForWord, already used for the
// rhyme scheme) applied to EVERY word in the poem, not just line-final
// ones — surfaces mid-line echoes of a sound that also happens to be a
// line-end rhyme elsewhere, or a completely separate recurring echo.
// Same guard as the French plugin's homéotéleutes: needs at least 2
// distinct words AND at least one occurrence that isn't already the last
// word of its line, otherwise it's just restating the rhyme scheme.
function analyzeEchoEndings(lines, cmudictIndex, excludeStopwords) {
  const excludeStop = excludeStopwords !== false;
  const byKey = new Map();
  lines.forEach((line, idxLine) => {
    const words = tokenizeLine(line);
    words.forEach((wordRaw, idxWord) => {
      const wl = wordRaw.toLowerCase().replace(/'/g, '');
      if (!wl || (excludeStop && STOPWORDS_EN.has(wl))) return;
      const key = rhymeKeyForWord(wordRaw, cmudictIndex);
      if (!key) return;
      const isLineFinal = idxWord === words.length - 1;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ word: wl, line: idxLine + 1, lineFinal: isLineFinal });
    });
  });
  return Array.from(byKey.entries())
    .map(([key, occurrences]) => ({ key, occurrences, count: occurrences.length }))
    .filter((e) => {
      const distinctWords = new Set(e.occurrences.map((o) => o.word)).size;
      const hasMidLine = e.occurrences.some((o) => !o.lineFinal);
      return distinctWords >= 2 && hasMidLine;
    })
    .sort((a, b) => b.count - a.count);
}

function analyzeSonorities(poemText, cmudictIndex, baseline, opts) {
  const lines = (poemText || '').split('\n');
  return {
    alliteration: analyzeAlliteration(lines, cmudictIndex, baseline, opts),
    consonantWeb: analyzeConsonantWeb(lines, cmudictIndex, baseline, opts),
    internalAssonance: analyzeInternalAssonance(lines, cmudictIndex, baseline, opts),
    echoEndings: analyzeEchoEndings(lines, cmudictIndex, opts && opts.excludeStopwords),
  };
}

// Stable colour per theme, not per order of appearance — "Stops" (simple
// mode) and "Voiceless stops" (extended mode) must land on the same hue
// family, since it's the same underlying group of sounds viewed at two
// granularities. Mirrors the French plugin's THEME_CONSONNE/THEME_VOYELLE
// exactly (including the fix applied there: colour keyed by theme, never
// by discovery order).
const THEME_CONSONANT = {
  P: 'pn-son-c1', T: 'pn-son-c1', K: 'pn-son-c1', Stops: 'pn-son-c1', 'Voiceless stops': 'pn-son-c1',
  B: 'pn-son-c2', D: 'pn-son-c2', G: 'pn-son-c2', 'Voiced stops': 'pn-son-c2',
  F: 'pn-son-c3', TH: 'pn-son-c3', S: 'pn-son-c3', SH: 'pn-son-c3', HH: 'pn-son-c3',
  Fricatives: 'pn-son-c3', 'Voiceless fricatives': 'pn-son-c3',
  V: 'pn-son-c4', DH: 'pn-son-c4', Z: 'pn-son-c4', ZH: 'pn-son-c4', 'Voiced fricatives': 'pn-son-c4',
  CH: 'pn-son-c5', JH: 'pn-son-c5', Affricates: 'pn-son-c5', 'Voiceless affricate': 'pn-son-c5', 'Voiced affricate': 'pn-son-c5',
  M: 'pn-son-c6', N: 'pn-son-c6', NG: 'pn-son-c6', Nasals: 'pn-son-c6',
  L: 'pn-son-c7', R: 'pn-son-c7', Liquids: 'pn-son-c7',
  W: 'pn-son-c8', Y: 'pn-son-c8', Glides: 'pn-son-c8',
};
const THEME_VOWEL = {
  IY: 'pn-son-c1', IH: 'pn-son-c1', EH: 'pn-son-c1', AE: 'pn-son-c1', EY: 'pn-son-c1',
  'Front vowels': 'pn-son-c1', 'High front': 'pn-son-c1', 'Mid/low front': 'pn-son-c1',
  UW: 'pn-son-c2', UH: 'pn-son-c2', OW: 'pn-son-c2', AO: 'pn-son-c2', AA: 'pn-son-c2',
  'Back vowels': 'pn-son-c2', 'High back': 'pn-son-c2', 'Mid/low back': 'pn-son-c2',
  AH: 'pn-son-c3', ER: 'pn-son-c3', AY: 'pn-son-c3', AW: 'pn-son-c3', OY: 'pn-son-c3',
  'Central/diphthongs': 'pn-son-c3', Central: 'pn-son-c3', Diphthongs: 'pn-son-c3',
};

// Datamuse online rhymes, only ever called on explicit user action (a
// checkbox the person ticks before searching), never automatically.
// Datamuse rhymes, with each word's parts of speech (md=p) so the Rhymes
// tab can filter by "Nature" like the French plugin. pos: subset of
// ['n','v','adj','adv'] ([] when Datamuse gives none).
async function fetchDatamuseRhymes(word, near, max) {
  const rel = near ? 'rel_nry' : 'rel_rhy';
  const url = `https://api.datamuse.com/words?${rel}=${encodeURIComponent(word.toLowerCase())}&md=p&max=${max || 100}`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  const POS = new Set(['n', 'v', 'adj', 'adv']);
  return Array.isArray(data) ? data.map((d) => ({
    word: d.word,
    numSyllables: d.numSyllables,
    pos: (d.tags || []).filter((t) => POS.has(t)),
  })) : [];
}

// Datamuse fallback: only syllable count is reliable enough to use.
async function fetchDatamuseSyllables(word) {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word.toLowerCase())}&md=s&max=1`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  if (Array.isArray(data) && data.length > 0 && data[0].numSyllables) {
    return { numSyllables: data[0].numSyllables };
  }
  return null;
}

