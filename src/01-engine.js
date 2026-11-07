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

