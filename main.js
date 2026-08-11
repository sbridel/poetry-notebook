'use strict';

const { Plugin, ItemView, PluginSettingTab, Setting, Notice, requestUrl } = require('obsidian');

const VIEW_TYPE = 'poets-notebook-view';

const DEFAULT_SETTINGS = {
  allowDatamuse: false,       // never queried without this being explicitly on
  strictRhymeMode: false,     // false = also show slant/near rhymes, kept visually separate
  cmudictPathOverride: '',    // optional explicit vault-relative path
  personalDictPathOverride: '', // optional explicit vault-relative path for the personal dictionary
  showRhymeColors: true,      // color the rhyme badges by group
};

// ============================================================
// ENGINE: syllables / stress / meter / rhyme
// (validated against Shakespeare's Sonnet 18, lines 1-2, before
// being folded in here — see project notes)
// ============================================================

function parseCmudictLine(line) {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';;;') || trimmed.startsWith('##')) return null;

  // Two known upstream formats:
  //  - classic cmudict (0.7b): "WORD  P1 P2 P3" (UPPERCASE, two-space separator)
  //  - cmudict-new / pocketsphinx cmudict.dict: "word P1 P2 P3" (lowercase, single space)
  // Match on any whitespace run so both work.
  const m = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  let word = m[1];
  const phonemesRaw = m[2].trim();
  if (!word || !phonemesRaw) return null;

  const altMatch = word.match(/^(.*)\((\d+)\)$/);
  if (altMatch) word = altMatch[1];

  const phonemes = phonemesRaw.split(/\s+/);
  const stressPattern = [];
  for (const ph of phonemes) {
    const m2 = ph.match(/^[A-Za-z]+(\d)$/);
    if (m2) stressPattern.push(Number(m2[1]));
  }
  return { word: word.toLowerCase(), phonemes, stressPattern };
}

function buildCmudictIndex(text) {
  const index = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseCmudictLine(line);
    if (!parsed) continue;
    if (!index.has(parsed.word)) index.set(parsed.word, []);
    index.get(parsed.word).push(parsed);
  }
  return index;
}

function heuristicSyllableCount(rawWord) {
  let w = rawWord.toLowerCase().replace(/[^a-z']/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;

  if (w.endsWith('e') && !w.endsWith('le')) {
    w = w.slice(0, -1);
  } else if (w.endsWith('le') && w.length > 2 && !'aeiouy'.includes(w[w.length - 3])) {
    // keep as-is: "-le" after a consonant is its own syllable ("table")
  } else if (w.endsWith('e')) {
    w = w.slice(0, -1);
  }

  const groups = w.match(/[aeiouy]+/g) || [];
  let count = groups.length;
  if (count === 0) count = 1;
  return count;
}

// Typographic apostrophes/quotes (common when pasting from web sources like
// Poetry Foundation) must be normalized to a plain ' before any tokenizing —
// otherwise "plann'd" silently splits into "plann" + "d", and the lone "d"
// (a valid CMUdict entry: the letter name) corrupts rhyme/meter detection.
function normalizeApostrophes(text) {
  return text.replace(/[\u2018\u2019\u02BC\uFF07\u0060]/g, "'");
}

// Poetic elision fallback: archaic "'d" endings ("plann'd", "belov'd",
// "curs'd") mark a contracted pronunciation of "-ed" and won't be in
// CMUdict as-is. Expanding to the regular "-ed" spelling and looking that
// up is usually a very close approximation of the intended pronunciation.
function expandElidedD(key) {
  const m = key.match(/^(.+)'d$/);
  return m ? `${m[1]}ed` : null;
}

// Well-documented CMUdict quirk: several common diphthong+R words are
// transcribed with their formal, fully-enunciated pronunciation (e.g.
// "our" as AW1 ER0, two syllables — like "ow-er") even though they are
// read as one syllable in almost all natural and poetic speech ("our"
// rhyming with "hour"/"scour"). Left uncorrected, this silently breaks
// meter detection on very common words. This list is intentionally short
// and limited to well-established cases; it takes priority over the raw
// CMUdict entry for syllable/stress purposes only (rhyme detection still
// uses the full CMUdict phonemes, since the final sound is the same
// either way). Editable here until this becomes a user-facing override
// file, matching the French plugin's dictionnaire-perso.json pattern.
const POETIC_COMPRESSION_OVERRIDES = new Map([
  ['our', 1], ['hour', 1], ['fire', 1], ['hire', 1], ['higher', 1],
  ['buyer', 1], ['flyer', 1], ['liar', 1], ['flower', 1], ['power', 1],
  ['tower', 1], ['shower', 1], ['sour', 1], ['flour', 1], ['layer', 1],
  ['player', 1], ['prayer', 1],
]);

// Shared CMUdict lookup used by both syllable/stress and rhyme-key logic,
// so the elision fallback benefits both instead of only one.
function resolveCmudictEntry(word, cmudictIndex) {
  if (!cmudictIndex) return null;
  const key = word.toLowerCase().replace(/[^a-z']/g, '');
  if (cmudictIndex.has(key)) return cmudictIndex.get(key)[0];
  const elided = expandElidedD(key);
  if (elided && cmudictIndex.has(elided)) return cmudictIndex.get(elided)[0];
  return null;
}

function lookupWord(word, cmudictIndex, datamuseCache) {
  const overrideKey = word.toLowerCase().replace(/[^a-z']/g, '');
  if (POETIC_COMPRESSION_OVERRIDES.has(overrideKey)) {
    return {
      source: 'override',
      syllableCount: POETIC_COMPRESSION_OVERRIDES.get(overrideKey),
      stressPattern: [1],
    };
  }
  const entry = resolveCmudictEntry(word, cmudictIndex);
  if (entry) {
    return {
      source: 'cmudict',
      syllableCount: entry.stressPattern.length,
      stressPattern: entry.stressPattern,
    };
  }
  const key = word.toLowerCase().replace(/[^a-z']/g, '');
  if (datamuseCache && datamuseCache.has(key)) {
    const d = datamuseCache.get(key);
    return {
      source: 'datamuse',
      syllableCount: d.numSyllables,
      stressPattern: null, // Datamuse doesn't give reliable per-syllable stress; treated as unknown
    };
  }
  return {
    source: 'heuristic',
    syllableCount: heuristicSyllableCount(word),
    stressPattern: null,
  };
}

function syllableRigidity(syllableCount) {
  return syllableCount > 1;
}

function tokenizeLine(line) {
  return (normalizeApostrophes(line).match(/[A-Za-z']+/g) || []);
}

function analyzeLine(line, cmudictIndex, datamuseCache) {
  const words = tokenizeLine(line);
  const perWord = words.map((w) => ({ word: w, ...lookupWord(w, cmudictIndex, datamuseCache) }));
  const totalSyllables = perWord.reduce((s, w) => s + w.syllableCount, 0);

  const stressSeq = [];
  const rigidSeq = [];
  let hasUnknown = false;
  for (const w of perWord) {
    const rigid = syllableRigidity(w.syllableCount);
    if (w.stressPattern) {
      for (const s of w.stressPattern) {
        stressSeq.push(s > 0 ? 'S' : 'u');
        rigidSeq.push(rigid);
      }
    } else {
      hasUnknown = true;
      for (let i = 0; i < w.syllableCount; i++) { stressSeq.push('?'); rigidSeq.push(false); }
    }
  }

  return { words: perWord, totalSyllables, stressSeq, rigidSeq, hasUnknown };
}

const FOOT_PATTERNS = [
  { name: 'iambic', unit: 'uS' },
  { name: 'trochaic', unit: 'Su' },
  { name: 'anapestic', unit: 'uuS' },
  { name: 'dactylic', unit: 'Suu' },
];

const FEET_COUNT_NAMES = {
  1: 'monometer', 2: 'dimeter', 3: 'trimeter', 4: 'tetrameter',
  5: 'pentameter', 6: 'hexameter', 7: 'heptameter', 8: 'octameter',
};

function patternMatchesWithFlex(seq, rigidSeq, unit) {
  const unitLen = unit.length;
  if (seq.length % unitLen !== 0) return false;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === '?') return false;
    if (!rigidSeq[i]) continue;
    const expected = unit[i % unitLen];
    const actual = seq[i] === 'S' ? 'S' : 'u';
    if (actual !== expected) return false;
  }
  return true;
}

function detectMeter(stressSeq, rigidSeq) {
  const rigid = rigidSeq || stressSeq.map(() => true);
  if (stressSeq.length === 0) return { name: null, confidence: 'unknown', reason: 'empty line' };
  if (stressSeq.includes('?')) {
    return { name: null, confidence: 'unknown', reason: 'unknown stress for at least one word' };
  }

  for (const foot of FOOT_PATTERNS) {
    const unitLen = foot.unit.length;
    if (stressSeq.length % unitLen !== 0) continue;
    if (patternMatchesWithFlex(stressSeq, rigid, foot.unit)) {
      const feet = stressSeq.length / unitLen;
      const countName = FEET_COUNT_NAMES[feet] || `${feet}-foot`;
      const flexCount = rigid.filter((r) => !r).length;
      return {
        name: `${countName} ${foot.name}`,
        confidence: flexCount === 0 ? 'exact' : 'approx',
        feet, footType: foot.name, flexibleSyllables: flexCount,
      };
    }
  }
  if (stressSeq[stressSeq.length - 1] === 'u' || !rigid[rigid.length - 1]) {
    const trimmedSeq = stressSeq.slice(0, -1);
    const trimmedRigid = rigid.slice(0, -1);
    if (trimmedSeq.length % 2 === 0 && patternMatchesWithFlex(trimmedSeq, trimmedRigid, 'uS')) {
      const feet = trimmedSeq.length / 2;
      const countName = FEET_COUNT_NAMES[feet] || `${feet}-foot`;
      return { name: `${countName} iambic (feminine ending)`, confidence: 'approx', feet, footType: 'iambic' };
    }
  }
  return { name: 'irregular / mixed', confidence: 'none', rawPattern: stressSeq.join('') };
}

// Extracts, for the rhyme-relevant portion of a word: the stressed vowel
// alone ("vowel"), everything after it ("coda"), and the two combined
// ("full" — this is the traditional "rhyming part": last stressed vowel
// through the end of the word). Used both for rhyme-scheme detection
// (detectRhymeScheme) and for rhyme search (searchLocalRhymes).
function rhymePartsFromEntry(entry) {
  const phonemes = entry.phonemes;
  let lastStressIdx = -1;
  for (let i = 0; i < phonemes.length; i++) {
    if (/^[A-Z]+[12]$/.test(phonemes[i])) lastStressIdx = i;
  }
  if (lastStressIdx === -1) {
    for (let i = 0; i < phonemes.length; i++) {
      if (/^[A-Z]+\d$/.test(phonemes[i])) lastStressIdx = i;
    }
  }
  if (lastStressIdx === -1) return null;
  const vowel = phonemes[lastStressIdx].replace(/\d$/, '');
  const coda = phonemes.slice(lastStressIdx + 1).map((p) => p.replace(/\d$/, '')).join(' ');
  const full = phonemes.slice(lastStressIdx).map((p) => p.replace(/\d$/, '')).join(' ');
  return { vowel, coda, full, syllableCount: entry.stressPattern.length };
}

function rhymePartsForWord(word, cmudictIndex) {
  const entry = resolveCmudictEntry(word, cmudictIndex);
  if (!entry) return null;
  return rhymePartsFromEntry(entry);
}

function rhymeKeyForWord(word, cmudictIndex) {
  const parts = rhymePartsForWord(word, cmudictIndex);
  return parts ? parts.full : null;
}

// perfect: identical rhyming part (stressed vowel + everything after).
// near: either the same coda with a different vowel (consonance, e.g.
// "hand"/"end") or the same stressed vowel with a different coda
// (assonance, e.g. "hand"/"cap"). An empty coda never counts toward a
// consonance match on its own — otherwise every open-vowel word would
// falsely "near-rhyme" with every other open-vowel word.
function classifyRhymeMatch(a, b) {
  if (!a || !b) return null;
  if (a.full === b.full) return 'perfect';
  if (a.coda !== '' && a.coda === b.coda) return 'near';
  if (a.vowel === b.vowel && a.full !== b.full) return 'near';
  return null;
}

// Scans the whole CMUdict index for words that perfect- or near-rhyme
// with `word`. Runs entirely offline. options: { letter, syllables }.
function searchLocalRhymes(word, cmudictIndex, options) {
  const opts = options || {};
  if (!cmudictIndex) return null;
  const queryKey = word.toLowerCase().replace(/[^a-z']/g, '');
  const queryParts = rhymePartsForWord(word, cmudictIndex);
  if (!queryParts) return null;

  const letter = opts.letter ? opts.letter.toLowerCase() : null;
  const syllables = opts.syllables ? Number(opts.syllables) : null;

  const perfect = [];
  const near = [];
  for (const [candidateWord, entries] of cmudictIndex) {
    if (candidateWord === queryKey) continue;
    if (letter && !candidateWord.startsWith(letter)) continue;
    const parts = rhymePartsFromEntry(entries[0]);
    if (!parts) continue;
    if (syllables && parts.syllableCount !== syllables) continue;
    const cls = classifyRhymeMatch(queryParts, parts);
    if (cls === 'perfect') perfect.push({ word: candidateWord, syllableCount: parts.syllableCount });
    else if (cls === 'near') near.push({ word: candidateWord, syllableCount: parts.syllableCount });
  }
  perfect.sort((a, b) => a.word.localeCompare(b.word));
  near.sort((a, b) => a.word.localeCompare(b.word));
  return { perfect, near, queryFound: true };
}

function lastWordOfLine(line) {
  const words = tokenizeLine(line);
  return words.length ? words[words.length - 1] : null;
}

function detectRhymeScheme(lines, cmudictIndex) {
  const keys = lines.map((l) => {
    const w = lastWordOfLine(l);
    return w ? rhymeKeyForWord(w, cmudictIndex) : null;
  });
  const scheme = [];
  const seen = new Map();
  let nextLetter = 65;
  for (const k of keys) {
    if (k === null) { scheme.push('?'); continue; }
    if (!seen.has(k)) { seen.set(k, String.fromCharCode(nextLetter)); nextLetter++; }
    scheme.push(seen.get(k));
  }
  return { scheme: scheme.join(''), keys };
}

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
async function fetchDatamuseRhymes(word, near) {
  const rel = near ? 'rel_nry' : 'rel_rhy';
  const url = `https://api.datamuse.com/words?${rel}=${encodeURIComponent(word.toLowerCase())}&max=100`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  return Array.isArray(data) ? data.map((d) => ({ word: d.word, numSyllables: d.numSyllables })) : [];
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

// ============================================================
// Vault file discovery (mirrors the French plugin's search order,
// since BRAT only syncs main.js/manifest.json/styles.css)
// ============================================================
async function findAndReadVaultFile(app, manifest, filenames, overridePath) {
  const configDir = app.vault.configDir;
  const candidates = [];
  if (overridePath) candidates.push(overridePath);
  for (const name of filenames) {
    candidates.push(`${configDir}/plugins/${manifest.id}/${name}`);
    candidates.push(`${configDir}/${name}`);
    candidates.push(name); // vault root
  }
  for (const path of candidates) {
    try {
      if (await app.vault.adapter.exists(path)) {
        return await app.vault.adapter.read(path);
      }
    } catch (e) { /* try next candidate */ }
  }
  // last resort: recursive search anywhere in the vault
  const files = app.vault.getFiles();
  for (const name of filenames) {
    const match = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (match) {
      try { return await app.vault.read(match); } catch (e) { /* ignore */ }
    }
  }
  return null;
}

// Same search order as findAndReadVaultFile, but also returns the resolved
// path — needed for the personal dictionary, which the plugin writes back to.
async function findVaultFileWithPath(app, manifest, filenames, overridePath) {
  const configDir = app.vault.configDir;
  const candidates = [];
  if (overridePath) candidates.push(overridePath);
  for (const name of filenames) {
    candidates.push(`${configDir}/plugins/${manifest.id}/${name}`);
    candidates.push(`${configDir}/${name}`);
    candidates.push(name);
  }
  for (const path of candidates) {
    try {
      if (await app.vault.adapter.exists(path)) {
        return { path, text: await app.vault.adapter.read(path) };
      }
    } catch (e) { /* try next candidate */ }
  }
  const files = app.vault.getFiles();
  for (const name of filenames) {
    const match = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (match) {
      try { return { path: match.path, text: await app.vault.read(match) }; } catch (e) { /* ignore */ }
    }
  }
  return null;
}

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

// ============================================================
// Inspiration / Random: built-in rare & literary vocabulary, organized by
// theme. Written from scratch for English poetry — not a translation of
// the French plugin's champsLexicaux, which is hand-curated separately for
// French vocabulary and would not transfer meaningfully. Extensible via the
// personal dictionary's "vocabularyThemes" key (see README).
// ============================================================
const INSPIRATION_THEMES = [
  {
    theme: 'Forest & trees',
    triggers: ['forest', 'wood', 'woods', 'tree', 'trees', 'grove'],
    words: [
      { word: 'copse', note: 'a small group of trees growing close together' },
      { word: 'bracken', note: 'coarse fern covering woodland ground' },
      { word: 'canopy', note: 'the uppermost spreading layer of forest branches' },
      { word: 'glade', note: 'an open, sunlit space within a forest' },
      { word: 'thicket', note: 'a dense growth of bushes or small trees' },
      { word: 'boughs', note: 'large tree branches (poetic register)' },
      { word: 'loam', note: 'rich, dark forest soil' },
      { word: 'sylvan', note: 'of or relating to woods and forests (adj.)' },
    ],
  },
  {
    theme: 'Sea & water',
    triggers: ['sea', 'ocean', 'water', 'wave', 'waves', 'river', 'tide'],
    words: [
      { word: 'brine', note: 'the sea, or its salt water' },
      { word: 'billow', note: 'a great swelling wave' },
      { word: 'shoal', note: 'a shallow sandy area, or a large group of fish' },
      { word: 'undertow', note: 'a strong current beneath the surface, pulling seaward' },
      { word: 'estuary', note: 'the wide mouth of a river meeting the sea' },
      { word: 'spume', note: 'sea foam' },
      { word: 'fathom', note: 'a unit of ocean depth; also, to understand deeply' },
      { word: 'briny', note: 'salty, sea-like (adj.)' },
    ],
  },
  {
    theme: 'Night & darkness',
    triggers: ['night', 'dark', 'darkness', 'shadow', 'shadows'],
    words: [
      { word: 'gloaming', note: 'twilight, dusk' },
      { word: 'umbra', note: 'the fullest, darkest part of a shadow' },
      { word: 'nocturne', note: 'a work evoking night; also, of the night (as adj.)' },
      { word: 'murk', note: 'thick darkness or gloom' },
      { word: 'tenebrous', note: 'dark, shadowy, obscure (adj.)' },
      { word: 'witching hour', note: 'midnight, traditionally linked to dark magic' },
      { word: 'penumbra', note: 'the partial shadow around a full shadow' },
    ],
  },
  {
    theme: 'Light & dawn',
    triggers: ['light', 'sun', 'dawn', 'morning', 'day'],
    words: [
      { word: 'aurora', note: 'the dawn, personified (also: the northern lights)' },
      { word: 'luminous', note: 'giving off or full of light (adj.)' },
      { word: 'radiance', note: 'brilliant, glowing light' },
      { word: 'gleam', note: 'a brief flash or beam of light' },
      { word: 'incandescent', note: 'glowing with heat, or brilliantly bright (adj.)' },
      { word: 'daybreak', note: 'the first light of morning' },
      { word: 'halcyon', note: 'calm, peaceful, golden (as in "halcyon days")' },
    ],
  },
  {
    theme: 'Love & longing',
    triggers: ['love', 'heart', 'longing', 'desire'],
    words: [
      { word: 'ardor', note: 'intense passion or enthusiasm' },
      { word: 'yearning', note: 'a deep, wistful longing' },
      { word: 'rapture', note: 'ecstatic joy or delight' },
      { word: 'beloved', note: 'dearly loved; a person who is dearly loved' },
      { word: 'smitten', note: 'suddenly and strongly attracted' },
      { word: 'tryst', note: 'a private romantic meeting' },
      { word: 'pine (for)', note: 'to long painfully for someone or something' },
    ],
  },
  {
    theme: 'Time & mortality',
    triggers: ['time', 'death', 'die', 'dying', 'mortal', 'age', 'aging'],
    words: [
      { word: 'ephemeral', note: 'lasting a very short time (adj.)' },
      { word: 'twilight', note: 'the fading light before night — also figuratively, decline' },
      { word: 'requiem', note: 'a mourning composition or memorial act' },
      { word: 'sepulchre', note: 'a tomb, burial place' },
      { word: 'wane', note: 'to gradually decrease or fade' },
      { word: 'fleeting', note: 'passing quickly (adj.)' },
      { word: 'mortality', note: 'the condition of being subject to death' },
    ],
  },
  {
    theme: 'Weather & sky',
    triggers: ['sky', 'weather', 'wind', 'storm', 'rain', 'cloud', 'clouds'],
    words: [
      { word: 'tempest', note: 'a violent windy storm' },
      { word: 'zephyr', note: 'a gentle, mild breeze' },
      { word: 'firmament', note: 'the sky, regarded as a solid arch' },
      { word: 'squall', note: 'a sudden, violent gust of wind or storm' },
      { word: 'welkin', note: 'archaic word for the sky or heavens' },
      { word: 'gale', note: 'a very strong wind' },
      { word: 'overcast', note: 'covered in gray cloud (adj.)' },
    ],
  },
  {
    theme: 'Silence & solitude',
    triggers: ['silence', 'quiet', 'alone', 'solitude', 'lonely'],
    words: [
      { word: 'hush', note: 'a deep stillness or quiet' },
      { word: 'stillness', note: 'complete quiet and lack of motion' },
      { word: 'reclusive', note: 'avoiding others, living apart (adj.)' },
      { word: 'reverie', note: 'a state of dreamy, absorbed thought' },
      { word: 'solitary', note: 'alone, without companions (adj.)' },
      { word: 'cloister', note: 'a secluded, quiet place; also, to shut away' },
    ],
  },
  {
    theme: 'Fire',
    triggers: ['fire', 'flame', 'flames', 'burn', 'burning'],
    words: [
      { word: 'ember', note: 'a small glowing piece of coal or wood in a dying fire' },
      { word: 'conflagration', note: 'a large, destructive fire' },
      { word: 'smolder', note: 'to burn slowly with smoke but no flame' },
      { word: 'kindle', note: 'to start a fire; also, to arouse a feeling' },
      { word: 'pyre', note: 'a heap of combustible material for burning a body' },
      { word: 'incandesce', note: 'to glow with intense heat' },
    ],
  },
  {
    theme: 'Archaic & poetic diction',
    triggers: ['old', 'archaic', 'ancient', 'medieval'],
    words: [
      { word: 'ere', note: 'before (archaic)' },
      { word: 'yon', note: 'that, over there (archaic)' },
      { word: 'morrow', note: 'the next day (archaic)' },
      { word: 'oft', note: 'often (archaic)' },
      { word: 'wherefore', note: 'why, for what reason (archaic)' },
      { word: 'betwixt', note: 'between (archaic)' },
      { word: 'anon', note: 'soon, shortly (archaic)' },
      { word: 'hither', note: 'to this place (archaic)' },
    ],
  },
];

function normalizeInspirationWord(w) {
  let s = w.toLowerCase().trim();
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('es') && s.length > 3) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1);
  return s;
}

// Merges the built-in themes with any the person added to their personal
// dictionary under "vocabularyThemes" (same shape: { theme, triggers, words }).
function findInspiration(word, personalDictionary) {
  const key = normalizeInspirationWord(word);
  const allThemes = INSPIRATION_THEMES.concat(
    (personalDictionary && personalDictionary.vocabularyThemes) || []
  );
  return allThemes.filter((t) =>
    (t.triggers || []).some((trig) => normalizeInspirationWord(trig) === key)
  );
}

function allRareWords(personalDictionary) {
  const fromThemes = INSPIRATION_THEMES.flatMap((t) => t.words.map((w) => ({ ...w, theme: t.theme })));
  const personalThemeWords = ((personalDictionary && personalDictionary.vocabularyThemes) || [])
    .flatMap((t) => (t.words || []).map((w) => ({ ...w, theme: t.theme })));
  const personalRareWords = ((personalDictionary && personalDictionary.rareWords) || [])
    .map((w) => ({ ...w, theme: w.theme || 'Personal dictionary' }));
  return fromThemes.concat(personalThemeWords, personalRareWords);
}

// ----------------------------------------------------------------
// Random tab — tags, like, exclude. Mirrors the French plugin's Hasard
// tab feature-for-feature: every word (built-in or personal) can carry
// custom tags on top of its theme, be marked "liked" (surfaced more
// readily when browsing) or "excluded" (removed from the draw pool
// unless explicitly exploring exclusions). All of this is per-word
// metadata stored in the personal dictionary under "wordMeta" — it
// applies to built-in words too, not just ones the person added, since
// tagging/excluding a built-in word never means editing its definition.
// ----------------------------------------------------------------

function normalizeWordKey(w) {
  return (w || '').toLowerCase().trim();
}

function getWordMeta(personalDictionary, word) {
  const meta = (personalDictionary && personalDictionary.wordMeta) || {};
  const entry = meta[normalizeWordKey(word)];
  return {
    tags: (entry && entry.tags) || [],
    liked: !!(entry && entry.liked),
    excluded: !!(entry && entry.excluded),
  };
}

// Every pool entry, enriched with its theme (always a tag) plus any
// custom tags/liked/excluded state from the personal dictionary.
function poolWithMeta(personalDictionary) {
  return allRareWords(personalDictionary).map((w) => {
    const meta = getWordMeta(personalDictionary, w.word);
    const themeTag = w.theme || 'Untagged';
    const tags = Array.from(new Set([themeTag, ...meta.tags]));
    return { ...w, tags, liked: meta.liked, excluded: meta.excluded };
  });
}

function allTagsFromPool(pool) {
  const tags = new Set();
  pool.forEach((w) => w.tags.forEach((t) => tags.add(t)));
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

// filters: { includeTags: Set, includeMode: 'and'|'or', excludeTags: Set,
//            onlyLiked: bool, onlyExcluded: bool (review mode) }
function filterPool(pool, filters) {
  return pool.filter((w) => {
    if (filters.onlyExcluded) return w.excluded;
    if (w.excluded) return false; // hidden by default unless reviewing exclusions
    if (filters.onlyLiked && !w.liked) return false;
    if (filters.excludeTags.size > 0 && w.tags.some((t) => filters.excludeTags.has(t))) return false;
    if (filters.includeTags.size > 0) {
      const matches = filters.includeTags.size &&
        (filters.includeMode === 'and'
          ? Array.from(filters.includeTags).every((t) => w.tags.includes(t))
          : Array.from(filters.includeTags).some((t) => w.tags.includes(t)));
      if (!matches) return false;
    }
    return true;
  });
}

// Datamuse "means like" — a loose online complement to the built-in themes,
// opt-in only, never queried automatically.
async function fetchDatamuseMeansLike(word) {
  const url = `https://api.datamuse.com/words?ml=${encodeURIComponent(word.toLowerCase())}&max=25`;
  const res = await requestUrl({
    url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  const data = res.json;
  return Array.isArray(data) ? data.map((d) => d.word) : [];
}

// ============================================================
// VIEW
// ============================================================
class PoetsNotebookView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = 'syllables';
    this.datamuseCache = new Map();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Poet's Notebook"; }
  getIcon() { return 'feather'; }

  async onOpen() {
    this.render();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('poets-notebook-container');

    const tabBar = container.createDiv({ cls: 'pn-tab-bar' });
    const tabs = [
      ['syllables', 'Syllables'],
      ['rhymes', 'Rhymes'],
      ['inspiration', 'Inspiration'],
      ['synonyms', 'Synonyms'],
      ['definitions', 'Definitions'],
      ['guide', 'Guide'],
      ['random', 'Random'],
    ];
    for (const [id, label] of tabs) {
      const btn = tabBar.createEl('button', { text: label, cls: 'pn-tab-btn' });
      if (id === this.activeTab) btn.addClass('pn-tab-active');
      btn.addEventListener('click', () => {
        this.activeTab = id;
        this.render();
      });
    }

    const body = container.createDiv({ cls: 'pn-tab-body' });

    if (!this.plugin.cmudictIndex) {
      const banner = body.createDiv({ cls: 'pn-banner' });
      banner.setText(
        'CMUdict not found in this vault. Syllable/stress accuracy will fall back to an approximate heuristic. ' +
        'Place a cmudict.dict file at the vault root, in .obsidian/, or in this plugin\'s folder, then reopen this panel.'
      );
    }

    if (this.activeTab === 'syllables') {
      this.renderSyllablesTab(body);
    } else if (this.activeTab === 'rhymes') {
      this.renderRhymesTab(body);
    } else if (this.activeTab === 'synonyms') {
      this.renderSynonymsTab(body);
    } else if (this.activeTab === 'definitions') {
      this.renderDefinitionsTab(body);
    } else if (this.activeTab === 'guide') {
      this.renderGuideTab(body);
    } else if (this.activeTab === 'inspiration') {
      this.renderInspirationTab(body);
    } else if (this.activeTab === 'random') {
      this.renderRandomTab(body);
    } else {
      body.createDiv({ cls: 'pn-placeholder', text: 'Coming soon.' });
    }
  }

  renderSyllablesTab(body) {
    const wrap = body.createDiv({ cls: 'pn-syllables-tab' });

    const btnRow = wrap.createDiv({ cls: 'pn-actions-row' });
    const flipBtn = btnRow.createEl('button', { cls: 'pn-icon-btn pn-icon-btn-cyan' });
    const flipIcon = flipBtn.createSpan({ text: '🔄' });
    const flipLabel = flipBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Sonorities' });
    flipBtn.createSpan({ cls: 'pn-experimental-tag', text: 'experimental' });
    flipBtn.setAttr('title', 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings). Experimental: newer and less battle-tested than the rest of this plugin — feedback welcome.');
    const rightActions = btnRow.createDiv({ cls: 'pn-actions-row-right' });
    const copyBtn = rightActions.createEl('button', { cls: 'pn-icon-btn' });
    copyBtn.createSpan({ text: '📋' });
    copyBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Copy draft' });
    const clearBtn = rightActions.createEl('button', { cls: 'pn-icon-btn' });
    clearBtn.createSpan({ text: '🗑️' });
    clearBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Clear draft' });

    const textarea = wrap.createEl('textarea', {
      cls: 'pn-textarea',
      attr: { placeholder: 'Paste your poem here, one verse per line…', rows: '8' },
    });
    if (this.plugin.draftText) textarea.value = this.plugin.draftText;

    const flipZone = wrap.createDiv({ cls: 'pn-flip-zone' });
    const flipCard = flipZone.createDiv({ cls: 'pn-flip-card' });
    const flipFront = flipCard.createDiv({ cls: 'pn-flip-face' });
    const flipBack = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-back' });

    // "Rhyme colors" only makes sense on the Structure face (it colours
    // the rhyme-scheme badges below) — lives inside flipFront so it's
    // never shown while looking at Sonorities on the back face.
    const optionsRow = flipFront.createDiv({ cls: 'pn-options-row' });
    const colorLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const colorCheckbox = colorLabel.createEl('input', { attr: { type: 'checkbox' } });
    colorCheckbox.checked = this.plugin.settings.showRhymeColors !== false;
    colorLabel.appendText(' Rhyme colors');

    const results = flipFront.createDiv({ cls: 'pn-results' });
    const summary = flipFront.createDiv({ cls: 'pn-summary' });

    const syncFlipHeight = () => {
      const activeFace = flipZone.hasClass('pn-flipped') ? flipBack : flipFront;
      requestAnimationFrame(() => { flipCard.style.height = activeFace.scrollHeight + 'px'; });
    };

    let debounceTimer = null;
    const scheduleAnalysis = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.runAnalysis(textarea.value, results, summary, colorCheckbox.checked);
        syncFlipHeight();
        if (flipZone.hasClass('pn-flipped')) renderSonoritiesBack();
      }, 250);
    };

    let renderSonoritiesBack = () => {}; // reassigned below, once dependencies are in scope

    textarea.addEventListener('input', () => {
      this.plugin.draftText = textarea.value;
      this.plugin.saveSettings();
      scheduleAnalysis();
    });

    colorCheckbox.addEventListener('change', async () => {
      this.plugin.settings.showRhymeColors = colorCheckbox.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });

    flipBtn.addEventListener('click', () => {
      flipZone.toggleClass('pn-flipped', !flipZone.hasClass('pn-flipped'));
      const onBack = flipZone.hasClass('pn-flipped');
      if (onBack) renderSonoritiesBack();
      syncFlipHeight();
      flipLabel.setText(onBack ? 'Structure' : 'Sonorities');
      flipBtn.setAttr('title', onBack
        ? 'Flip back to syllables, stress and rhyme scheme'
        : 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings)');
      flipIcon.addClass('pn-icon-flip');
      setTimeout(() => flipIcon.removeClass('pn-icon-flip'), 600);
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textarea.value);
        new Notice('Draft copied to clipboard');
      } catch (e) {
        new Notice('Could not copy — clipboard access denied');
      }
    });

    clearBtn.addEventListener('click', async () => {
      textarea.value = '';
      this.plugin.draftText = '';
      await this.plugin.saveSettings();
      results.empty();
      summary.empty();
      if (flipZone.hasClass('pn-flipped')) renderSonoritiesBack();
      syncFlipHeight();
    });

    renderSonoritiesBack = this.buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight);

    // Live analysis on open if a draft already exists
    if (textarea.value.trim().length > 0) scheduleAnalysis();
  }

  // Builds the back-face renderer for the Sonorities flip card. Returns a
  // function to call whenever the poem text or settings change and the
  // back face is (or becomes) visible — kept separate from the front-face
  // analysis loop so the two don't re-render each other unnecessarily.
  buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight) {
    const toolbar = flipBack.createDiv({ cls: 'pn-son-toolbar' });
    flipBack.createEl('p', {
      cls: 'pn-son-legend-hint',
      text: 'Experimental: this panel is newer and less tested than the rest of Poetry Notebook. Sound detection relies entirely on CMUdict — words missing from it are skipped rather than guessed at.',
    });
    const leftGroup = toolbar.createDiv({ cls: 'pn-son-toolbar-left' });
    const modeSelect = leftGroup.createEl('select');
    [['exact', 'Exact sounds'], ['simple', 'Simplified families'], ['extended', 'Extended families']]
      .forEach(([v, label]) => modeSelect.createEl('option', { attr: { value: v }, text: label }));
    modeSelect.value = 'simple';
    leftGroup.createSpan({ cls: 'pn-son-seuil-label', text: 'Threshold' });
    const seuilInput = leftGroup.createEl('input', { attr: { type: 'number', min: '2', value: '3', style: 'width:48px' } });

    const rightGroup = toolbar.createDiv({ cls: 'pn-son-toolbar-right' });
    const stopwordsLabel = rightGroup.createEl('label', { cls: 'pn-checkbox-label' });
    const stopwordsCheckbox = stopwordsLabel.createEl('input', { attr: { type: 'checkbox' } });
    stopwordsCheckbox.checked = true;
    stopwordsLabel.appendText(' Exclude stopwords');
    const top3Label = rightGroup.createEl('label', { cls: 'pn-checkbox-label' });
    const top3Checkbox = top3Label.createEl('input', { attr: { type: 'checkbox' } });
    top3Checkbox.checked = true;
    top3Label.appendText(' Highlight only the 3 most frequent');

    const legend = flipBack.createDiv({ cls: 'pn-son-legend' });
    flipBack.createEl('p', {
      cls: 'pn-son-legend-hint',
      text: 'Filled background = starts with this consonant. Underline = contains this vowel. A vowel-initial word (I, am, away, understand…) has no consonant to fill, so it can only ever be underlined — that\u2019s expected, not a bug.',
    });
    const draftDiv = flipBack.createDiv({ cls: 'pn-son-draft' });
    const jumpRow = flipBack.createDiv({ cls: 'pn-son-jump-row' });
    ['Alliteration', 'Consonant web', 'Internal assonance', 'Echo endings'].forEach((label) => {
      const pill = jumpRow.createEl('button', { cls: 'pn-tag-pill', text: label });
      pill.addEventListener('click', () => {
        const target = flipBack.querySelector(`[data-son-section="${label}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    const listDiv = flipBack.createDiv({ cls: 'pn-son-list' });

    let spotlightSon = null; // active in Consonant Web mode: click a son to isolate it in the draft

    const familyFn = (mode, isVowel) => {
      if (mode === 'exact') return null;
      return isVowel
        ? (mode === 'simple' ? (ph => VOWEL_FAMILY_SIMPLE[ph]) : (ph => VOWEL_FAMILY_EXTENDED[ph]))
        : (mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
    };

    const colourFor = (son, isVowel) => (isVowel ? THEME_VOWEL[son] : THEME_CONSONANT[son]) || 'pn-son-c1';

    const render = () => {
      if (!this.plugin.cmudictIndex) {
        flipBack.empty();
        flipBack.createDiv({ cls: 'pn-son-empty', text: 'CMUdict is required for Sonorities — see the banner above.' });
        return;
      }
      const mode = modeSelect.value;
      const seuilMin = parseInt(seuilInput.value, 10) || 3;
      const excludeStopwords = stopwordsCheckbox.checked;
      const poemText = textarea.value;
      const result = analyzeSonorities(poemText, this.plugin.cmudictIndex, this.plugin.sonorityBaseline, { excludeStopwords, seuilMin, mode });

      // ---- legend ----
      legend.empty();
      const consFams = mode === 'exact'
        ? Array.from(new Set(result.alliteration.map((e) => e.son)))
        : Array.from(new Set(result.alliteration.map((e) => e.son)));
      const g1 = legend.createSpan({ cls: 'pn-son-legend-group' });
      g1.createSpan({ text: 'Alliteration: ' });
      consFams.forEach((f) => {
        g1.createSpan({ cls: 'pn-son-legend-dot ' + colourFor(f, false) });
        g1.createSpan({ text: f + '  ' });
      });
      const vowFams = Array.from(new Set(result.internalAssonance.map((e) => e.son)));
      const g2 = legend.createSpan({ cls: 'pn-son-legend-group' });
      g2.createSpan({ text: 'Assonance: ' });
      vowFams.forEach((f) => {
        g2.createSpan({ cls: 'pn-son-legend-underline ' + colourFor(f, true) });
        g2.createSpan({ text: f + '  ' });
      });

      // ---- draft with highlighting ----
      draftDiv.empty();
      const dominantAllit = top3Checkbox.checked ? new Set(result.alliteration.slice(0, 3).map((e) => e.son)) : null;
      const dominantAsson = top3Checkbox.checked ? new Set(result.internalAssonance.slice(0, 3).map((e) => e.son)) : null;

      const famAllitFn = familyFn(mode, false);
      const famAssonFn = familyFn(mode, true);

      poemText.split('\n').forEach((line, idxLine) => {
        const lineEl = draftDiv.createDiv({ cls: 'pn-son-line' });
        lineEl.createSpan({ cls: 'pn-son-linenum', text: String(idxLine + 1) });
        if (!line.trim()) { lineEl.createEl('br'); return; }
        const fragments = line.split(/(\s+)/);
        fragments.forEach((frag) => {
          if (!frag.trim()) { lineEl.createSpan({ text: frag }); return; }
          const wordRaw = frag.replace(/[^A-Za-z']/g, '');
          if (!wordRaw) { lineEl.createSpan({ text: frag }); return; }
          const wl = wordRaw.toLowerCase().replace(/'/g, '');
          const entry = resolveCmudictEntry(wordRaw, this.plugin.cmudictIndex);
          const isStop = excludeStopwords && STOPWORDS_EN.has(wl);

          if (spotlightSon) {
            if (!entry || isStop) { lineEl.createSpan({ cls: 'pn-son-dim', text: frag }); return; }
            const cons = allConsonantsOfEntry(entry);
            const matches = cons.filter((c) => (famAllitFn ? famAllitFn(c.ph) : c.ph) === spotlightSon);
            if (matches.length === 0) { lineEl.createSpan({ cls: 'pn-son-dim', text: frag }); return; }
            // Best-effort position: highlight the whole word (ARPAbet
            // phoneme index doesn't map cleanly back to letter offsets
            // the way orthographic scanning does in the French plugin).
            lineEl.createSpan({ cls: 'pn-son-init ' + colourFor(spotlightSon, false), text: frag });
            return;
          }

          if (!entry || isStop) { lineEl.createSpan({ text: frag }); return; }

          const initPh = initialConsonantOfEntry(entry);
          const initKey = initPh ? (famAllitFn ? famAllitFn(initPh) : initPh) : null;
          const showInit = initKey && (!dominantAllit || dominantAllit.has(initKey));

          const vows = allVowelsOfEntry(entry);
          const firstVowKey = vows.length ? (famAssonFn ? famAssonFn(vows[0].ph) : vows[0].ph) : null;
          const showVox = firstVowKey && (!dominantAsson || dominantAsson.has(firstVowKey));

          if (showInit && showVox) {
            const span = lineEl.createSpan({ cls: 'pn-son-init pn-son-vox ' + colourFor(initKey, false), text: frag });
            span.addClass(colourFor(firstVowKey, true) + '-underline');
          } else if (showInit) {
            lineEl.createSpan({ cls: 'pn-son-init ' + colourFor(initKey, false), text: frag });
          } else if (showVox) {
            lineEl.createSpan({ cls: 'pn-son-vox ' + colourFor(firstVowKey, true), text: frag });
          } else {
            lineEl.createSpan({ text: frag });
          }
        });
      });

      // ---- lists ----
      listDiv.empty();
      const renderSection = (label, subtitle, list, isVowel, clickable) => {
        const h4 = listDiv.createEl('h4', { text: label });
        h4.setAttr('data-son-section', label);
        listDiv.createEl('p', { cls: 'pn-son-subtitle', text: subtitle });
        if (list.length === 0) {
          listDiv.createDiv({ cls: 'pn-son-empty', text: 'Nothing above the current threshold.' });
          return;
        }
        list.forEach((entry) => {
          const row = listDiv.createDiv({ cls: 'pn-son-row' + (clickable ? ' pn-son-row-clickable' : '') });
          if (clickable && entry.son === spotlightSon) row.addClass('pn-son-row-active');
          const badge = row.createSpan({ cls: 'pn-son-badge ' + colourFor(entry.son, isVowel), text: entry.son.slice(0, 3) });
          const words = Array.from(new Set(entry.occurrences.map((o) => o.word)));
          const lines = Array.from(new Set(entry.occurrences.map((o) => o.line)));
          row.createSpan({ cls: 'pn-son-words', text: `${words.join(', ')} — line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` });
          row.createSpan({ cls: 'pn-son-count', text: `${entry.count} words` });
          if (entry.ratio != null) {
            const ratioSpan = row.createSpan({ cls: 'pn-son-ratio' + (entry.ratio >= 1.5 ? ' pn-son-ratio-high' : '') });
            ratioSpan.setText('×' + entry.ratio.toFixed(1));
            ratioSpan.setAttr('title', `This sound occurs ${entry.ratio.toFixed(1)}× more often in this poem than in English on average (baseline computed live from the ${this.plugin.cmudictIndex.size}-word CMUdict index loaded in this vault).`);
          }
          if (clickable) {
            row.addEventListener('click', () => {
              spotlightSon = spotlightSon === entry.son ? null : entry.son;
              render();
              syncFlipHeight();
              if (spotlightSon) requestAnimationFrame(() => draftDiv.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            });
          }
        });
      };
      renderSection('Alliteration', 'Consonant sound repeated at the start of nearby words', result.alliteration, false, false);
      renderSection('Consonant web', 'A consonant sound that recurs anywhere in a word — attack, middle, or coda — not just at the start. Click a sound to isolate it in the draft above.', result.consonantWeb, false, true);
      renderSection('Internal assonance', 'A vowel sound that recurs inside nearby words, aside from end-of-line rhyme', result.internalAssonance, true, false);
      renderSection('Echo endings', 'Word endings that echo each other mid-line, not just the established end-of-line rhyme — needs at least one occurrence away from the line end, otherwise it would just restate the rhyme scheme.', result.echoEndings.map((e) => ({ ...e, son: e.key })), false, false);

      syncFlipHeight();
    };

    modeSelect.addEventListener('change', render);
    seuilInput.addEventListener('change', render);
    stopwordsCheckbox.addEventListener('change', render);
    top3Checkbox.addEventListener('change', () => { render(); });

    return render;
  }

  meterAbbrev(meter) {
    if (!meter.name) return '?';
    if (meter.footType === 'iambic') return 'I';
    if (meter.footType === 'trochaic') return 'T';
    if (meter.footType === 'anapestic') return 'A';
    if (meter.footType === 'dactylic') return 'D';
    return '~'; // irregular / mixed
  }

  async runAnalysis(text, resultsEl, summaryEl, showColors) {
    resultsEl.empty();
    if (summaryEl) summaryEl.empty();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    // Optional Datamuse enrichment for words CMUdict doesn't know, only if allowed
    if (this.plugin.settings.allowDatamuse) {
      const allWords = new Set();
      for (const line of lines) for (const w of tokenizeLine(line)) allWords.add(w.toLowerCase());
      for (const w of allWords) {
        const key = w.replace(/[^a-z']/g, '');
        if (this.plugin.cmudictIndex && this.plugin.cmudictIndex.has(key)) continue;
        if (this.datamuseCache.has(key)) continue;
        try {
          const d = await fetchDatamuseSyllables(key);
          if (d) this.datamuseCache.set(key, d);
        } catch (e) { /* offline or API error: silently fall back to heuristic */ }
      }
    }

    const analyses = lines.map((line) => {
      const a = analyzeLine(line, this.plugin.cmudictIndex, this.datamuseCache);
      const meter = detectMeter(a.stressSeq, a.rigidSeq);
      return { line, ...a, meter };
    });

    const rhyme = detectRhymeScheme(lines, this.plugin.cmudictIndex);
    const rhymeColors = ['#e07a5f', '#3d84a8', '#81b29a', '#f2cc8f', '#9b5de5', '#00bbf9', '#f15bb5', '#fee440'];
    const letterColor = {};
    let colorIdx = 0;
    let totalSyllables = 0;

    lines.forEach((line, i) => {
      const a = analyses[i];
      totalSyllables += a.totalSyllables;
      const row = resultsEl.createDiv({ cls: 'pn-line-row' });

      const letter = rhyme.scheme[i];
      if (!(letter in letterColor)) { letterColor[letter] = rhymeColors[colorIdx % rhymeColors.length]; colorIdx++; }
      const color = (showColors && letter !== '?') ? letterColor[letter] : 'var(--text-muted)';
      row.style.borderLeftColor = color;

      const textEl = row.createSpan({ cls: 'pn-line-text', text: line });
      textEl.setAttr('title', a.words.map((w) => `${w.word}(${w.syllableCount}, ${w.source})`).join(' '));

      const badges = row.createDiv({ cls: 'pn-badges' });

      const rhymeBadge = badges.createSpan({ cls: 'pn-badge pn-rhyme-badge', text: letter });
      rhymeBadge.style.color = color;
      rhymeBadge.style.borderColor = color;
      rhymeBadge.setAttr('title', letter === '?' ? 'Rhyme unknown (word missing from CMUdict)' : `Rhyme group ${letter}`);

      const meterBadge = badges.createSpan({
        cls: `pn-badge pn-meter-badge pn-meter-${a.meter.confidence}`,
        text: this.meterAbbrev(a.meter),
      });
      meterBadge.setAttr('title', a.meter.name ? `${a.meter.name} (${a.meter.confidence})` : `Meter unknown — ${a.meter.reason}`);

      badges.createSpan({ cls: 'pn-badge pn-syll-badge', text: String(a.totalSyllables) });
    });

    if (summaryEl) {
      const avg = (totalSyllables / lines.length).toFixed(1);
      summaryEl.createSpan({ text: `${lines.length} line${lines.length > 1 ? 's' : ''}` });
      summaryEl.createSpan({ cls: 'pn-summary-total', text: `${totalSyllables} syllables` });
      summaryEl.createSpan({ text: `≈ ${avg} / line` });
    }
  }

  renderRhymesTab(body) {
    const wrap = body.createDiv({ cls: 'pn-rhymes-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word to rhyme with…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const filtersRow = wrap.createDiv({ cls: 'pn-rhyme-filters-row' });
    const letterLabel = filtersRow.createEl('label', { cls: 'pn-filter-label', text: 'Starts with:' });
    const letterInput = letterLabel.createEl('input', {
      cls: 'pn-rhyme-filter-input',
      attr: { type: 'text', maxlength: '3', placeholder: 'any' },
    });
    const syllLabel = filtersRow.createEl('label', { cls: 'pn-filter-label', text: 'Syllables:' });
    const syllInput = syllLabel.createEl('input', {
      cls: 'pn-rhyme-filter-input',
      attr: { type: 'number', min: '1', placeholder: 'any' },
    });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online)');

    const rhymezoneLink = optionsRow.createEl('a', {
      cls: 'pn-external-link',
      text: 'Open in RhymeZone ↗',
      attr: { href: '#' },
    });
    rhymezoneLink.addEventListener('click', (evt) => {
      evt.preventDefault();
      const w = wordInput.value.trim();
      if (!w) return;
      window.open(`https://www.rhymezone.com/r/rhyme.cgi?Word=${encodeURIComponent(w)}&typeofrhyme=perfect`, '_blank');
    });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = () => {
      const word = wordInput.value.trim();
      if (!word) return;
      this.runRhymeSearch(word, {
        letter: letterInput.value.trim(),
        syllables: syllInput.value ? Number(syllInput.value) : null,
        includeDatamuse: datamuseCheckbox.checked,
      }, results);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  renderRhymeGroup(container, title, items, cls) {
    if (!items || items.length === 0) return;
    const section = container.createDiv({ cls: `pn-rhyme-section ${cls || ''}` });
    section.createEl('h4', { text: `${title} (${items.length})` });

    const bySyllables = new Map();
    for (const item of items) {
      const n = item.syllableCount || 0;
      if (!bySyllables.has(n)) bySyllables.set(n, []);
      bySyllables.get(n).push(item.word);
    }
    const syllableCounts = [...bySyllables.keys()].sort((a, b) => a - b);
    for (const n of syllableCounts) {
      const row = section.createDiv({ cls: 'pn-rhyme-syll-group' });
      row.createSpan({ cls: 'pn-rhyme-syll-label', text: n ? `${n} syll.:` : '?:' });
      row.createSpan({ cls: 'pn-rhyme-word-list', text: bySyllables.get(n).join(', ') });
    }
  }

  async runRhymeSearch(word, options, resultsEl) {
    resultsEl.empty();

    if (!this.plugin.cmudictIndex) {
      resultsEl.createDiv({ cls: 'pn-banner', text: 'CMUdict not loaded — rhyme search needs it. See the banner above.' });
      return;
    }

    const local = searchLocalRhymes(word, this.plugin.cmudictIndex, {
      letter: options.letter,
      syllables: options.syllables,
    });

    if (!local) {
      resultsEl.createDiv({ text: `"${word}" wasn't found in CMUdict, so I can't work out its rhyme sound. Try a different spelling.` });
      return;
    }

    this.renderRhymeGroup(resultsEl, 'Perfect rhymes', local.perfect, 'pn-rhyme-perfect');

    if (!this.plugin.settings.strictRhymeMode) {
      this.renderRhymeGroup(resultsEl, 'Near / slant rhymes', local.near, 'pn-rhyme-near');
    }

    if (local.perfect.length === 0 && local.near.length === 0) {
      resultsEl.createDiv({ text: 'No rhymes found in CMUdict for this word with the current filters.' });
    }

    if (options.includeDatamuse) {
      const loading = resultsEl.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
      try {
        const [perfect, near] = await Promise.all([
          fetchDatamuseRhymes(word, false),
          this.plugin.settings.strictRhymeMode ? Promise.resolve([]) : fetchDatamuseRhymes(word, true),
        ]);
        loading.remove();
        const localWords = new Set([...local.perfect, ...local.near].map((w) => w.word));
        const extraPerfect = perfect.filter((d) => !localWords.has(d.word.toLowerCase()));
        const extraNear = near.filter((d) => !localWords.has(d.word.toLowerCase()));
        this.renderRhymeGroup(
          resultsEl, 'Online — Datamuse (perfect, not already listed above)',
          extraPerfect.map((d) => ({ word: d.word, syllableCount: d.numSyllables || 0 })),
          'pn-rhyme-online'
        );
        if (!this.plugin.settings.strictRhymeMode) {
          this.renderRhymeGroup(
            resultsEl, 'Online — Datamuse (near, not already listed above)',
            extraNear.map((d) => ({ word: d.word, syllableCount: d.numSyllables || 0 })),
            'pn-rhyme-online'
          );
        }
      } catch (e) {
        loading.setText('Datamuse request failed (offline, or the API is unavailable).');
      }
    }
  }

  // ---- Synonyms tab ----
  renderSynonymsTab(body) {
    const wrap = body.createDiv({ cls: 'pn-synonyms-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online)');

    const synPanel = this.buildRelationPanel(wrap, {
      kind: 'synonyms',
      label: 'Synonym',
      fetchOnline: fetchDatamuseSynonyms,
      addToDict: (w, s) => this.plugin.addSynonymToPersonalDictionary(w, s),
      removeFromDict: (w, s) => this.plugin.removeSynonymFromPersonalDictionary(w, s),
    });
    const antPanel = this.buildRelationPanel(wrap, {
      kind: 'antonyms',
      label: 'Antonym',
      fetchOnline: fetchDatamuseAntonyms,
      addToDict: (w, s) => this.plugin.addAntonymToPersonalDictionary(w, s),
      removeFromDict: (w, s) => this.plugin.removeAntonymFromPersonalDictionary(w, s),
    });

    const doSearch = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      await Promise.all([
        synPanel.search(word, datamuseCheckbox.checked),
        antPanel.search(word, datamuseCheckbox.checked),
      ]);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  // Builds one Synonyms- or Antonyms-shaped panel: a manual add row plus a
  // results area (personal dictionary list with remove buttons, and an
  // optional Datamuse section). `opts.kind` is the personal-dictionary key
  // ('synonyms' or 'antonyms'). Returns { search(word, includeOnline) }.
  buildRelationPanel(wrap, opts) {
    wrap.createEl('h4', { cls: 'pn-relation-panel-title', text: opts.label + 's' });

    const addRow = wrap.createDiv({ cls: 'pn-synonym-add-row' });
    const addLabel = addRow.createSpan({ cls: 'pn-synonym-add-label', text: `${opts.label} for “…”:` });
    const addInput = addRow.createEl('input', { cls: 'pn-rhyme-input', attr: { type: 'text' } });
    const addBtn = addRow.createEl('button', { text: 'Save to my dictionary' });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });
    let currentWord = '';

    const renderPersonalSection = () => {
      const key = currentWord.toLowerCase().trim();
      const dict = this.plugin.personalDictionary[opts.kind] || {};
      const list = dict[key] || [];
      let section = results.querySelector('.pn-synonym-personal');
      if (!section) {
        section = results.createDiv({ cls: 'pn-rhyme-section pn-synonym-personal' });
        results.prepend(section);
      }
      section.empty();
      section.createEl('h4', { text: `My dictionary (${list.length})` });
      if (list.length === 0) {
        section.createDiv({ cls: 'pn-rhyme-word-list', text: `No ${opts.label.toLowerCase()}s saved for this word yet.` });
      } else {
        const listEl = section.createDiv({ cls: 'pn-rhyme-word-list' });
        list.forEach((s) => {
          const chip = listEl.createSpan({ cls: 'pn-synonym-chip pn-synonym-chip-saved' });
          chip.appendText(s + ' ');
          const removeBtn = chip.createEl('span', { cls: 'pn-synonym-remove', text: '×' });
          removeBtn.addEventListener('click', async () => {
            await opts.removeFromDict(currentWord, s);
            renderPersonalSection();
          });
        });
      }
    };

    const search = async (word, includeOnline) => {
      currentWord = word;
      addLabel.setText(`${opts.label} for “${word}”:`);
      results.empty();
      renderPersonalSection();

      if (includeOnline) {
        const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
        try {
          const found = await opts.fetchOnline(word);
          loading.remove();
          const personalSet = new Set(((this.plugin.personalDictionary[opts.kind] || {})[word.toLowerCase()]) || []);
          const extra = found.filter((s) => !personalSet.has(s.toLowerCase()) && s.toLowerCase() !== word.toLowerCase());
          const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-online' });
          section.createEl('h4', { text: `Online — Datamuse (${extra.length})` });
          const list = section.createDiv({ cls: 'pn-rhyme-word-list' });
          if (extra.length === 0) {
            list.setText(`No additional ${opts.label.toLowerCase()}s found.`);
          } else {
            extra.forEach((s, i) => {
              const btn = list.createEl('button', { cls: 'pn-synonym-chip', text: s });
              btn.setAttr('title', `Click to save "${s}" into your personal dictionary`);
              btn.addEventListener('click', async () => {
                const res = await opts.addToDict(word, s);
                new Notice(res.ok ? `Saved "${s}" to your dictionary` : 'Could not save — see console');
                if (res.ok) renderPersonalSection();
              });
              if (i < extra.length - 1) list.appendText(' ');
            });
          }
        } catch (e) {
          loading.setText('Datamuse request failed (offline, or the API is unavailable).');
        }
      }
    };

    addBtn.addEventListener('click', async () => {
      const value = addInput.value.trim();
      if (!currentWord) { new Notice('Search a word first — the manual field only adds an entry FOR that word.'); return; }
      if (!value) { new Notice(`Type the ${opts.label.toLowerCase()} to save.`); return; }
      const res = await opts.addToDict(currentWord, value);
      if (!res.ok && res.reason === 'self') {
        new Notice(`"${value}" is the same as "${currentWord}" — a word can't be its own ${opts.label.toLowerCase()}.`);
        return;
      }
      new Notice(res.ok ? `Saved "${value}" to your dictionary` : 'Could not save — see console');
      if (res.ok) { addInput.value = ''; renderPersonalSection(); }
    });

    return { search };
  }

  // ---- Definitions tab ----
  renderDefinitionsTab(body) {
    const wrap = body.createDiv({ cls: 'pn-definitions-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Look up', cls: 'mod-cta' });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      results.empty();
      const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Looking up Wiktionary…' });

      let entry = null;
      try {
        entry = await fetchWiktionaryEntry(word);
      } catch (e) {
        loading.setText('Wiktionary request failed (offline, or the API is unavailable).');
        return;
      }
      loading.remove();

      const link = results.createEl('a', {
        cls: 'pn-external-link', text: `View "${word}" on Wiktionary ↗`, attr: { href: '#' },
      });
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        window.open(`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`, '_blank');
      });

      if (!entry) {
        results.createDiv({ text: `No English entry found for "${word}" on Wiktionary.` });
        return;
      }

      if (entry.etymology) {
        const etySection = results.createDiv({ cls: 'pn-rhyme-section pn-etymology' });
        etySection.createEl('h4', { text: 'Etymology' });
        etySection.createDiv({ text: entry.etymology });
      }

      if (entry.definitions.length === 0) {
        results.createDiv({ text: 'No definitions parsed for this word — the Wiktionary page may use an unusual layout. Use the link above to read it directly.' });
      }

      for (const group of entry.definitions) {
        const section = results.createDiv({ cls: 'pn-rhyme-section pn-definition-group' });
        section.createEl('h4', { text: group.pos });
        const numbered = group.lines.filter((l) => /^\d+\.\s/.test(l));
        const toShow = numbered.length > 0 ? numbered : group.lines;
        const list = section.createEl('ol', { cls: 'pn-definition-list' });
        for (const line of toShow) {
          list.createEl('li', { text: line.replace(/^\d+\.\s*/, '') });
        }
      }
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  // ---- Guide tab (static reference content, no network) ----
  renderGuideTab(body) {
    const wrap = body.createDiv({ cls: 'pn-guide-tab' });

    const section = (title, html) => {
      const s = wrap.createDiv({ cls: 'pn-guide-section' });
      s.createEl('h3', { text: title });
      const content = s.createDiv({ cls: 'pn-guide-content' });
      content.innerHTML = html;
    };

    section('Counting syllables & meter', `
      <p>English meter counts <strong>stressed feet</strong>, not raw syllables — unlike French,
      where counting syllables alone is usually enough. A line's meter name has two parts:
      the <em>foot type</em> (the stress pattern that repeats) and the <em>foot count</em>.</p>
      <table class="pn-guide-table">
        <tr><th>Foot</th><th>Pattern</th><th>Example</th></tr>
        <tr><td>Iambic</td><td>unstressed–STRESSED</td><td>a-<strong>WAY</strong></td></tr>
        <tr><td>Trochaic</td><td>STRESSED–unstressed</td><td><strong>TI</strong>-ger</td></tr>
        <tr><td>Anapestic</td><td>unstressed–unstressed–STRESSED</td><td>in the <strong>NIGHT</strong></td></tr>
        <tr><td>Dactylic</td><td>STRESSED–unstressed–unstressed</td><td><strong>MER</strong>-ri-ly</td></tr>
      </table>
      <table class="pn-guide-table">
        <tr><th>Feet</th><th>Name</th></tr>
        <tr><td>4</td><td>Tetrameter</td></tr>
        <tr><td>5</td><td>Pentameter (the default for sonnets, blank verse)</td></tr>
        <tr><td>6</td><td>Hexameter</td></tr>
      </table>
      <p>Common variations that are still considered "regular": a <strong>feminine ending</strong>
      (one extra unstressed syllable at the end of an iambic line), and occasional substitution
      of one foot (often a trochee for the first iamb of a line).</p>
    `);

    section('Rhyme: perfect vs. slant', `
      <p><strong>Perfect rhyme</strong> (a.k.a. full/exact/true rhyme): the stressed vowel and
      everything after it match exactly (<em>light</em> / <em>flight</em>), while the sound
      right before that vowel differs (otherwise it's just repetition, not rhyme).</p>
      <p><strong>Slant / near rhyme</strong> (a.k.a. half rhyme, off rhyme): the sounds are close
      but not identical. Two common kinds:</p>
      <ul>
        <li><strong>Consonance</strong> — matching final consonants, different vowel
        (<em>hand</em> / <em>end</em>)</li>
        <li><strong>Assonance</strong> — matching stressed vowel, different ending
        (<em>hand</em> / <em>cat</em>)</li>
      </ul>
      <p>The Rhymes tab's "strict / loose" setting controls whether slant rhymes are shown at all —
      they're always kept in a visually separate section from perfect rhymes, never mixed in.</p>
    `);

    section('Classic forms', `
      <ul>
        <li><strong>Shakespearean (English) sonnet</strong> — 14 lines, iambic pentameter,
        <code>ABAB CDCD EFEF GG</code> (three quatrains + a closing couplet).</li>
        <li><strong>Petrarchan (Italian) sonnet</strong> — 14 lines, iambic pentameter,
        <code>ABBA ABBA</code> octave + a sestet with a freer pattern, often
        <code>CDECDE</code> or <code>CDCDCD</code>.</li>
        <li><strong>Blank verse</strong> — unrhymed iambic pentameter (Shakespeare's plays,
        Milton's <em>Paradise Lost</em>).</li>
        <li><strong>Villanelle</strong> — 19 lines: five tercets + a closing quatrain, only two
        rhyme sounds throughout, with two refrain lines that keep reappearing on a fixed
        schedule.</li>
        <li><strong>Limerick</strong> — 5 lines, <code>AABBA</code>, anapestic, lines 1/2/5 longer
        (3 feet) than 3/4 (2 feet); almost always comic.</li>
      </ul>
    `);

    section('Elision & contractions', `
      <p>Older English poetry often marks a deliberately dropped syllable with an apostrophe
      to fit the meter: <em>o'er</em> (over), <em>'twas</em> (it was), <em>ne'er</em> (never),
      <em>walk'd</em> (walked, said as one syllable). The Syllables tab already expands the
      common <code>-'d</code> pattern automatically; if you hit one it doesn't catch, the
      per-word tooltip will show which source (CMUdict / override / heuristic) was used, which
      is usually the fastest way to spot the mismatch.</p>
    `);
  }

  // ---- Inspiration tab ----
  renderInspirationTab(body) {
    const wrap = body.createDiv({ cls: 'pn-inspiration-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'A common word (forest, sea, night, love…)' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online, "means like")');

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      results.empty();

      const themes = findInspiration(word, this.plugin.personalDictionary);
      if (themes.length === 0) {
        results.createDiv({ text: `No built-in theme is triggered by "${word}" yet. Try a broader word (forest, sea, night, love, time, fire, weather, silence…), or add your own theme to the personal dictionary.` });
      } else {
        for (const t of themes) {
          const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-perfect' });
          section.createEl('h4', { text: `${t.theme} (${t.words.length})` });
          const list = section.createEl('div', { cls: 'pn-inspiration-word-grid' });
          for (const w of t.words) {
            const item = list.createDiv({ cls: 'pn-inspiration-word' });
            item.createEl('strong', { text: w.word });
            item.createSpan({ text: ' — ' + w.note });
          }
        }
      }

      if (datamuseCheckbox.checked) {
        const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
        try {
          const related = await fetchDatamuseMeansLike(word);
          loading.remove();
          const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-online' });
          section.createEl('h4', { text: `Online — Datamuse, related to "${word}" (${related.length})` });
          section.createDiv({ cls: 'pn-rhyme-word-list', text: related.length ? related.join(', ') : 'Nothing found.' });
        } catch (e) {
          loading.setText('Datamuse request failed (offline, or the API is unavailable).');
        }
      }
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  // ---- Random tab ----
  renderRandomTab(body) {
    const wrap = body.createDiv({ cls: 'pn-random-tab' });

    // Filter state, kept in closure across re-renders of this tab instance.
    const state = {
      includeTags: new Set(),
      excludeTags: new Set(),
      includeMode: 'or', // 'or' | 'and' — only matters with 2+ include tags
      onlyLiked: false,
      onlyExcluded: false, // review mode: browse only excluded words
    };
    let lastPick = null; // re-rendered in place when its tags/like/excluded change

    const quickRow = wrap.createDiv({ cls: 'pn-random-quickrow' });
    const likedPill = quickRow.createEl('button', { cls: 'pn-tag-pill', text: '♥ Liked only' });
    const reviewPill = quickRow.createEl('button', { cls: 'pn-tag-pill', text: '🚫 Review excluded' });

    const includeDetails = wrap.createEl('details', { cls: 'pn-random-filters' });
    includeDetails.createEl('summary', { text: 'Filter by tag' });
    const includeModeRow = includeDetails.createDiv({ cls: 'pn-tag-mode-row' });
    const includeModeBtn = includeModeRow.createEl('button', { cls: 'pn-tag-pill', text: 'Match: any (OR)' });
    const includePillsRow = includeDetails.createDiv({ cls: 'pn-tag-pills-row' });

    const excludeDetails = wrap.createEl('details', { cls: 'pn-random-filters' });
    excludeDetails.createEl('summary', { text: 'Exclude tags' });
    const excludePillsRow = excludeDetails.createDiv({ cls: 'pn-tag-pills-row' });

    const statsLine = wrap.createDiv({ cls: 'pn-random-stats' });
    const btn = wrap.createEl('button', { text: 'Give me a rare word', cls: 'mod-cta pn-random-btn' });
    const result = wrap.createDiv({ cls: 'pn-random-result' });

    const currentPool = () => poolWithMeta(this.plugin.personalDictionary);
    const currentFiltered = () => filterPool(currentPool(), state);

    const renderTagPills = (rowEl, tags, activeSet, onToggle) => {
      rowEl.empty();
      tags.forEach((tag) => {
        const pill = rowEl.createEl('button', { cls: 'pn-tag-pill', text: tag });
        if (activeSet.has(tag)) pill.addClass('pn-tag-pill-active');
        pill.addEventListener('click', () => {
          if (activeSet.has(tag)) activeSet.delete(tag); else activeSet.add(tag);
          refreshFilters();
        });
      });
    };

    const refreshFilters = () => {
      const pool = currentPool();
      const tags = allTagsFromPool(pool);
      renderTagPills(includePillsRow, tags, state.includeTags, refreshFilters);
      renderTagPills(excludePillsRow, tags, state.excludeTags, refreshFilters);
      includeModeBtn.setText(state.includeMode === 'and' ? 'Match: all (AND)' : 'Match: any (OR)');
      includeModeRow.style.display = state.includeTags.size > 1 ? 'block' : 'none';
      likedPill.toggleClass('pn-tag-pill-active', state.onlyLiked);
      reviewPill.toggleClass('pn-tag-pill-active', state.onlyExcluded);
      const n = currentFiltered().length;
      statsLine.setText(`${n} word${n === 1 ? '' : 's'} match${n === 1 ? 'es' : ''} the current filters (${pool.length} total).`);
    };

    likedPill.addEventListener('click', () => { state.onlyLiked = !state.onlyLiked; refreshFilters(); });
    reviewPill.addEventListener('click', () => { state.onlyExcluded = !state.onlyExcluded; refreshFilters(); });
    includeModeBtn.addEventListener('click', () => {
      state.includeMode = state.includeMode === 'and' ? 'or' : 'and';
      refreshFilters();
    });

    const renderCard = (pick) => {
      lastPick = pick;
      result.empty();
      const card = result.createDiv({ cls: 'pn-rhyme-section pn-rhyme-perfect pn-random-card' });
      card.createEl('h2', { text: pick.word });
      card.createDiv({ cls: 'pn-random-note', text: pick.note });

      const tagsRow = card.createDiv({ cls: 'pn-random-tags' });
      pick.tags.forEach((tag) => {
        const isTheme = tag === pick.theme;
        const chip = tagsRow.createSpan({ cls: 'pn-tag-chip' + (isTheme ? ' pn-tag-chip-theme' : ''), text: tag });
        if (!isTheme) {
          const remove = chip.createSpan({ cls: 'pn-tag-chip-remove', text: ' ✕' });
          remove.addEventListener('click', async () => {
            await this.plugin.removeWordTag(pick.word, tag);
            renderCard({ ...pick, tags: pick.tags.filter((t) => t !== tag) });
            refreshFilters();
          });
        }
      });
      const addTagRow = card.createDiv({ cls: 'pn-random-add-tag' });
      const addTagInput = addTagRow.createEl('input', { attr: { type: 'text', placeholder: 'Add a tag…' } });
      const addTagBtn = addTagRow.createEl('button', { cls: 'pn-icon-btn', text: '+' });
      const doAddTag = async () => {
        const t = addTagInput.value.trim();
        if (!t) return;
        await this.plugin.addWordTag(pick.word, t);
        addTagInput.value = '';
        renderCard({ ...pick, tags: Array.from(new Set([...pick.tags, t])) });
        refreshFilters();
      };
      addTagBtn.addEventListener('click', doAddTag);
      addTagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddTag(); });

      const statusRow = card.createDiv({ cls: 'pn-random-status-row' });
      const likeBtn = statusRow.createEl('button', { cls: 'pn-tag-pill' + (pick.liked ? ' pn-tag-pill-active' : ''), text: '♥ Liked' });
      likeBtn.addEventListener('click', async () => {
        const liked = await this.plugin.toggleWordLiked(pick.word);
        renderCard({ ...pick, liked });
        refreshFilters();
      });
      const excludeBtn = statusRow.createEl('button', { cls: 'pn-tag-pill' + (pick.excluded ? ' pn-tag-pill-active' : ''), text: '🚫 Exclude from draws' });
      excludeBtn.addEventListener('click', async () => {
        const excluded = await this.plugin.toggleWordExcluded(pick.word);
        renderCard({ ...pick, excluded });
        refreshFilters();
      });

      const linkRow = card.createDiv({ cls: 'pn-random-links' });
      const defLink = linkRow.createEl('a', { text: 'Look up in Definitions →', attr: { href: '#' } });
      defLink.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.activeTab = 'definitions';
        this.render();
        setTimeout(() => {
          const input = this.containerEl.querySelector('.pn-definitions-tab .pn-rhyme-input');
          if (input) { input.value = pick.word; input.focus(); }
        }, 0);
      });
      const rhymeLink = linkRow.createEl('a', { text: 'Find rhymes →', attr: { href: '#' } });
      rhymeLink.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.activeTab = 'rhymes';
        this.render();
        setTimeout(() => {
          const input = this.containerEl.querySelector('.pn-rhymes-tab .pn-rhyme-input');
          if (input) { input.value = pick.word; input.focus(); }
        }, 0);
      });
    };

    btn.addEventListener('click', () => {
      const pool = currentFiltered();
      if (pool.length === 0) { result.empty(); result.setText('No word matches the current filters.'); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      renderCard(pick);
    });

    refreshFilters();
  }
}

// ============================================================
// SETTINGS TAB
// ============================================================
class PoetsNotebookSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: "Poet's Notebook settings" });

    new Setting(containerEl)
      .setName('Allow Datamuse online lookups')
      .setDesc('When a word is missing from CMUdict, query the free Datamuse API for its syllable count. Off by default — the plugin works fully offline otherwise.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.allowDatamuse)
        .onChange(async (v) => { this.plugin.settings.allowDatamuse = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Strict rhyme mode')
      .setDesc('When off, near/slant rhymes are also shown, in a visually separate section, never mixed with perfect rhymes.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.strictRhymeMode)
        .onChange(async (v) => { this.plugin.settings.strictRhymeMode = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Custom CMUdict path (optional)')
      .setDesc('Vault-relative path to cmudict.dict. Leave empty to auto-search the plugin folder, .obsidian/, the vault root, and the whole vault.')
      .addText((t) => t
        .setValue(this.plugin.settings.cmudictPathOverride)
        .onChange(async (v) => { this.plugin.settings.cmudictPathOverride = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reload CMUdict')
      .setDesc('Re-scan the vault for cmudict.dict after adding or moving the file.')
      .addButton((b) => b
        .setButtonText('Reload')
        .onClick(async () => {
          await this.plugin.loadCmudict();
          this.plugin.sonorityBaseline = buildPhonemeFrequencyBaseline(this.plugin.cmudictIndex);
          new Notice(this.plugin.cmudictIndex
            ? `CMUdict loaded: ${this.plugin.cmudictIndex.size} words`
            : 'CMUdict not found in this vault.');
        }));

    containerEl.createEl('h3', { text: 'Personal dictionary' });

    new Setting(containerEl)
      .setName('Custom personal dictionary path (optional)')
      .setDesc('Vault-relative path to poets-notebook-dictionary.json. Leave empty to auto-search, or to create a new one at the vault root the first time you save a synonym.')
      .addText((t) => t
        .setValue(this.plugin.settings.personalDictPathOverride)
        .onChange(async (v) => { this.plugin.settings.personalDictPathOverride = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reload personal dictionary')
      .setDesc('Re-scan the vault after adding or moving poets-notebook-dictionary.json.')
      .addButton((b) => b
        .setButtonText('Reload')
        .onClick(async () => {
          await this.plugin.loadPersonalDictionary();
          const count = Object.keys(this.plugin.personalDictionary.synonyms || {}).length;
          new Notice(`Personal dictionary loaded from ${this.plugin.personalDictionaryPath} (${count} word${count === 1 ? '' : 's'})`);
        }));
  }
}

// ============================================================
// PLUGIN
// ============================================================
module.exports = class PoetsNotebookPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.draftText = saved && saved.draftText ? saved.draftText : '';
    this.cmudictIndex = null;
    this.personalDictionary = { synonyms: {} };
    this.personalDictionaryPath = 'poets-notebook-dictionary.json';

    await this.loadCmudict();
    await this.loadPersonalDictionary();
    // Computed once here rather than on every keystroke — scanning the
    // whole ~135k-word index is not something to redo per render.
    this.sonorityBaseline = buildPhonemeFrequencyBaseline(this.cmudictIndex);

    this.registerView(VIEW_TYPE, (leaf) => new PoetsNotebookView(leaf, this));

    this.addRibbonIcon('feather', "Poet's Notebook", () => this.activateView());
    this.addCommand({
      id: 'open-poets-notebook',
      name: "Open Poet's Notebook",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new PoetsNotebookSettingTab(this.app, this));
  }

  async loadCmudict() {
    try {
      const text = await findAndReadVaultFile(
        this.app, this.manifest, ['cmudict.dict', 'cmudict.txt'], this.settings.cmudictPathOverride
      );
      this.cmudictIndex = text ? buildCmudictIndex(text) : null;
    } catch (e) {
      console.error("Poet's Notebook: failed to load CMUdict", e);
      this.cmudictIndex = null;
    }
  }

  // Personal dictionary: same multi-location search as CMUdict (plugin
  // folder → .obsidian/ → vault root → anywhere in the vault), since BRAT
  // only syncs main.js/manifest.json/styles.css. If nothing is found, a new
  // one is created at the vault root on first save.
  async loadPersonalDictionary() {
    try {
      const found = await findVaultFileWithPath(
        this.app, this.manifest, ['poets-notebook-dictionary.json'], this.settings.personalDictPathOverride
      );
      if (found) {
        this.personalDictionary = JSON.parse(found.text);
        if (!this.personalDictionary.synonyms) this.personalDictionary.synonyms = {};
        if (!this.personalDictionary.antonyms) this.personalDictionary.antonyms = {};
        if (!this.personalDictionary.wordMeta) this.personalDictionary.wordMeta = {};
        this.personalDictionaryPath = found.path;
      } else {
        this.personalDictionary = { synonyms: {}, antonyms: {} };
        this.personalDictionaryPath = 'poets-notebook-dictionary.json';
      }
    } catch (e) {
      console.error("Poet's Notebook: failed to load personal dictionary", e);
      this.personalDictionary = { synonyms: {}, antonyms: {} };
      this.personalDictionaryPath = 'poets-notebook-dictionary.json';
    }
  }

  async savePersonalDictionary() {
    try {
      await this.app.vault.adapter.write(this.personalDictionaryPath, JSON.stringify(this.personalDictionary, null, 2));
      return true;
    } catch (e) {
      console.error("Poet's Notebook: failed to save personal dictionary", e);
      return false;
    }
  }

  async _addWordRelation(kind, word, related) {
    const key = word.toLowerCase().trim();
    const value = related.toLowerCase().trim();
    if (!key || !value) return { ok: false, reason: 'empty' };
    if (key === value) return { ok: false, reason: 'self' };
    if (!this.personalDictionary[kind]) this.personalDictionary[kind] = {};
    if (!this.personalDictionary[kind][key]) this.personalDictionary[kind][key] = [];
    if (this.personalDictionary[kind][key].includes(value)) return { ok: true };
    this.personalDictionary[kind][key].push(value);
    const saved = await this.savePersonalDictionary();
    return { ok: saved };
  }

  async _removeWordRelation(kind, word, related) {
    const key = word.toLowerCase().trim();
    const value = related.toLowerCase().trim();
    if (!this.personalDictionary[kind] || !this.personalDictionary[kind][key]) return true;
    this.personalDictionary[kind][key] = this.personalDictionary[kind][key].filter((s) => s !== value);
    if (this.personalDictionary[kind][key].length === 0) delete this.personalDictionary[kind][key];
    return await this.savePersonalDictionary();
  }

  // ---- Random tab metadata: tags / liked / excluded, per word ----
  // Applies to any word from the pool, built-in or personal — tagging or
  // excluding a built-in word never touches its definition, it's tracked
  // entirely separately here.
  _ensureWordMetaEntry(word) {
    if (!this.personalDictionary.wordMeta) this.personalDictionary.wordMeta = {};
    const key = normalizeWordKey(word);
    if (!this.personalDictionary.wordMeta[key]) {
      this.personalDictionary.wordMeta[key] = { tags: [], liked: false, excluded: false };
    }
    return this.personalDictionary.wordMeta[key];
  }

  async addWordTag(word, tag) {
    const t = (tag || '').trim();
    if (!t) return false;
    const entry = this._ensureWordMetaEntry(word);
    if (!entry.tags.includes(t)) entry.tags.push(t);
    return this.savePersonalDictionary();
  }

  async removeWordTag(word, tag) {
    const entry = this._ensureWordMetaEntry(word);
    entry.tags = entry.tags.filter((x) => x !== tag);
    return this.savePersonalDictionary();
  }

  async toggleWordLiked(word) {
    const entry = this._ensureWordMetaEntry(word);
    entry.liked = !entry.liked;
    await this.savePersonalDictionary();
    return entry.liked;
  }

  async toggleWordExcluded(word) {
    const entry = this._ensureWordMetaEntry(word);
    entry.excluded = !entry.excluded;
    await this.savePersonalDictionary();
    return entry.excluded;
  }

  async addSynonymToPersonalDictionary(word, synonym) {
    return this._addWordRelation('synonyms', word, synonym);
  }

  async removeSynonymFromPersonalDictionary(word, synonym) {
    return this._removeWordRelation('synonyms', word, synonym);
  }

  async addAntonymToPersonalDictionary(word, antonym) {
    return this._addWordRelation('antonyms', word, antonym);
  }

  async removeAntonymFromPersonalDictionary(word, antonym) {
    return this._removeWordRelation('antonyms', word, antonym);
  }

  async saveSettings() {
    await this.saveData({ ...this.settings, draftText: this.draftText });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload() {
    // views are cleaned up by Obsidian automatically
  }
};
