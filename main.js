'use strict';

const { Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, requestUrl } = require('obsidian');

const VIEW_TYPE = 'poets-notebook-view';

const DEFAULT_SETTINGS = {
  allowDatamuse: false,       // never queried without this being explicitly on
  strictRhymeMode: false,     // false = also show slant/near rhymes, kept visually separate
  cmudictPathOverride: '',    // optional explicit vault-relative path
  personalDictPathOverride: '', // optional explicit vault-relative path for the personal dictionary
  showRhymeColors: true,      // color the rhyme badges by group
  continuousRhymes: true,     // rhyme letters carry on across stanzas (off = each stanza restarts at A)
  poemForm: 'free',          // fixed form checked in the Syllables tab ('free' = none, see 16-forms.js)
  onlineSources: [],          // tabs whose online source is ticked: 'rhymes' | 'inspiration' | 'synonyms'
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


// Whole-poem analysis: stanzas (split on blank lines), per-line analysis
// and meter, and rhyme letters per stanza. With `continuous` false each
// stanza restarts at A (like the French sibling's default-off option);
// with it true, letters carry on across stanzas. Shared by the display
// and the Markdown export.
function nameRhymeScheme(letters) {
  if (!letters || letters.length !== 4 || letters.some((l) => !l || l === '?')) return null;
  const [a, b, c, d] = letters;
  if (a === b && c === d && a !== c) return 'couplets (AABB)';
  if (a === c && b === d && a !== b) return 'cross rhyme (ABAB)';
  if (a === d && b === c && a !== b) return 'enclosed rhyme (ABBA)';
  return null;
}

function analyzePoem(text, cmudictIndex, datamuseCache, continuous) {
  const lines = text.split(/\r?\n/).map((raw) => {
    if (!raw.trim()) return { text: raw, empty: true };
    const a = analyzeLine(raw, cmudictIndex, datamuseCache);
    return { text: raw, empty: false, ...a, meter: detectMeter(a.stressSeq, a.rigidSeq), letter: null, colorIdx: null };
  });

  const stanzaIdx = [];
  let current = [];
  lines.forEach((l, i) => {
    if (l.empty) { if (current.length) { stanzaIdx.push(current); current = []; } }
    else current.push(i);
  });
  if (current.length) stanzaIdx.push(current);

  let seen = new Map();
  let next = 0;
  const stanzas = stanzaIdx.map((indices) => {
    if (!continuous) { seen = new Map(); next = 0; }
    const letters = indices.map((i) => {
      const w = lastWordOfLine(lines[i].text);
      const k = w ? rhymeKeyForWord(w, cmudictIndex) : null;
      if (k === null) return '?';
      if (!seen.has(k)) { seen.set(k, String.fromCharCode(65 + (next % 26))); next++; }
      return seen.get(k);
    });
    indices.forEach((i, j) => {
      lines[i].letter = letters[j];
      lines[i].colorIdx = letters[j] === '?' ? null : (letters[j].charCodeAt(0) - 65);
    });
    return { indices, letters, name: nameRhymeScheme(letters) };
  });
  return { lines, stanzas };
}

// Pulls a poem out of a note: the editor selection if any, else the first
// ```poem block, else the whole note — minus frontmatter and Markdown
// syntax (headings, quotes/callouts, list markers, links, emphasis, HTML).
// Mirrors the French plugin's "Note active" button.
function extractPoemFromNote(content, selection) {
  let text, source;
  if (selection && selection.trim()) { text = selection; source = 'selection'; }
  else {
    const body = (content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const block = body.match(/^(`{3,}|~{3,})\s*(poem|poeme|poème)\b[^\n]*\n([\s\S]*?)^\1\s*$/mi);
    if (block) { text = block[3]; source = 'poem block'; }
    else { text = body; source = 'whole note'; }
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(>\s*)+(\[![^\]]*\]\S*\s*)?/, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|==)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+$/, ''));
  const clean = lines.map((l) => (/^(-{3,}|\*{3,}|`{3,}.*|~{3,}.*|(#[\w/-]+\s*)+)$/.test(l.trim()) ? '' : l));
  return { text: clean.join('\n').replace(/\n{3,}/g, '\n\n').trim(), source };
}

// Same palette as the French sibling plugin, so rhyme groups read alike.
const RHYME_PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d68910', '#16a085', '#c2185b', '#5d4037', '#455a64', '#7f8c8d'];

// "trimeter iambic" → "iambic trimeter" for display.
function meterLabel(meter) {
  if (!meter || !meter.name) return null;
  if (meter.confidence === 'none') return 'irregular';
  const m = meter.name.match(/^(\S+) (iambic|trochaic|anapestic|dactylic)(.*)$/);
  return m ? `${m[2]} ${m[1]}${m[3]}` : meter.name;
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


// ------------------------------------------------------------
// CMUdict automatic download (like the French plugin's base dictionary):
// when no cmudict.dict is found in the vault, the plugin fetches the
// gzipped copy attached to its own GitHub release (CMUdict is public
// domain), checks it, and saves it in the plugin folder. Disclosed in the
// README; one attempt per session, never blocking the plugin's start-up.
// ------------------------------------------------------------
const CMUDICT_RELEASE = '1.5.0'; // release whose cmudict.dict.gz is used; change only if CMUdict changes
const CMUDICT_URL = `https://github.com/sbridel/poetry-notebook/releases/download/${CMUDICT_RELEASE}/cmudict.dict.gz`;

async function gunzipToText(bytes) {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  const zlib = require('zlib'); // desktop (Electron) fallback if the web API is missing
  return zlib.gunzipSync(Buffer.from(bytes)).toString('utf-8');
}

// Downloads, validates (decompresses and indexes, at least 100k words)
// BEFORE writing, so a broken download never replaces anything.
// Returns { text, index } or throws.
async function downloadCmudict(app, manifest) {
  const res = await requestUrl({ url: CMUDICT_URL, throw: false });
  if (!res || res.status !== 200 || !res.arrayBuffer) throw new Error(`HTTP ${res && res.status}`);
  const text = await gunzipToText(res.arrayBuffer);
  const index = buildCmudictIndex(text);
  if (!index || index.size < 100000) throw new Error('unexpected CMUdict file');
  await app.vault.adapter.write(`${app.vault.configDir}/plugins/${manifest.id}/cmudict.dict`, text);
  return { text, index };
}

// ------------------------------------------------------------
// Published base data (themes for Inspiration, rare words for Random),
// built from Roget's Thesaurus (1911) and WordNet — same scheme as the
// French plugin's published base: a gzipped file attached to the GitHub
// release, downloaded into the plugin folder, the personal dictionary
// staying a layer on top. See DATA-LICENSES.md for sources and licences.
// ------------------------------------------------------------
const BASE_DATA_VERSION = '1.5.0'; // change only when the base data changes
const BASE_DATA_FILE = 'poetry-notebook-base.json.gz';
const BASE_DATA_URL = `https://github.com/sbridel/poetry-notebook/releases/download/${BASE_DATA_VERSION}/${BASE_DATA_FILE}`;

function pluginFolder(app, manifest) {
  return `${app.vault.configDir}/plugins/${manifest.id}`;
}

// Parses and checks a base file's bytes; throws if it isn't one.
async function parseBaseData(bytes) {
  const base = JSON.parse(await gunzipToText(bytes));
  if (!base || base.formatBase !== 1 || !Array.isArray(base.themes) || !Array.isArray(base.rareWords)) {
    throw new Error('unexpected base data file');
  }
  return base;
}

// Downloads the base, validates it BEFORE writing (a broken download never
// replaces a working file), saves the .gz in the plugin folder.
async function downloadBaseData(app, manifest) {
  const res = await requestUrl({ url: BASE_DATA_URL, throw: false });
  if (!res || res.status !== 200 || !res.arrayBuffer) throw new Error(`HTTP ${res && res.status}`);
  const base = await parseBaseData(res.arrayBuffer);
  await app.vault.adapter.writeBinary(`${pluginFolder(app, manifest)}/${BASE_DATA_FILE}`, res.arrayBuffer);
  return base;
}

// Local copy if present and of the expected version, else null.
async function readLocalBaseData(app, manifest) {
  const path = `${pluginFolder(app, manifest)}/${BASE_DATA_FILE}`;
  if (!(await app.vault.adapter.exists(path))) return null;
  const base = await parseBaseData(await app.vault.adapter.readBinary(path));
  return base.version === BASE_DATA_VERSION ? base : null;
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
// Published base data (see 03-vault-files.js), set once it is loaded.
let BASE_THEMES = [];
let BASE_RARE_WORDS = [];
function setBaseData(base) {
  BASE_THEMES = (base && base.themes) || [];
  BASE_RARE_WORDS = (base && base.rareWords) || [];
}

function findInspiration(word, personalDictionary) {
  const key = normalizeInspirationWord(word);
  const allThemes = INSPIRATION_THEMES.concat(
    (personalDictionary && personalDictionary.vocabularyThemes) || [],
    BASE_THEMES
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
    .map((w) => (typeof w === 'string' ? { word: w } : w))
    .map((w) => ({ ...w, theme: w.theme || 'Personal dictionary' }));
  // One entry per word: personal entries first, then built-in, then base.
  const seen = new Set();
  return personalRareWords.concat(personalThemeWords, fromThemes, BASE_RARE_WORDS).filter((w) => {
    const k = normalizeWordKey(w && w.word);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
    const tags = Array.from(new Set([themeTag, ...(w.tags || []), ...meta.tags]));
    return { ...w, tags, userTags: meta.tags, liked: meta.liked, excluded: meta.excluded };
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
// SHARED RENDERING HELPERS
// English counterparts of the French plugin's display helpers (word
// chips with a syllable count, "+ N more" lists, collapsible source
// blocks, tag chips and collapsible filter sections), so every tab
// is built from the same pieces in both plugins.
// ============================================================
const WORDS_SHOWN_CAP = 15;

// A word list item is either a plain string or { word, rank } when the
// source gives a relevance (0-100, or null when unknown).
function itemText(item) { return typeof item === 'string' ? item : (item ? item.word : ''); }
function itemRank(item) { return (item && typeof item === 'object' && typeof item.rank === 'number') ? item.rank : null; }

function syllablesOfExpression(expr, cmudictIndex) {
  return (expr || '').trim().split(/\s+/).filter(Boolean)
    .reduce((n, w) => n + (lookupWord(w, cmudictIndex, null).syllableCount || 0), 0);
}

function lastWordOfExpression(expr) {
  const words = (expr || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : '';
}

// True when both words have a known rhyme key and it is the same.
function wordsRhyme(a, b, cmudictIndex) {
  const ka = rhymeKeyForWord(a, cmudictIndex);
  const kb = rhymeKeyForWord(b, cmudictIndex);
  return ka !== null && ka === kb;
}

// Syllable filter value: '' (any), '1'…'4', or '5+'.
function filterBySyllables(list, value, cmudictIndex) {
  if (!value) return list || [];
  const target = value === '5+' ? null : parseInt(value, 10);
  return (list || []).filter((w) => {
    const n = syllablesOfExpression(itemText(w), cmudictIndex);
    return target === null ? n >= 5 : n === target;
  });
}

function filterByRhyme(list, target, cmudictIndex) {
  if (!target) return list || [];
  return (list || []).filter((w) => wordsRhyme(target, lastWordOfExpression(itemText(w)), cmudictIndex));
}

function makeSyllableSelect(parent) {
  const wrap = parent.createDiv({ cls: 'pn-select-wrap' });
  const select = wrap.createEl('select', { cls: 'pn-filtre-syllabes' });
  wrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
  [['', 'Any syllables'], ['1', '1 syll.'], ['2', '2 syll.'], ['3', '3 syll.'], ['4', '4 syll.'], ['5+', '5+ syll.']]
    .forEach(([v, label]) => select.createEl('option', { attr: { value: v }, text: label }));
  return select;
}

// A toggle pill (checkbox hidden, filled when checked). The filled state
// comes from an is-checked class kept in sync here rather than a CSS
// :has(input:checked) selector, which Obsidian's review flags as costly.
function makeTogglePill(parent, label, checked, title, cls) {
  const lbl = parent.createEl('label', { cls: cls || 'pn-hasard-toggle-pool' });
  const input = lbl.createEl('input', { attr: { type: 'checkbox' } });
  input.checked = !!checked;
  lbl.createSpan({ text: ' ' + label });
  if (title) lbl.setAttr('title', title);
  const sync = () => lbl.toggleClass('is-checked', input.checked);
  input.addEventListener('change', sync);
  sync();
  return input;
}

// Collapsible block for one source of results (local dictionary, Datamuse…).
function makeSourceBlock(container, title, open, local) {
  const details = container.createEl('details', { cls: 'pn-syn-source-details' + (local ? ' pn-syn-source-local' : '') });
  if (open) details.setAttr('open', 'true');
  details.createEl('summary', { cls: 'pn-syn-source-details-titre', text: title });
  return details.createDiv({ cls: 'pn-syn-source-corps' });
}

// One word chip with its syllable count as a superscript. With an
// `excluded` Set, clicking the chip toggles it in/out of that set
// (greyed + struck through) — used before saving online results.
function makeWordChip(parent, item, cls, cmudictIndex, excluded) {
  const word = itemText(item);
  const rank = itemRank(item);
  const span = parent.createSpan({ cls, text: word });
  if (rank !== null && rank >= 70) span.style.fontWeight = '700';
  span.createEl('sup', { text: String(syllablesOfExpression(word, cmudictIndex)) });
  const rankNote = rank !== null ? `Relevance (Datamuse, rescaled): ${rank}/100` : '';
  if (excluded) {
    span.addClass('pn-mot-excluable');
    span.setAttr('title', (rankNote ? rankNote + ' — ' : '') + 'click to leave this word out before saving to your personal dictionary (click again to undo).');
    span.addEventListener('click', () => {
      if (excluded.has(word)) { excluded.delete(word); span.removeClass('pn-mot-exclu'); }
      else { excluded.add(word); span.addClass('pn-mot-exclu'); }
    });
  } else if (rankNote) {
    span.setAttr('title', rankNote);
  }
  return span;
}

// Shows the first WORDS_SHOWN_CAP items, then a "+ N more" button.
function showWithLimit(parent, list, renderOne) {
  list.slice(0, WORDS_SHOWN_CAP).forEach(renderOne);
  const rest = list.slice(WORDS_SHOWN_CAP);
  if (rest.length > 0) {
    const more = parent.createEl('button', { cls: 'pn-mot-voir-plus', text: `+ ${rest.length} more` });
    more.addEventListener('click', () => { more.remove(); rest.forEach(renderOne); });
  }
}

// Titled group of word chips. opts: { type ('syno'|'anto'|null),
// excluded (Set, makes chips excludable), extraCls (on the group),
// onChip(span, word) (hook after each chip is created) }.
function makeWordGroup(container, title, list, chipCls, cmudictIndex, opts) {
  if (!list || list.length === 0) return null;
  const o = opts || {};
  const g = container.createDiv({ cls: 'pn-groupe' + (o.type ? ' pn-groupe-' + o.type : '') + (o.extraCls ? ' ' + o.extraCls : '') });
  g.createDiv({ cls: 'pn-titre', text: `${title} (${list.length})` });
  const words = g.createDiv({ cls: 'pn-mots' });
  showWithLimit(words, list, (w) => {
    const span = makeWordChip(words, w, chipCls, cmudictIndex, o.excluded);
    if (o.onChip) o.onChip(span, itemText(w));
  });
  return g;
}

// ---- tags (Random tab) ----
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return RHYME_PALETTE[hash % RHYME_PALETTE.length];
}

function makeTagChip(container, tag, onRemove) {
  const chip = container.createSpan({ cls: 'pn-tag-chip' });
  const c = tagColor(tag);
  chip.style.background = c;
  chip.style.borderColor = c;
  chip.style.color = '#fff';
  chip.createSpan({ text: tag });
  if (onRemove) {
    const x = chip.createSpan({ cls: 'pn-tag-chip-x', text: ' ×' });
    x.addEventListener('click', onRemove);
  }
  return chip;
}

// Collapsible section with a coloured frame and an "· N active" badge.
function makeCollapsibleSection(container, title, colorCls) {
  const wrap = container.createDiv({ cls: 'pn-hasard-section-repliable' + (colorCls ? ' ' + colorCls : '') });
  const header = wrap.createDiv({ cls: 'pn-hasard-section-header' });
  const caret = header.createSpan({ cls: 'pn-hasard-section-caret', text: '▸' });
  header.createSpan({ cls: 'pn-hasard-section-titre', text: title });
  const badge = header.createSpan({ cls: 'pn-hasard-section-badge' });
  const body = wrap.createDiv({ cls: 'pn-hasard-section-body' });
  body.style.display = 'none';
  let open = false;
  let countFn = () => 0;
  const render = () => {
    const n = countFn();
    badge.setText(n > 0 ? `· ${n} active` : '');
    caret.setText(open ? '▾' : '▸');
    body.style.display = open ? 'block' : 'none';
  };
  header.addEventListener('click', () => { open = !open; render(); });
  return { body, render, setCountBadge: (fn) => { countFn = fn; } };
}

// "See all tags" toggle + searchable grid of tag buttons.
function makeAllTagsPanel(container, toggleBtn, getTags, onPick, label) {
  label = label || 'See all tags';
  let open = false;
  const box = container.createDiv({ cls: 'pn-hasard-tous-tags-box' });
  box.style.display = 'none';
  const search = box.createEl('input', { cls: 'pn-hasard-tous-tags-filtre', attr: { type: 'text', placeholder: 'Filter the list…' } });
  const grid = box.createDiv({ cls: 'pn-hasard-tous-tags-grille' });
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    grid.empty();
    const tags = getTags().filter((t) => !q || t.toLowerCase().includes(q));
    if (tags.length === 0) { grid.createEl('p', { cls: 'pn-vide', text: 'No tag matches.' }); return; }
    tags.forEach((tag) => {
      const b = grid.createEl('button', { cls: 'pn-hasard-preset-btn-mini', text: tag });
      const c = tagColor(tag);
      b.style.borderColor = c;
      b.style.color = c;
      b.addEventListener('click', () => onPick(tag));
    });
  };
  search.addEventListener('input', renderGrid);
  const render = () => {
    const tags = getTags();
    toggleBtn.style.display = tags.length > 0 ? 'inline-block' : 'none';
    toggleBtn.setText(open ? 'Hide the other tags' : `${label} (${tags.length})`);
    box.style.display = open ? 'block' : 'none';
    if (open) renderGrid();
  };
  toggleBtn.addEventListener('click', () => { open = !open; render(); });
  return { render };
}

// ============================================================
// FIXED FORMS — English counterpart of the French plugin's "Forme" menu.
// checkForm(text, formId, cmudictIndex) returns null for "free", else
// { name, rules: [{ label, ok, lines: [n…], detail, advice }] } where
// `advice` rules are shown with ⚠ and never count as failures (used for
// what the engine can only estimate: stress-based meter, refrains with
// small wording changes). Line numbers count non-empty lines from 1.
// ============================================================
const FORMS = {
  shakespearean: { name: 'Shakespearean sonnet', lines: 14, scheme: ['ABABCDCDEFEFGG'], schemeLabel: 'ABAB CDCD EFEF GG', syllables: [10, 11], meter: 'iambic' },
  petrarchan: { name: 'Petrarchan sonnet', lines: 14, scheme: ['ABBAABBACDECDE', 'ABBAABBACDCDCD', 'ABBAABBACDEDCE'], schemeLabel: 'ABBA ABBA + CDE CDE / CDC DCD / CDE DCE', syllables: [10, 11], meter: 'iambic' },
  spenserian: { name: 'Spenserian sonnet', lines: 14, scheme: ['ABABBCBCCDCDEE'], schemeLabel: 'ABAB BCBC CDCD EE', syllables: [10, 11], meter: 'iambic' },
  villanelle: { name: 'Villanelle', lines: 19, stanzas: [3, 3, 3, 3, 3, 4], scheme: ['ABAABAABAABAABAABAA'], schemeLabel: 'ABA ABA ABA ABA ABA ABAA', syllables: null,
    refrains: [[1, 6, 12, 18], [3, 9, 15, 19]] },
  terzaRima: { name: 'Terza rima', terza: true, syllables: [10, 11], meter: 'iambic' },
  heroic: { name: 'Heroic couplets', couplets: true, syllables: [10, 11], meter: 'iambic' },
  blank: { name: 'Blank verse', syllables: [10, 11], meter: 'iambic', unrhymed: true },
  ballad: { name: 'Ballad stanza', ballad: true },
  limerick: { name: 'Limerick', lines: 5, scheme: ['AABBA'], schemeLabel: 'AABBA', perLine: [[7, 10], [7, 10], [4, 7], [4, 7], [7, 10]] },
  haiku: { name: 'Haiku', lines: 3, perLine: [[5, 5], [7, 7], [5, 5]], noRhyme: true },
};
const FORM_GROUPS = [
  { name: 'Sonnets', ids: ['shakespearean', 'petrarchan', 'spenserian'] },
  { name: 'Fixed forms', ids: ['villanelle', 'limerick', 'haiku'] },
  { name: 'Verse patterns', ids: ['heroic', 'blank', 'terzaRima', 'ballad'] },
];

function normalizeRefrain(line) {
  return (line || '').toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();
}

// Lines that should rhyme (same symbol in `pattern`, a string or array) but don't. Returns
// { bad: [n…], unknown: [n…] } (1-based); unknown = word not in CMUdict.
function checkRhymePattern(keys, pattern, tails) {
  const firstOf = new Map();
  const bad = new Set();
  const weak = new Set();
  const unknown = new Set();
  for (let i = 0; i < pattern.length && i < keys.length; i++) {
    const letter = pattern[i];
    if (letter === 'x') continue;
    if (keys[i] === null) { unknown.add(i + 1); continue; }
    if (!firstOf.has(letter)) { firstOf.set(letter, i); continue; }
    const j = firstOf.get(letter);
    if (keys[j] === keys[i]) continue;
    if (tails && tails[i] && tails[i] === tails[j]) weak.add(i + 1);
    else bad.add(i + 1);
  }
  return { bad: [...bad], weak: [...weak], unknown: [...unknown] };
}

// Last-syllable rhyme, ignoring stress ("temperate" / "date"): what
// Shakespeare and others often rhyme on. Counts as a weak rhyme (⚠).
function lastSyllableKey(word, cmudictIndex) {
  const entry = resolveCmudictEntry(word, cmudictIndex);
  if (!entry) return null;
  const ph = entry.phonemes;
  let i = ph.length - 1;
  while (i >= 0 && !/\d$/.test(ph[i])) i--;
  return i < 0 ? null : ph.slice(i).map((p) => p.replace(/\d$/, '')).join(' ');
}

function checkForm(text, formId, cmudictIndex) {
  const form = FORMS[formId];
  if (!form) return null;
  const raw = text.split(/\r?\n/);
  const lines = raw.filter((l) => l.trim());
  const stanzaSizes = [];
  let run = 0;
  raw.forEach((l) => { if (l.trim()) run++; else if (run) { stanzaSizes.push(run); run = 0; } });
  if (run) stanzaSizes.push(run);
  const analyses = lines.map((l) => {
    const a = analyzeLine(l, cmudictIndex, null);
    return { ...a, meter: detectMeter(a.stressSeq, a.rigidSeq) };
  });
  const lastWords = lines.map((l) => lastWordOfLine(l));
  const keys = lastWords.map((w) => (w ? rhymeKeyForWord(w, cmudictIndex) : null));
  const tails = lastWords.map((w) => (w ? lastSyllableKey(w, cmudictIndex) : null));
  const rules = [];
  const n = lines.length;
  const add = (label, ok, badLines, detail, advice) => rules.push({ label, ok, lines: badLines || [], detail: detail || '', advice: !!advice });

  if (form.lines) add(`${form.lines} lines`, n === form.lines, [], n === form.lines ? '' : `${n} line${n > 1 ? 's' : ''}`);
  if (form.stanzas) {
    const ok = stanzaSizes.join(',') === form.stanzas.join(',');
    add(`Stanzas of ${form.stanzas.join(' + ')} lines`, ok, [], ok ? '' : `found ${stanzaSizes.join(' + ') || 'none'}`);
  }
  if (form.couplets) add('An even number of lines (couplets)', n % 2 === 0, [], n % 2 ? `${n} lines` : '');
  if (form.terza) {
    const ok = stanzaSizes.length > 0 && stanzaSizes.slice(0, -1).every((s) => s === 3) && [1, 2, 3].includes(stanzaSizes[stanzaSizes.length - 1]);
    add('Tercets (a closing line or couplet allowed)', ok, [], ok ? '' : `found ${stanzaSizes.join(' + ')}`);
  }
  if (form.ballad) {
    const ok = stanzaSizes.length > 0 && stanzaSizes.every((s) => s === 4);
    add('Quatrains', ok, [], ok ? '' : `found ${stanzaSizes.join(' + ')}`);
  }

  // ---- rhyme ----
  if (form.scheme) {
    const tries = form.scheme.map((p) => ({ p, r: checkRhymePattern(keys, p, tails) }));
    const best = tries.reduce((a, b) => (b.r.bad.length < a.r.bad.length ? b : a));
    add(`Rhyme scheme ${form.schemeLabel}`, best.r.bad.length === 0, best.r.bad, best.r.bad.length ? 'no rhyme where the form expects one' : '');
    if (best.r.weak.length) add('Full rhymes (stressed vowel and what follows)', false, best.r.weak, 'only the last, unstressed syllable rhymes', true);
    if (best.r.unknown.length) add('Every rhyme word known to CMUdict', false, best.r.unknown, 'cannot check these line endings', true);
  } else if (form.couplets) {
    const r = checkRhymePattern(keys, keys.map((_, i) => 'c' + Math.floor(i / 2)), tails);
    add('Rhymed couplets (AA BB CC…)', r.bad.length === 0, r.bad);
  } else if (form.terza) {
    // ABA BCB CDC…: line 3k+1 & 3k+3 rhyme; 3k+2 rhymes with 3(k+1)+1.
    const bad = new Set();
    for (let k = 0; 3 * k + 2 < n; k++) {
      const a = 3 * k, b = 3 * k + 1, c = 3 * k + 2;
      if (keys[a] && keys[c] && keys[a] !== keys[c]) bad.add(c + 1);
      if (c + 1 < n && keys[b] && keys[c + 1] && keys[b] !== keys[c + 1]) bad.add(c + 2);
    }
    add('Interlocking rhyme (ABA BCB CDC…)', bad.size === 0, [...bad]);
  } else if (form.ballad) {
    const bad = [];
    for (let k = 0; 4 * k + 3 < n; k++) if (keys[4 * k + 1] && keys[4 * k + 3] && keys[4 * k + 1] !== keys[4 * k + 3]) bad.push(4 * k + 4);
    add('Lines 2 and 4 of each quatrain rhyme (ABCB)', bad.length === 0, bad);
  }
  if (form.unrhymed) {
    const rhymed = [];
    for (let i = 1; i < n; i++) if (keys[i] && keys[i] === keys[i - 1]) rhymed.push(i + 1);
    add('Unrhymed (no consecutive end rhymes)', rhymed.length === 0, rhymed, '', true);
  }
  if (form.noRhyme) {
    // Traditional English haiku don't rhyme; only a hint.
    const r = keys.filter(Boolean);
    add('No end rhyme (traditional)', new Set(r).size === r.length, [], '', true);
  }

  // ---- refrains ----
  if (form.refrains) {
    form.refrains.forEach((group, gi) => {
      const ref = normalizeRefrain(lines[group[0] - 1]);
      const bad = group.slice(1).filter((ln) => ln <= n && normalizeRefrain(lines[ln - 1]) !== ref);
      add(`Refrain A${gi + 1} (line ${group[0]}) repeated at lines ${group.slice(1).join(', ')}`, bad.length === 0, bad,
        bad.length ? 'wording differs (small variations are traditional)' : '', true);
    });
  }

  // ---- syllables / meter ----
  if (form.syllables) {
    // English counts are fuzzy (elision: "temp'rate", "heav'n"): one syllable
    // off is only flagged as a point to check, more than that fails.
    const [lo, hi] = form.syllables;
    const off = (sy) => (sy < lo ? lo - sy : sy > hi ? sy - hi : 0);
    const bad = analyses.map((a, i) => (off(a.totalSyllables) > 1 ? i + 1 : 0)).filter(Boolean);
    const near = analyses.map((a, i) => (off(a.totalSyllables) === 1 ? i + 1 : 0)).filter(Boolean);
    add(`${lo} syllables per line (${hi} with a feminine ending)`, bad.length === 0, bad);
    if (near.length) add('Syllable count within one (elision?)', false, near, 'check for an elided or slurred syllable', true);
  }
  if (form.perLine) {
    const bad = [];
    form.perLine.forEach(([lo, hi], i) => {
      if (i >= n) return;
      const s = analyses[i].totalSyllables;
      if (s < lo || s > hi) bad.push(i + 1);
    });
    const desc = form.perLine.map(([lo, hi]) => (lo === hi ? String(lo) : `${lo}-${hi}`)).join(' / ');
    add(`Syllables per line: ${desc}`, bad.length === 0, bad);
  }
  if (form.ballad) {
    const bad = analyses.map((a, i) => {
      const odd = i % 2 === 0;
      const s = a.totalSyllables;
      return (odd ? (s < 7 || s > 9) : (s < 5 || s > 7)) ? i + 1 : 0;
    }).filter(Boolean);
    add('Alternating ~8 / ~6 syllables (4 and 3 stresses)', bad.length === 0, bad, '', true);
  }
  if (form.meter) {
    const bad = analyses.map((a, i) => (a.meter.footType === form.meter ? 0 : i + 1)).filter(Boolean);
    add(`${form.meter.charAt(0).toUpperCase() + form.meter.slice(1)} meter`, bad.length === 0, bad,
      bad.length ? 'stress detection is approximate — check by ear' : '', true);
  }
  return { name: form.name, rules };
}

// Reads a "form:" frontmatter value (id or name, any case/spacing).
function formIdFromName(value) {
  const k = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  return Object.keys(FORMS).find((id) => id.toLowerCase() === k || FORMS[id].name.toLowerCase().replace(/[^a-z]/g, '') === k) || null;
}
// ============================================================
// VIEW
// Same layout as the French sibling plugin (Carnet du Poète): a title,
// a tab bar, then one panel per tab, all built once and shown/hidden on
// tab switch (so a search or a draft isn't lost when changing tabs).
// CSS classes mirror the French plugin's names with a pn- prefix, so
// both plugins share one visual language (see styles.css).
// ============================================================
const PN_TABS = [
  ['syllables', 'Syllables', 'Write or paste your verses to count syllables, detect meter and see the rhyme scheme (AABB, ABAB…).\nThe "Sonorities" side (button at the top) also shows alliteration and internal assonance.'],
  ['rhymes', 'Rhymes', 'Find rhymes for a word in CMUdict, optionally completed online by Datamuse.\nFilter by starting letter, syllable count and rhyme type.'],
  ['inspiration', 'Inspiration', 'Type a common word, get rarer, more literary vocabulary on the same theme.'],
  ['synonyms', 'Synonyms', 'Type a word to see its synonyms and antonyms.\nUseful to vary a rhyme or a rhythm without changing the meaning.'],
  ['guide', 'Guide', 'Quick reference for the prosody terms used by the plugin: meter, feet, rhyme, forms.'],
  ['definitions', 'Definitions', 'Check the exact meaning and register of a word before using it (English Wiktionary).'],
  ['random', 'Random', 'A rare or literary word drawn at random — for surprise and inspiration.\nMark it (like, exclude, free tag) to tune future draws.'],
  ['notes', 'Notes', 'Find the words in your personal dictionary that have no note yet, and add one.\nSaved directly to your personal dictionary.'],
];

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
    container.addClass('poets-notebook-view');

    container.createEl('h2', { text: 'Poetry Notebook' });

    if (!this.plugin.cmudictIndex) {
      const banner = container.createDiv({ cls: 'pn-banner' });
      banner.setText(
        (this.plugin._cmudictDownloading
          ? 'Downloading CMUdict… syllable counts are approximate until it is installed.'
          : 'CMUdict not available yet: syllable/stress counts are approximate. It is downloaded automatically when online ' +
            '(or place a cmudict.dict file in the vault and use Settings → Reload CMUdict).')
      );
    }

    const tabBar = container.createDiv({ cls: 'pn-tabs' });
    this.tabButtons = {};
    this.panels = {};
    for (const [id, label, tip] of PN_TABS) {
      const btn = tabBar.createEl('button', { text: label, cls: 'pn-tab' });
      btn.setAttr('title', tip);
      btn.addEventListener('click', () => this.switchTab(id));
      this.tabButtons[id] = btn;
    }
    for (const [id] of PN_TABS) this.panels[id] = container.createDiv({ cls: 'pn-panel' });

    this.renderSyllablesTab(this.panels.syllables);
    this.renderRhymesTab(this.panels.rhymes);
    this.renderInspirationTab(this.panels.inspiration);
    this.renderSynonymsTab(this.panels.synonyms);
    this.renderGuideTab(this.panels.guide);
    this.renderDefinitionsTab(this.panels.definitions);
    this.renderRandomTab(this.panels.random);
    this.renderNotesTab(this.panels.notes);

    this.switchTab(this.activeTab);
  }

  switchTab(id) {
    this.activeTab = id;
    for (const [tid] of PN_TABS) {
      this.tabButtons[tid].toggleClass('active', tid === id);
      this.panels[tid].toggleClass('active', tid === id);
    }
    if (id === 'notes' && this._refreshNotes) this._refreshNotes();
  }

  // ---- Syllables tab ----
  // Same structure as the French plugin's Syllabes tab: action bar
  // (Sonorities flip + Export / Copy / Active note / Clear), the draft,
  // then a flip card — Structure on the front (options, one row per line,
  // stanza schemes, totals), Sonorities on the back.
  renderSyllablesTab(panel) {
    const actionsBar = panel.createDiv({ cls: 'pn-toolbar-actions' });
    const flipBtn = actionsBar.createEl('button', { cls: 'pn-icon-btn pn-icon-btn-pill pn-icon-btn-cyan' });
    const flipIcon = flipBtn.createSpan({ text: '🔄' });
    const flipLabel = flipBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Sonorities' });
    flipBtn.createSpan({ cls: 'pn-experimental-tag', text: 'experimental' });
    flipBtn.setAttr('title', 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings). Experimental: newer and less battle-tested than the rest of this plugin — feedback welcome.');
    const saveState = actionsBar.createSpan({ cls: 'pn-save-state' });
    const mkBtn = (icon, label, title) => {
      const b = actionsBar.createEl('button', { cls: 'pn-icon-btn' });
      b.createSpan({ text: icon });
      b.createSpan({ cls: 'pn-icon-btn-label', text: label });
      b.setAttr('title', title);
      b.setAttr('aria-label', title);
      return b;
    };
    const exportBtn = mkBtn('⬇', 'Export', 'Copy the analysis as a Markdown table');
    const copyBtn = mkBtn('⎘', 'Copy', 'Copy the draft');
    const noteBtn = mkBtn('📄', 'Active note', 'Load into the draft the selection in the open note, else its first ```poem block, else the whole note (Markdown syntax removed).');
    const clearBtn = mkBtn('🗑️', 'Clear', 'Clear the draft');

    const textarea = panel.createEl('textarea', {
      cls: 'pn-textarea',
      attr: { placeholder: 'Write or paste your verses here, one per line…' },
    });
    if (this.plugin.draftText) textarea.value = this.plugin.draftText;

    const flipZone = panel.createDiv({ cls: 'pn-flip-zone' });
    const flipCard = flipZone.createDiv({ cls: 'pn-flip-card' });
    const flipFront = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-front' });
    const flipBack = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-back' });

    const toolbar = flipFront.createDiv({ cls: 'pn-toolbar' });
    // Target fixed form: "free" = usual behaviour; otherwise a checklist
    // of the form's rules appears above the analysis (see 16-forms.js).
    const formWrap = toolbar.createDiv({ cls: 'pn-select-wrap' });
    const formSelect = formWrap.createEl('select', { cls: 'pn-forme-select' });
    formWrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
    formSelect.createEl('option', { attr: { value: 'free' }, text: 'Form: free' });
    FORM_GROUPS.forEach((g) => {
      const og = formSelect.createEl('optgroup', { attr: { label: g.name } });
      g.ids.forEach((id) => og.createEl('option', { attr: { value: id }, text: FORMS[id].name }));
    });
    formSelect.value = FORMS[this.plugin.settings.poemForm] ? this.plugin.settings.poemForm : 'free';
    formSelect.setAttr('title', 'Choose a fixed form to check the poem against its rules (lines, stanzas, rhyme scheme, syllables, meter, refrains).');
    const mkToggle = (parent, label, checked, title) => makeTogglePill(parent, label, checked, title);
    const colorsToggle = mkToggle(toolbar, 'Rhyme colors', this.plugin.settings.showRhymeColors !== false);
    const continuousToggle = mkToggle(toolbar, 'Continuous rhymes across stanzas', this.plugin.settings.continuousRhymes !== false,
      'By default each stanza starts again at A. Check to carry the letters on from one stanza to the next (useful for sonnets: ABAB CDCD EFEF GG rather than ABAB ABAB…).');

    const checklistDiv = flipFront.createDiv({ cls: 'pn-bilan-forme' });
    const analysisDiv = flipFront.createDiv({ cls: 'pn-analyse' });
    const schemaDiv = flipFront.createDiv({ cls: 'pn-schema-rimes' });
    const totalBar = flipFront.createDiv({ cls: 'pn-total-bar' });
    totalBar.style.display = 'none';

    const syncFlipHeight = () => {
      const activeFace = flipZone.hasClass('flipped') ? flipBack : flipFront;
      requestAnimationFrame(() => { flipCard.style.height = activeFace.scrollHeight + 'px'; });
    };

    let renderSonoritiesBack = () => {};
    let debounceTimer = null;
    const scheduleAnalysis = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await this.runAnalysis(textarea.value, analysisDiv, schemaDiv, totalBar,
          colorsToggle.checked, continuousToggle.checked);
        this.renderFormChecklist(checklistDiv, textarea.value, formSelect.value);
        syncFlipHeight();
        if (flipZone.hasClass('flipped')) renderSonoritiesBack();
      }, 250);
    };

    let saveTimer = null;
    const saveDraft = () => {
      this.plugin.draftText = textarea.value;
      saveState.setText('…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await this.plugin.saveSettings();
        saveState.setText('draft saved');
        setTimeout(() => saveState.setText(''), 1200);
      }, 700);
    };

    textarea.addEventListener('input', () => { saveDraft(); scheduleAnalysis(); });

    colorsToggle.addEventListener('change', async () => {
      this.plugin.settings.showRhymeColors = colorsToggle.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });
    formSelect.addEventListener('change', async () => {
      this.plugin.settings.poemForm = formSelect.value;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });
    continuousToggle.addEventListener('change', async () => {
      this.plugin.settings.continuousRhymes = continuousToggle.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });

    flipBtn.addEventListener('click', () => {
      flipZone.toggleClass('flipped', !flipZone.hasClass('flipped'));
      const onBack = flipZone.hasClass('flipped');
      if (onBack) renderSonoritiesBack();
      syncFlipHeight();
      flipLabel.setText(onBack ? 'Structure' : 'Sonorities');
      flipBtn.setAttr('title', onBack
        ? 'Flip back to syllables, meter and rhyme scheme'
        : 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings)');
      flipIcon.addClass('pn-icon-flip');
      setTimeout(() => flipIcon.removeClass('pn-icon-flip'), 600);
    });

    exportBtn.addEventListener('click', async () => {
      const poem = analyzePoem(textarea.value, this.plugin.cmudictIndex, this.datamuseCache, continuousToggle.checked);
      const rows = poem.lines.filter((l) => !l.empty);
      if (rows.length === 0) { new Notice('Nothing to export.'); return; }
      let md = '| Line | Syllables | Meter | Rhyme |\n| --- | --- | --- | --- |\n';
      rows.forEach((l) => {
        md += `| ${l.text.trim().replace(/\|/g, '\\|')} | ${l.totalSyllables} | ${meterLabel(l.meter) || ''} | ${l.letter && l.letter !== '?' ? l.letter : ''} |\n`;
      });
      try {
        await navigator.clipboard.writeText(md);
        new Notice('Analysis copied as Markdown — paste it wherever you like.');
      } catch (e) {
        new Notice('Could not copy automatically; see the console for the generated Markdown.');
        console.log(md);
      }
    });

    copyBtn.addEventListener('click', async () => {
      if (!textarea.value.trim()) { new Notice('The draft is empty.'); return; }
      try {
        await navigator.clipboard.writeText(textarea.value);
        new Notice('Draft copied to clipboard.');
      } catch (e) {
        new Notice('Could not copy automatically (see the console).');
        console.log(textarea.value);
      }
    });

    noteBtn.addEventListener('click', async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') { new Notice("Poet's Notebook: no Markdown note is open."); return; }
      const content = await this.app.vault.read(file);
      let selection = '';
      this.app.workspace.iterateAllLeaves((leaf) => {
        const v = leaf.view;
        if (!selection && v && v.file === file && v.editor && typeof v.editor.getSelection === 'function') {
          selection = v.editor.getSelection() || '';
        }
      });
      const extract = extractPoemFromNote(content, selection);
      // A "form:" property (id or name, e.g. "form: villanelle") sets the Form menu.
      const cache = this.app.metadataCache && this.app.metadataCache.getFileCache(file);
      const fm = cache && cache.frontmatter;
      const wanted = fm && fm.form != null ? String(fm.form) : null;
      if (wanted) {
        const id = formIdFromName(wanted);
        if (id) {
          formSelect.value = id;
          this.plugin.settings.poemForm = id;
          await this.plugin.saveSettings();
        } else {
          new Notice(`Poet's Notebook: unknown form "${wanted}" (see the Form menu).`);
        }
      }
      if (!extract.text) { new Notice("Poet's Notebook: nothing to load (note empty after cleanup)."); return; }
      textarea.value = extract.text;
      saveDraft();
      scheduleAnalysis();
      new Notice(`Poet's Notebook: "${file.basename}" loaded into the draft (${extract.source}).`);
    });

    clearBtn.addEventListener('click', async () => {
      textarea.value = '';
      this.plugin.draftText = '';
      await this.plugin.saveSettings();
      analysisDiv.empty();
      schemaDiv.empty();
      checklistDiv.empty();
      totalBar.style.display = 'none';
      if (flipZone.hasClass('flipped')) renderSonoritiesBack();
      syncFlipHeight();
    });

    renderSonoritiesBack = this.buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight);

    if (textarea.value.trim().length > 0) scheduleAnalysis();
  }

  // Back face of the flip card (Sonorities). Returns a render function to
  // call whenever the draft or settings change while the back is visible.
  buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight) {
    const toolbar = flipBack.createDiv({ cls: 'pn-toolbar' });
    const modeWrap = toolbar.createDiv({ cls: 'pn-select-wrap' });
    const modeSelect = modeWrap.createEl('select', { cls: 'pn-son-mode-select' });
    [['exact', 'Exact sounds'], ['simple', 'Simplified families'], ['extended', 'Extended families']]
      .forEach(([v, label]) => modeSelect.createEl('option', { attr: { value: v }, text: label }));
    modeWrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
    modeSelect.value = 'simple';
    modeSelect.setAttr('title', 'Exact sounds: each distinct ARPAbet phoneme. Simplified families: few groups, easiest to read. Extended families: fuller classification (e.g. voiced/voiceless stops apart) — more precise, more colours.');
    const seuilLabel = toolbar.createDiv({ cls: 'pn-son-seuil' });
    seuilLabel.createSpan({ text: 'Threshold ' });
    const seuilInput = seuilLabel.createEl('input', { attr: { type: 'number', min: '2', max: '9', value: '3' } });
    const mkToggle = (label, checked, title) => makeTogglePill(toolbar, label, checked, title);
    const stopwordsToggle = mkToggle('Exclude stopwords', true);
    const top3Toggle = mkToggle('Highlight only the 3 most frequent', true,
      'The list stays complete; only the highlighting in the draft is limited to the 3 most frequent alliterations and assonances, for a less busy text.');

    flipBack.createEl('p', {
      cls: 'pn-son-soustitre',
      text: 'Experimental: sound detection relies entirely on CMUdict — words missing from it are skipped rather than guessed at. Filled background = starts with this consonant; underline = contains this vowel (a vowel-initial word can only ever be underlined).',
    });
    const legendDiv = flipBack.createDiv({ cls: 'pn-son-legende' });
    const draftDiv = flipBack.createDiv({ cls: 'pn-son-brouillon' });
    const jumpsDiv = flipBack.createDiv({ cls: 'pn-son-sauts' });
    const listDetails = flipBack.createEl('details', { cls: 'pn-son-liste-details' });
    listDetails.createEl('summary', { text: 'See the detail by sound' });
    const listDiv = listDetails.createDiv({ cls: 'pn-son-liste' });
    const sectionTitleEls = {};
    const SECTIONS = ['Alliteration', 'Internal assonance', 'Consonant web', 'Echo endings'];
    SECTIONS.forEach((title) => {
      const btn = jumpsDiv.createEl('button', { cls: 'pn-hasard-toggle-pool', text: title });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        listDetails.setAttr('open', 'true');
        requestAnimationFrame(() => {
          syncFlipHeight();
          if (sectionTitleEls[title]) sectionTitleEls[title].scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    });

    let spotlightSon = null; // Consonant web: click a sound to isolate it in the draft

    const familyFn = (mode, isVowel) => {
      if (mode === 'exact') return null;
      return isVowel
        ? (mode === 'simple' ? (ph => VOWEL_FAMILY_SIMPLE[ph]) : (ph => VOWEL_FAMILY_EXTENDED[ph]))
        : (mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
    };
    const colourFor = (son, isVowel) => (isVowel ? THEME_VOWEL[son] : THEME_CONSONANT[son]) || 'pn-son-c1';

    const render = () => {
      if (!this.plugin.cmudictIndex) {
        legendDiv.empty(); draftDiv.empty(); listDiv.empty();
        legendDiv.createSpan({ cls: 'pn-son-vide', text: 'CMUdict is required for Sonorities — see the banner above.' });
        syncFlipHeight();
        return;
      }
      const mode = modeSelect.value;
      const seuilMin = parseInt(seuilInput.value, 10) || 3;
      const excludeStopwords = stopwordsToggle.checked;
      const poemText = textarea.value;
      const result = analyzeSonorities(poemText, this.plugin.cmudictIndex, this.plugin.sonorityBaseline, { excludeStopwords, seuilMin, mode });

      const highlighted = top3Toggle.checked
        ? { alliteration: result.alliteration.slice(0, 3), internalAssonance: result.internalAssonance.slice(0, 3) }
        : result;

      // ---- legend: only the sounds actually highlighted below ----
      legendDiv.empty();
      const addLegendGroup = (title, list, isVowel) => {
        if (list.length === 0) return;
        const group = legendDiv.createDiv({ cls: 'pn-son-legende-groupe' });
        group.createSpan({ cls: 'pn-son-legende-titre', text: title + ': ' });
        list.forEach((entry) => {
          const chip = group.createSpan({ cls: 'pn-son-legende-puce' });
          chip.createSpan({ cls: 'pn-son-legende-couleur ' + (isVowel ? 'pn-son-legende-vox ' : '') + colourFor(entry.son, isVowel) });
          chip.createSpan({ cls: 'pn-son-legende-texte', text: entry.son });
        });
      };
      addLegendGroup('Alliteration', highlighted.alliteration, false);
      addLegendGroup('Assonance', highlighted.internalAssonance, true);
      if (highlighted.alliteration.length === 0 && highlighted.internalAssonance.length === 0) {
        legendDiv.createSpan({ cls: 'pn-son-vide', text: 'No pattern above the current threshold.' });
      }

      // ---- draft with highlighting (whole words: CMUdict gives phonemes,
      // not letter positions) ----
      draftDiv.empty();
      const dominantAllit = new Set(highlighted.alliteration.map((e) => e.son));
      const dominantAsson = new Set(highlighted.internalAssonance.map((e) => e.son));
      const famAllitFn = familyFn(mode, false);
      const famAssonFn = familyFn(mode, true);

      poemText.split('\n').forEach((line, idxLine) => {
        const lineEl = draftDiv.createDiv({ cls: 'pn-son-brouillon-ligne' });
        lineEl.createSpan({ cls: 'pn-son-brouillon-numero', text: String(idxLine + 1) });
        if (!line.trim()) { lineEl.createEl('br'); return; }
        line.split(/(\s+)/).forEach((frag) => {
          if (!frag.trim()) { lineEl.createSpan({ text: frag }); return; }
          const wordRaw = frag.replace(/[^A-Za-z']/g, '');
          const wl = wordRaw.toLowerCase().replace(/'/g, '');
          const entry = wordRaw ? resolveCmudictEntry(wordRaw, this.plugin.cmudictIndex) : null;
          const isStop = excludeStopwords && STOPWORDS_EN.has(wl);

          if (spotlightSon) {
            if (!entry || isStop) { lineEl.createSpan({ cls: 'pn-son-brouillon-dim', text: frag }); return; }
            const matches = allConsonantsOfEntry(entry).filter((c) => (famAllitFn ? famAllitFn(c.ph) : c.ph) === spotlightSon);
            lineEl.createSpan({
              cls: matches.length ? 'pn-son-surligne-init ' + colourFor(spotlightSon, false) : 'pn-son-brouillon-dim',
              text: frag,
            });
            return;
          }
          if (!entry || isStop) { lineEl.createSpan({ text: frag }); return; }

          const initPh = initialConsonantOfEntry(entry);
          const initKey = initPh ? (famAllitFn ? famAllitFn(initPh) : initPh) : null;
          const showInit = initKey && dominantAllit.has(initKey);
          const vows = allVowelsOfEntry(entry);
          const vowKey = vows.length ? (famAssonFn ? famAssonFn(vows[0].ph) : vows[0].ph) : null;
          const showVox = vowKey && dominantAsson.has(vowKey);

          if (showInit && showVox) {
            lineEl.createSpan({ cls: `pn-son-surligne-init ${colourFor(initKey, false)} ${colourFor(vowKey, true)}-underline`, text: frag });
          } else if (showInit) {
            lineEl.createSpan({ cls: 'pn-son-surligne-init ' + colourFor(initKey, false), text: frag });
          } else if (showVox) {
            lineEl.createSpan({ cls: 'pn-son-surligne-vox ' + colourFor(vowKey, true), text: frag });
          } else {
            lineEl.createSpan({ text: frag });
          }
        });
      });

      // ---- lists ----
      listDiv.empty();
      const renderSection = (title, subtitle, list, isVowel, onClick) => {
        const h4 = listDiv.createEl('h4', { text: title });
        sectionTitleEls[title] = h4;
        listDiv.createEl('p', { cls: 'pn-son-soustitre', text: subtitle });
        if (list.length === 0) {
          listDiv.createEl('p', { cls: 'pn-son-vide', text: 'No pattern above the current threshold.' });
          return;
        }
        list.forEach((entry) => {
          const row = listDiv.createDiv({ cls: 'pn-son-ligne' });
          const badge = row.createSpan({ cls: 'pn-son-badge ' + colourFor(entry.son, isVowel), text: entry.son.slice(0, 3) });
          badge.setAttr('title', entry.son);
          const words = Array.from(new Set(entry.occurrences.map((o) => o.word)));
          const lines = Array.from(new Set(entry.occurrences.map((o) => o.line)));
          row.createSpan({ cls: 'pn-son-mots', text: `${words.join(', ')} — line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` });
          row.createSpan({ cls: 'pn-son-count', text: `${entry.count} words` });
          if (entry.ratio != null) {
            const ratioSpan = row.createSpan({ cls: 'pn-son-ratio' + (entry.ratio >= 1.5 ? ' pn-son-ratio-fort' : '') });
            ratioSpan.setText('×' + entry.ratio.toFixed(1));
            ratioSpan.setAttr('title', `This sound occurs ${entry.ratio.toFixed(1)}× more often in this poem than in English on average (baseline computed live from the ${this.plugin.cmudictIndex.size}-word CMUdict index loaded in this vault).`);
          }
          if (onClick) {
            row.addClass('pn-son-ligne-cliquable');
            row.setAttr('title', 'Click to isolate this sound in the draft above.');
            if (entry.son === spotlightSon) row.addClass('pn-son-ligne-active');
            row.addEventListener('click', () => onClick(entry.son));
          }
        });
      };
      renderSection('Alliteration', 'Consonant sound repeated at the start of nearby words', result.alliteration, false);
      renderSection('Internal assonance', 'A vowel sound that recurs inside nearby words, aside from end-of-line rhyme', result.internalAssonance, true);
      renderSection('Consonant web', 'A consonant sound that recurs anywhere in a word — attack, middle, or coda — not just at the start. Click a sound to isolate it in the draft.', result.consonantWeb, false, (son) => {
        spotlightSon = spotlightSon === son ? null : son;
        render();
        syncFlipHeight();
        if (spotlightSon) requestAnimationFrame(() => draftDiv.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
      renderSection('Echo endings', 'Word endings that echo each other away from the line end — needs at least one mid-line occurrence, otherwise it would just restate the rhyme scheme.', result.echoEndings.map((e) => ({ ...e, son: e.key })), false);

      syncFlipHeight();
    };

    const rerender = () => { render(); syncFlipHeight(); };
    modeSelect.addEventListener('change', rerender);
    seuilInput.addEventListener('change', rerender);
    stopwordsToggle.addEventListener('change', rerender);
    top3Toggle.addEventListener('change', rerender);
    listDetails.addEventListener('toggle', syncFlipHeight);

    return render;
  }

  // Checklist of the chosen fixed form's rules. Failing line numbers are
  // links: they open the Rhymes tab on that line's last word.
  renderFormChecklist(div, text, formId) {
    div.empty();
    if (!text.trim()) return;
    const result = checkForm(text, formId, this.plugin.cmudictIndex);
    if (!result) return;
    const strict = result.rules.filter((r) => !r.advice);
    const toCheck = result.rules.filter((r) => r.advice && !r.ok).length;
    div.createDiv({
      cls: 'pn-bilan-titre',
      text: `${result.name}: ${strict.filter((r) => r.ok).length}/${strict.length} rules met` + (toCheck ? `, ${toCheck} point(s) to check` : ''),
    });
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    result.rules.forEach((r) => {
      const state = r.ok ? 'ok' : (r.advice ? 'conseil' : 'ko');
      const row = div.createDiv({ cls: 'pn-bilan-regle pn-bilan-' + state });
      row.createSpan({ cls: 'pn-bilan-icone', text: { ok: '✓', conseil: '⚠', ko: '✗' }[state] });
      const body = row.createSpan();
      body.appendText(r.label);
      if (!r.ok && r.lines.length) {
        body.appendText(' — line' + (r.lines.length > 1 ? 's ' : ' '));
        r.lines.forEach((num, i) => {
          if (i > 0) body.appendText(', ');
          const word = lastWordOfLine(lines[num - 1] || '') || '';
          const link = body.createEl('a', { cls: 'pn-bilan-vers', text: String(num), attr: { href: '#' } });
          link.setAttr('title', word ? `Find rhymes for "${word}" (Rhymes tab)` : 'Line ' + num);
          link.addEventListener('click', (e) => {
            e.preventDefault();
            if (!word) return;
            this.switchTab('rhymes');
            if (this._prefillRhymes) this._prefillRhymes(word);
          });
        });
      }
      if (!r.ok && r.detail) body.appendText(` (${r.detail})`);
    });
  }

  async runAnalysis(text, analysisDiv, schemaDiv, totalBar, showColors, continuous) {
    analysisDiv.empty();
    schemaDiv.empty();
    const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) { totalBar.style.display = 'none'; return; }

    // Optional Datamuse enrichment for words CMUdict doesn't know, only if allowed
    if (this.plugin.settings.allowDatamuse) {
      const allWords = new Set();
      for (const line of nonEmpty) for (const w of tokenizeLine(line)) allWords.add(w.toLowerCase());
      for (const w of allWords) {
        const key = w.replace(/[^a-z']/g, '');
        if (this.plugin.cmudictIndex && this.plugin.cmudictIndex.has(key)) continue;
        if (this.datamuseCache.has(key)) continue;
        try {
          const d = await fetchDatamuseSyllables(key);
          if (d) this.datamuseCache.set(key, d);
        } catch (e) { /* offline or API error: silently fall back to heuristic */ }
      }
      analysisDiv.empty();
      schemaDiv.empty();
    }

    const poem = analyzePoem(text, this.plugin.cmudictIndex, this.datamuseCache, continuous);
    let total = 0, count = 0;

    poem.lines.forEach((l) => {
      if (l.empty) return;
      count++;
      total += l.totalSyllables;
      const color = l.colorIdx !== null ? RHYME_PALETTE[l.colorIdx % RHYME_PALETTE.length] : null;

      const lineEl = analysisDiv.createDiv({ cls: 'pn-ligne' });
      const top = lineEl.createDiv({ cls: 'pn-ligne-top' });
      const textSpan = top.createSpan({ cls: 'pn-texte', text: l.text.trim() });
      textSpan.setAttr('title', l.words.map((w) => `${w.word}(${w.syllableCount}, ${w.source})`).join(' '));
      if (showColors && color) {
        textSpan.style.borderLeft = `3px solid ${color}`;
        textSpan.style.paddingLeft = '6px';
      }

      const badges = top.createDiv({ cls: 'pn-badges' });
      if (showColors && l.letter) {
        const rhymeBadge = badges.createSpan({ cls: 'pn-rime-lettre', text: l.letter });
        const c = color || 'var(--text-muted)';
        rhymeBadge.style.color = c;
        rhymeBadge.style.borderColor = c;
        rhymeBadge.setAttr('title', l.letter === '?' ? 'Rhyme unknown (word missing from CMUdict)' : `Rhyme group ${l.letter}`);
      }
      const label = meterLabel(l.meter);
      if (label) {
        const meterPill = badges.createSpan({ cls: 'pn-metre', text: label });
        meterPill.setAttr('title', l.meter.confidence === 'none'
          ? `No regular foot pattern (stresses: ${l.meter.rawPattern || '?'})`
          : `${label} (${l.meter.confidence === 'exact' ? 'exact match' : 'approximate: some flexible syllables'})`);
      }
      badges.createSpan({ cls: 'pn-compte', text: String(l.totalSyllables) });
    });

    if (poem.stanzas.some((s) => s.name) || poem.stanzas.length > 1) {
      poem.stanzas.forEach((s, i) => {
        const row = schemaDiv.createDiv({ cls: 'pn-schema-ligne' });
        const prefix = poem.stanzas.length > 1 ? `Stanza ${i + 1}: ` : 'Scheme: ';
        row.createSpan({ text: prefix + s.letters.join('') });
        if (s.name) row.createSpan({ cls: 'pn-metre', text: s.name });
      });
    }

    totalBar.style.display = 'flex';
    totalBar.empty();
    totalBar.createSpan({ text: `${count} line${count > 1 ? 's' : ''}` });
    totalBar.createEl('strong', { text: `${total} syllables` });
    totalBar.createSpan({ text: `≈ ${(total / count).toFixed(1)} / line` });
  }
  // ---- Rhymes tab ----
  // Same structure as the French Rimes tab: search form, a framed filter
  // box (letter / syllables, rhyme type), a framed "complete online" box,
  // then one collapsible block per source.
  renderRhymesTab(panel) {
    const form = panel.createDiv({ cls: 'pn-rime-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A word… (e.g. light, river, courage)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });

    const filtersBox = panel.createDiv({ cls: 'pn-boite pn-filtres' });
    const lineLetter = filtersBox.createDiv({ cls: 'pn-filtres-ligne' });
    lineLetter.createSpan({ cls: 'pn-filtres-ligne-label', text: 'Letter / syllables: ' });
    const letterInput = lineLetter.createEl('input', { cls: 'pn-filtre-lettre', attr: { type: 'text', maxlength: '3', placeholder: 'Letter' } });
    const syllSelect = makeSyllableSelect(lineLetter);
    filtersBox.createDiv({ cls: 'pn-filtres-separateur' });
    const lineType = filtersBox.createDiv({ cls: 'pn-filtres-ligne' });
    lineType.createSpan({ cls: 'pn-filtres-ligne-label', text: 'Rhyme type: ' });
    const typeDiv = lineType.createDiv({ cls: 'pn-qualite-filtres' });
    const perfectToggle = makeTogglePill(typeDiv, 'Perfect', true, 'Stressed vowel and everything after it match exactly (light / flight).');
    const nearToggle = makeTogglePill(typeDiv, 'Near / slant', !this.plugin.settings.strictRhymeMode, 'Close but not identical sounds: consonance or assonance (shape / keep).');

    filtersBox.createDiv({ cls: 'pn-filtres-separateur' });
    // Part of speech: CMUdict has none, so this filter relies on Datamuse
    // (it also tags the CMUdict words it knows). A word whose part of speech
    // is unknown is never hidden — the filter only acts on what is known,
    // as in the French plugin.
    const lineNature = filtersBox.createDiv({ cls: 'pn-filtres-ligne' });
    lineNature.createSpan({ cls: 'pn-filtres-ligne-label', text: 'Part of speech: ' });
    const natureDiv = lineNature.createDiv({ cls: 'pn-cgram-filtres' });
    const NATURES = [['n', 'Noun', '#2980b9'], ['v', 'Verb', '#c0392b'], ['adj', 'Adjective', '#27ae60'], ['adv', 'Adverb', '#8e44ad']];
    const natureToggles = {};
    NATURES.forEach(([id, label, color]) => {
      const input = makeTogglePill(natureDiv, label, true, null, 'pn-cgram-pill');
      input.parentElement.style.setProperty('--ccolor', color);
      natureToggles[id] = input;
    });
    const syncNatureHint = (online) => {
      lineNature.style.opacity = online ? '1' : '0.5';
      lineNature.setAttr('title', online ? 'Words whose part of speech is unknown are always kept.'
        : 'Needs Datamuse (tick it below): CMUdict has no part of speech.');
    };

    const sourcesBox = panel.createDiv({ cls: 'pn-boite pn-sources' });
    sourcesBox.createSpan({ cls: 'pn-sources-label', text: 'Complete online: ' });
    const datamuseToggle = makeTogglePill(sourcesBox, 'Datamuse', (this.plugin.settings.onlineSources || []).includes('rhymes'),
      'Adds Datamuse matches not already found in CMUdict.');
    const rhymezoneLink = sourcesBox.createEl('a', { cls: 'pn-inspi-lien', text: 'RhymeZone ↗', attr: { href: '#' } });
    rhymezoneLink.setAttr('title', "Open the word on RhymeZone for its own advanced filters");
    rhymezoneLink.addEventListener('click', (evt) => {
      evt.preventDefault();
      const w = wordInput.value.trim();
      if (w) window.open(`https://www.rhymezone.com/r/rhyme.cgi?Word=${encodeURIComponent(w)}&typeofrhyme=perfect`, '_blank');
    });

    const results = panel.createDiv({ cls: 'pn-resultats' });

    const doSearch = () => this.renderRhymeResults(results, wordInput.value, {
      letter: letterInput.value.trim(),
      syllables: syllSelect.value,
      perfect: perfectToggle.checked,
      near: nearToggle.checked,
      online: datamuseToggle.checked,
      pos: new Set(Object.keys(natureToggles).filter((id) => natureToggles[id].checked)),
    });

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
    letterInput.addEventListener('input', doSearch);
    syllSelect.addEventListener('change', doSearch);
    perfectToggle.addEventListener('change', doSearch);
    Object.values(natureToggles).forEach((t) => t.addEventListener('change', doSearch));
    syncNatureHint(datamuseToggle.checked);
    nearToggle.addEventListener('change', doSearch);
    datamuseToggle.addEventListener('change', async () => {
      await this.plugin.setOnlineSource('rhymes', datamuseToggle.checked);
      syncNatureHint(datamuseToggle.checked);
      doSearch();
    });

    this._prefillRhymes = (word) => { wordInput.value = word; doSearch(); };
  }

  // Shared by the Rhymes tab and the Rhymes modal (editor right-click).
  // filters: { letter, syllables ('', '1'…'4', '5+'), perfect, near, online }.
  async renderRhymeResults(container, rawWord, filters) {
    container.empty();
    const word = (rawWord || '').trim();
    if (!word) return;
    const f = Object.assign({ letter: '', syllables: '', perfect: true, near: true, online: false }, filters);
    const idx = this.plugin.cmudictIndex;
    const strict = this.plugin.settings.strictRhymeMode;
    const showNear = f.near && !strict;

    const sylMatch = (n) => {
      if (!f.syllables) return true;
      return f.syllables === '5+' ? n >= 5 : n === parseInt(f.syllables, 10);
    };
    const letterMatch = (w) => !f.letter || w.toLowerCase().startsWith(f.letter.toLowerCase());

    // Online first when ticked: besides its own matches, Datamuse gives the
    // part of speech of the CMUdict words it knows, used by the filter.
    let online = null, onlineError = false;
    if (f.online) {
      container.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
      try {
        const [perfect, near] = await Promise.all([
          f.perfect ? fetchDatamuseRhymes(word, false, 1000) : Promise.resolve([]),
          showNear ? fetchDatamuseRhymes(word, true, 1000) : Promise.resolve([]),
        ]);
        online = { perfect, near };
      } catch (e) { onlineError = true; }
      container.empty();
    }
    const posOf = new Map();
    if (online) [...online.perfect, ...online.near].forEach((d) => { if (d.pos.length) posOf.set(d.word.toLowerCase(), d.pos); });
    const allPos = !f.pos || f.pos.size === 4;
    const posMatch = (w) => {
      if (allPos || !f.online) return true;
      const tags = posOf.get(w.toLowerCase());
      return !tags || tags.some((t) => f.pos.has(t));
    };

    const localBody = makeSourceBlock(container, `${word} — CMUdict`, true, true);
    const local = idx ? searchLocalRhymes(word, idx, { letter: f.letter, syllables: null }) : null;
    if (!idx) {
      localBody.createEl('p', { cls: 'pn-vide', text: 'CMUdict not loaded — rhyme search needs it. See the banner above.' });
    } else if (!local) {
      localBody.createEl('p', { cls: 'pn-vide', text: `"${word}" wasn't found in CMUdict, so its rhyme sound is unknown. Try another spelling.` });
    } else {
      const keep = (list) => list.filter((r) => sylMatch(r.syllableCount) && posMatch(r.word)).map((r) => r.word);
      const perfect = f.perfect ? keep(local.perfect) : [];
      const near = showNear ? keep(local.near) : [];
      if (perfect.length === 0 && near.length === 0) {
        localBody.createEl('p', { cls: 'pn-vide', text: 'No word matches these filters.' });
      }
      makeWordGroup(localBody, 'Perfect rhymes', perfect, 'pn-mot', idx);
      if (near.length) {
        const block = localBody.createDiv({ cls: 'pn-groupe pn-bloc-assonance' });
        block.createDiv({ cls: 'pn-titre pn-label-assonance', text: `Near / slant rhymes (${near.length})` });
        const words = block.createDiv({ cls: 'pn-mots' });
        showWithLimit(words, near, (w) => makeWordChip(words, w, 'pn-mot pn-mot-assonance', idx));
      }
    }

    if (!f.online) return;
    const onlineBody = makeSourceBlock(container, `${word} — Datamuse`, true, false);
    if (onlineError) {
      onlineBody.createEl('p', { cls: 'pn-vide', text: 'Datamuse: search impossible (no connection, site unreachable, or timeout).' });
      return;
    }
    const known = new Set(local ? [...local.perfect, ...local.near].map((r) => r.word) : []);
    const keepOnline = (list) => list
      .filter((d) => !known.has(d.word.toLowerCase()) && letterMatch(d.word) && sylMatch(d.numSyllables || 0) && posMatch(d.word))
      .map((d) => d.word);
    const extraPerfect = keepOnline(online.perfect);
    const extraNear = keepOnline(online.near);
    if (extraPerfect.length === 0 && extraNear.length === 0) {
      onlineBody.createEl('p', { cls: 'pn-vide', text: 'Nothing more than CMUdict for these filters.' });
      return;
    }
    makeWordGroup(onlineBody, 'Perfect (not already listed)', extraPerfect, 'pn-mot', idx);
    if (extraNear.length) {
      onlineBody.createDiv({ cls: 'pn-titre pn-label-assonance', text: `Near / slant (${extraNear.length})` });
      const words = onlineBody.createDiv({ cls: 'pn-mots' });
      showWithLimit(words, extraNear, (w) => makeWordChip(words, w, 'pn-mot pn-mot-assonance', idx));
    }
  }
  // ---- Synonyms tab ----
  // Same structure as the French Synonymes tab: "also search online" box,
  // search form, optional "rhymes with" / syllable filters, then one
  // collapsible block per source. Online chips can be clicked to leave
  // them out, then saved to the personal dictionary in one go.
  renderSynonymsTab(panel) {
    const sourcesBox = panel.createDiv({ cls: 'pn-sources' });
    sourcesBox.createSpan({ cls: 'pn-sources-label', text: 'Also search online: ' });
    const datamuseToggle = makeTogglePill(sourcesBox, 'Datamuse', (this.plugin.settings.onlineSources || []).includes('synonyms'));

    const form = panel.createDiv({ cls: 'pn-rime-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A word… (e.g. bright, sad, light)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });

    const filters = panel.createDiv({ cls: 'pn-filtres' });
    const rhymeInput = filters.createEl('input', { cls: 'pn-filtre-lettre', attr: { type: 'text', placeholder: 'Rhymes with… (optional)', style: 'width:180px' } });
    rhymeInput.setAttr('title', 'Optional: keep only the synonyms/antonyms that also rhyme with this second word — useful when another line has already fixed the rhyme.');
    const syllSelect = makeSyllableSelect(filters);
    syllSelect.setAttr('title', 'Keep only synonyms/antonyms with this many syllables — useful to fit a word into a given meter.');

    const results = panel.createDiv({ cls: 'pn-resultats' });
    const doSearch = () => this.renderSynonymResults(results, wordInput.value, datamuseToggle.checked, rhymeInput.value, syllSelect.value);

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    rhymeInput.addEventListener('input', doSearch);
    syllSelect.addEventListener('change', doSearch);
    datamuseToggle.addEventListener('change', async () => {
      await this.plugin.setOnlineSource('synonyms', datamuseToggle.checked);
      doSearch();
    });

    this._prefillSynonyms = (word) => { wordInput.value = word; doSearch(); };
  }

  async renderSynonymResults(container, rawWord, online, rhymeTarget, syllables) {
    container.empty();
    const word = (rawWord || '').trim();
    if (!word) return;
    const key = word.toLowerCase();
    const idx = this.plugin.cmudictIndex;
    const target = (rhymeTarget || '').trim();
    const applyFilters = (list) => filterBySyllables(filterByRhyme(list, target, idx), syllables, idx);
    const rerender = () => this.renderSynonymResults(container, rawWord, online, rhymeTarget, syllables);

    // ---- personal dictionary ----
    const localBody = makeSourceBlock(container, `${word} — my dictionary`, true, true);
    const dict = this.plugin.personalDictionary || {};
    const syn = applyFilters((dict.synonyms || {})[key] || []);
    const ant = applyFilters((dict.antonyms || {})[key] || []);
    const removable = (kind) => (span, w) => {
      const x = span.createSpan({ cls: 'pn-tag-chip-x', text: ' ×' });
      x.setAttr('title', 'Remove from my dictionary');
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (kind === 'syno') await this.plugin.removeSynonymFromPersonalDictionary(word, w);
        else await this.plugin.removeAntonymFromPersonalDictionary(word, w);
        rerender();
      });
    };
    if (syn.length === 0 && ant.length === 0) {
      localBody.createEl('p', { cls: 'pn-vide', text: (target || syllables) ? 'No saved synonym/antonym matches these filters.' : 'Nothing saved for this word yet.' });
    } else {
      makeWordGroup(localBody, 'Synonyms', syn, 'pn-mot pn-mot-syno', idx, { type: 'syno', onChip: removable('syno') });
      makeWordGroup(localBody, 'Antonyms', ant, 'pn-mot pn-mot-anto', idx, { type: 'anto', onChip: removable('anto') });
    }
    // manual entry
    const addRow = localBody.createDiv({ cls: 'pn-hasard-ligne-form' });
    const addInput = addRow.createEl('input', { attr: { type: 'text', placeholder: `add a word for "${word}"…` } });
    const kindWrap = addRow.createDiv({ cls: 'pn-select-wrap' });
    const kindSelect = kindWrap.createEl('select');
    kindSelect.createEl('option', { attr: { value: 'syno' }, text: 'Synonym' });
    kindSelect.createEl('option', { attr: { value: 'anto' }, text: 'Antonym' });
    kindWrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
    const addBtn = addRow.createEl('button', { cls: 'pn-link-btn', text: '+ save' });
    const doAdd = async () => {
      const value = addInput.value.trim();
      if (!value) return;
      const res = kindSelect.value === 'syno'
        ? await this.plugin.addSynonymToPersonalDictionary(word, value)
        : await this.plugin.addAntonymToPersonalDictionary(word, value);
      if (!res.ok && res.reason === 'self') { new Notice(`"${value}" is the same as "${word}" — a word can't be its own synonym or antonym.`); return; }
      new Notice(res.ok ? `Saved "${value}" to your dictionary.` : 'Could not save — see console.');
      if (res.ok) rerender();
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

    if (!online) return;

    // ---- Datamuse ----
    const onlineBody = makeSourceBlock(container, `${word} — Datamuse`, true, false);
    const status = onlineBody.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
    try {
      const [s, a] = await Promise.all([fetchDatamuseSynonymsRanked(word), fetchDatamuseAntonymsRanked(word)]);
      status.remove();
      const savedSyn = new Set(((dict.synonyms || {})[key] || []).map((w) => w.toLowerCase()));
      const savedAnt = new Set(((dict.antonyms || {})[key] || []).map((w) => w.toLowerCase()));
      const fresh = (list, saved) => list.filter((i) => i.word.toLowerCase() !== key && !saved.has(i.word.toLowerCase()));
      const synAll = fresh(s, savedSyn);
      const antAll = fresh(a, savedAnt);
      if (synAll.length === 0 && antAll.length === 0) {
        onlineBody.createEl('p', { cls: 'pn-vide', text: `Nothing new found on Datamuse for "${word}".` });
        return;
      }

      // Relevance threshold, same steps as the French plugin's CNRTL source.
      let threshold = 30;
      const thresholdDiv = onlineBody.createDiv({ cls: 'pn-cnrtl-seuil' });
      thresholdDiv.createSpan({ cls: 'pn-sources-label', text: 'Relevance threshold: ' });
      thresholdDiv.setAttr('title', 'Datamuse scores rescaled to 0-100 against the best match of each list. Bold = 70 or more.');
      const steps = [['All', 0], ['30%', 30], ['60%', 60], ['85%', 85]].map(([label, value]) => {
        const b = thresholdDiv.createEl('button', { cls: 'pn-hasard-toggle-pool', text: label });
        if (value === threshold) b.addClass('active');
        b.addEventListener('click', () => {
          threshold = value;
          steps.forEach((x) => x.removeClass('active'));
          b.addClass('active');
          renderChips();
        });
        return b;
      });
      const chipsZone = onlineBody.createDiv();
      const saveZone = onlineBody.createDiv();

      const renderChips = () => {
        chipsZone.empty();
        saveZone.empty();
        const pass = (i) => i.rank === null || i.rank >= threshold;
        const synOnline = applyFilters(synAll.filter(pass));
        const antOnline = applyFilters(antAll.filter(pass));
        if (synOnline.length === 0 && antOnline.length === 0) {
          chipsZone.createEl('p', { cls: 'pn-vide', text: 'No Datamuse result matches these filters.' });
          return;
        }
        const exclSyn = new Set();
        const exclAnt = new Set();
        makeWordGroup(chipsZone, 'Synonyms', synOnline, 'pn-mot pn-mot-syno', idx, { type: 'syno', excluded: exclSyn });
        makeWordGroup(chipsZone, 'Antonyms', antOnline, 'pn-mot pn-mot-anto', idx, { type: 'anto', excluded: exclAnt });
        const saveBtn = saveZone.createEl('button', { cls: 'pn-link-btn', text: '💾 Save to my personal dictionary' });
        saveBtn.setAttr('title', 'Saves everything shown above, except the greyed/struck-through words (click a word to leave it out).');
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          saveBtn.setText('Saving…');
          let ok = true;
          for (const i of synOnline) if (!exclSyn.has(i.word)) ok = (await this.plugin.addSynonymToPersonalDictionary(word, i.word)).ok && ok;
          for (const i of antOnline) if (!exclAnt.has(i.word)) ok = (await this.plugin.addAntonymToPersonalDictionary(word, i.word)).ok && ok;
          saveBtn.setText(ok ? 'Saved ✓' : '💾 Retry saving');
          if (!ok) saveBtn.disabled = false;
        });
      };
      renderChips();
    } catch (e) {
      status.setText('Datamuse: search impossible (no connection, site unreachable, or timeout).');
    }
  }
  // ---- Definitions tab ----
  // Same structure as the French Définitions tab: form (field, Search,
  // "open on…" link), then a titled result with a framed quick block
  // (etymology) and one collapsible block per part of speech.
  renderDefinitionsTab(panel) {
    const form = panel.createDiv({ cls: 'pn-rime-form pn-defs-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A word… (e.g. melancholy, canopy, ire)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });
    const openLink = form.createEl('a', { cls: 'pn-icon-btn', text: 'Open on Wiktionary ↗', attr: { target: '_blank', rel: 'noopener', href: 'https://en.wiktionary.org/' } });
    const syncLink = () => {
      const w = wordInput.value.trim();
      openLink.setAttr('href', w ? `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` : 'https://en.wiktionary.org/');
    };
    wordInput.addEventListener('input', syncLink);

    const results = panel.createDiv({ cls: 'pn-resultats' });

    // Two sources, switched with pills like the French plugin's CNRTL
    // dictionaries: Free Dictionary API (clean JSON, first) and the
    // Wiktionary page extract (fallback, has etymology more often).
    const SOURCES = [
      { id: 'freedict', label: 'Free Dictionary', render: (zone, word) => this.renderFreeDictionary(zone, word) },
      { id: 'wiktionary', label: 'Wiktionary', render: (zone, word) => this.renderWiktionaryDefinition(zone, word) },
    ];

    const doSearch = async () => {
      const word = wordInput.value.trim();
      results.empty();
      if (!word) return;
      syncLink();
      results.createDiv({ cls: 'pn-son-label', text: word });
      const pills = results.createDiv({ cls: 'pn-cnrtl-source-pills' });
      const zone = results.createDiv({ cls: 'pn-cnrtl-source-zone' });
      const buttons = [];
      const show = async (src) => {
        buttons.forEach(({ b, id }) => b.toggleClass('active', id === src.id));
        zone.empty();
        const status = zone.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
        let found = false;
        try {
          found = await src.render(zone, word);
          status.remove();
        } catch (e) {
          status.setText(`${src.label}: search impossible (no connection, site unreachable, or timeout).`);
          return false;
        }
        if (!found) zone.createEl('p', { cls: 'pn-vide', text: `"${word}" has no English entry on ${src.label}.` });
        return found;
      };
      SOURCES.forEach((src) => {
        const b = pills.createEl('button', { cls: 'pn-cnrtl-source-pill', text: src.label });
        b.addEventListener('click', () => show(src));
        buttons.push({ b, id: src.id });
      });
      // First source; if it has nothing (or fails), fall back to Wiktionary.
      const ok = await show(SOURCES[0]).catch(() => false);
      if (!ok) await show(SOURCES[1]);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });

    this._prefillDefinitions = (word) => { wordInput.value = word; doSearch(); };
  }

  // Free Dictionary API block. Returns true when an entry was found.
  async renderFreeDictionary(zone, word) {
    const entry = await fetchFreeDictionaryEntry(word);
    if (!entry || entry.groups.length === 0) return false;
    if (entry.phonetics.length || entry.origin) {
      const block = zone.createDiv({ cls: 'pn-cnrtl-bloc' });
      if (entry.phonetics.length) {
        block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Pronunciation' });
        block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.phonetics.join('  ·  ') });
      }
      if (entry.origin) {
        block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Origin' });
        block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.origin });
      }
    }
    entry.groups.forEach((g, i) => {
      const det = zone.createEl('details', { cls: 'pn-cnrtl-details' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-cnrtl-details-titre', text: `${g.pos} (${g.definitions.length})` });
      const body = det.createDiv({ cls: 'pn-cnrtl-texte' });
      const list = body.createEl('ol');
      g.definitions.forEach((d) => {
        const li = list.createEl('li', { text: d.text });
        if (d.example) li.createDiv({ cls: 's-example', text: d.example });
      });
      const idx = this.plugin.cmudictIndex;
      makeWordGroup(body, 'Synonyms', g.synonyms, 'pn-mot pn-mot-syno', idx, { type: 'syno' });
      makeWordGroup(body, 'Antonyms', g.antonyms, 'pn-mot pn-mot-anto', idx, { type: 'anto' });
    });
    zone.createEl('a', { cls: 'pn-cnrtl-lien', text: 'Source: Wiktionary via dictionaryapi.dev (CC BY-SA)', attr: { href: 'https://dictionaryapi.dev/', target: '_blank', rel: 'noopener' } });
    return true;
  }

  // Wiktionary page-extract block (the original parser). Returns true when
  // an entry was found.
  async renderWiktionaryDefinition(zone, word) {
    const entry = await fetchWiktionaryEntry(word);
    if (!entry) return false;
    const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    zone.createEl('a', { cls: 'pn-cnrtl-lien', text: `See "${word}" on Wiktionary →`, attr: { href: url, target: '_blank', rel: 'noopener' } });
    if (entry.etymology) {
      const block = zone.createDiv({ cls: 'pn-cnrtl-bloc' });
      block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Etymology' });
      block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.etymology });
    }
    if (entry.definitions.length === 0) {
      zone.createEl('p', { cls: 'pn-vide', text: 'No definitions parsed for this word — the Wiktionary page may use an unusual layout. Use the link above to read it directly.' });
    }
    entry.definitions.forEach((group, i) => {
      const det = zone.createEl('details', { cls: 'pn-cnrtl-details' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-cnrtl-details-titre', text: group.pos });
      const body = det.createDiv({ cls: 'pn-cnrtl-texte' });
      const numbered = group.lines.filter((l) => /^\d+\.\s/.test(l));
      const list = body.createEl('ol');
      (numbered.length > 0 ? numbered : group.lines).forEach((line) => list.createEl('li', { text: line.replace(/^\d+\.\s*/, '') }));
    });
    return true;
  }
  // ---- Guide tab (static reference content, no network) ----
  // Same structure as the French Guide: a table of contents box, then
  // one collapsible section per topic (the first one open).
  renderGuideTab(panel) {
    const sections = [];
    const section = (title, html) => sections.push({ title, html });

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

    const toc = panel.createDiv({ cls: 'pn-guide-sommaire' });
    toc.createDiv({ cls: 'pn-guide-sommaire-titre', text: 'Contents' });
    const tocList = toc.createEl('ul');
    const detailsEls = [];
    sections.forEach((s, i) => {
      const link = tocList.createEl('li').createEl('a', { text: s.title, attr: { href: '#' } });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        detailsEls[i].open = true;
        detailsEls[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    sections.forEach((s, i) => {
      const det = panel.createEl('details', { cls: 'pn-guide-section' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-guide-titre', text: s.title });
      const body = det.createDiv({ cls: 'pn-guide-corps' });
      body.innerHTML = s.html;
      body.querySelectorAll('p').forEach((el) => el.classList.add('pn-guide-p'));
      body.querySelectorAll('ul, ol').forEach((el) => el.classList.add('pn-guide-liste'));
      detailsEls.push(det);
    });
  }
  // ---- Inspiration tab ----
  // Same structure as the French Inspiration tab: "complete online" box,
  // search form, then results per source. Words can be clicked to build a
  // selection (kept across searches) and added to a personal theme or as
  // rare words — those land in the Notes tab if they have no note.
  renderInspirationTab(panel) {
    const sourcesBox = panel.createDiv({ cls: 'pn-sources' });
    sourcesBox.createSpan({ cls: 'pn-sources-label', text: 'Complete online: ' });
    const datamuseToggle = makeTogglePill(sourcesBox, 'Datamuse', (this.plugin.settings.onlineSources || []).includes('inspiration'),
      'Adds related words and collocations (adjectives used with the word, nouns it qualifies, words found near it) from Datamuse. Never queried unless checked.');

    // Colour legend for the online groups (same presentation as the French
    // plugin), closed by default.
    const legend = panel.createEl('details', { cls: 'pn-hasard-stats-details pn-inspi-legende' });
    legend.createEl('summary', { text: 'Show the legend' });
    [
      ['lexical', 'Related words', 'words with a similar meaning (Datamuse "means like")'],
      ['carac', 'Often described as', 'adjectives frequently used with the word'],
      ['parties', 'Often describes', 'nouns the word frequently qualifies'],
      ['famille', 'Often found near', 'words statistically found close to it in text'],
    ].forEach(([key, name, detail]) => {
      const row = legend.createDiv({ cls: `pn-inspi-legende-ligne pn-nature-${key}` });
      row.createSpan({ cls: 'pn-inspi-pastille' });
      row.createSpan({ cls: 'pn-inspi-legende-nom', text: name });
      row.createSpan({ cls: 'pn-inspi-legende-detail', text: ' — ' + detail });
    });

    const form = panel.createDiv({ cls: 'pn-rime-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A theme… (e.g. forest, sea, night, love, time)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });

    // --- selection kept across searches + action bar ---
    const selection = new Map(); // lowercase word -> { word, theme, note }
    const actionBar = panel.createDiv({ cls: 'pn-inspi-action-bar' });
    actionBar.style.display = 'none';

    const refreshHighlight = () => {
      panel.querySelectorAll('[data-pn-word]').forEach((el) => el.classList.toggle('pn-selectionne', selection.has(el.dataset.pnWord)));
    };
    const toggleSelection = (word, theme, note) => {
      const k = word.toLowerCase();
      if (selection.has(k)) selection.delete(k); else selection.set(k, { word, theme, note });
      renderActionBar();
    };
    const selectionApi = { has: (k) => selection.has(k), toggle: toggleSelection };

    const renderActionBar = () => {
      actionBar.empty();
      if (selection.size === 0) { actionBar.style.display = 'none'; return; }
      actionBar.style.display = 'flex';
      const chipsRow = actionBar.createDiv({ cls: 'pn-inspi-selection-chips' });
      chipsRow.createSpan({ cls: 'pn-sources-label', text: `${selection.size} word${selection.size > 1 ? 's' : ''} selected: ` });
      [...selection.values()].forEach(({ word }) => {
        const chip = chipsRow.createSpan({ cls: 'pn-tag-chip' });
        chip.createSpan({ text: word });
        const x = chip.createSpan({ cls: 'pn-tag-chip-x', text: ' ×' });
        x.addEventListener('click', () => { toggleSelection(word); refreshHighlight(); });
      });
      const clearBtn = chipsRow.createEl('button', { cls: 'pn-link-btn', text: 'Deselect all' });
      clearBtn.addEventListener('click', () => { selection.clear(); renderActionBar(); refreshHighlight(); });

      const actionsRow = actionBar.createDiv({ cls: 'pn-inspi-selection-actions' });
      const themeBtn = actionsRow.createEl('button', { cls: 'pn-hasard-graver-btn', text: '+ Add to a theme' });
      const rareBtn = actionsRow.createEl('button', { cls: 'pn-hasard-graver-btn', text: '+ Add as rare word(s)' });

      let themeForm = null;
      themeBtn.addEventListener('click', () => {
        if (themeForm) { themeForm.remove(); themeForm = null; return; }
        themeForm = actionBar.createDiv({ cls: 'pn-inspi-ajout-form' });
        const listId = 'pn-inspi-themes-' + Math.random().toString(36).slice(2, 8);
        const themeInput = themeForm.createEl('input', { attr: { type: 'text', placeholder: 'theme (e.g. Mountains)', list: listId } });
        const datalist = themeForm.createEl('datalist', { attr: { id: listId } });
        ((this.plugin.personalDictionary && this.plugin.personalDictionary.vocabularyThemes) || [])
          .forEach((t) => t && t.theme && datalist.createEl('option', { attr: { value: t.theme } }));
        const triggersInput = themeForm.createEl('input', { attr: { type: 'text', placeholder: 'trigger words, comma-separated (if new theme)' } });
        const okBtn = themeForm.createEl('button', { cls: 'pn-link-btn', text: `Add the ${selection.size} word(s)` });
        const suggested = [...new Set([...selection.values()].map((v) => v.theme).filter(Boolean))];
        if (suggested.length === 1) {
          const sug = themeForm.createDiv({ cls: 'pn-inspi-suggestion' });
          sug.createSpan({ text: 'Suggestion: ' });
          const sugBtn = sug.createEl('button', { cls: 'pn-link-btn', text: suggested[0] });
          sugBtn.addEventListener('click', () => { themeInput.value = suggested[0]; themeInput.focus(); });
        }
        const submit = async () => {
          const theme = themeInput.value.trim();
          if (!theme) { new Notice('A theme is required.'); return; }
          const triggers = triggersInput.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
          const words = [...selection.values()];
          const n = await this.plugin.addThemeWords(theme, triggers, words.map(({ word, note }) => ({ word, note })));
          new Notice(`Poet's Notebook: ${n} word(s) added to the theme "${theme}".`);
          selection.clear(); renderActionBar(); refreshHighlight();
        };
        okBtn.addEventListener('click', submit);
        themeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      });

      rareBtn.addEventListener('click', async () => {
        let n = 0;
        for (const { word, note } of selection.values()) if (await this.plugin.addRareWord(word, note || '', [], { quiet: true })) n++;
        new Notice(`Poet's Notebook: ${n} word(s) added as rare words to your personal dictionary.`);
        selection.clear(); renderActionBar(); refreshHighlight();
      });
    };

    const results = panel.createDiv({ cls: 'pn-resultats' });
    const doSearch = () => this.renderInspirationResults(results, wordInput.value, datamuseToggle.checked, selectionApi);

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
    datamuseToggle.addEventListener('change', () => this.plugin.setOnlineSource('inspiration', datamuseToggle.checked));

    this._prefillInspiration = (word) => { wordInput.value = word; doSearch(); };
  }

  // Shared by the Inspiration tab and the Inspiration modal (editor
  // right-click on a selection). selectionApi is null in the modal.
  async renderInspirationResults(results, rawWord, includeDatamuse, selectionApi) {
    results.empty();
    const word = (rawWord || '').trim();
    if (!word) return;

    const makeSelectable = (el, w, theme, note) => {
      if (!selectionApi) return;
      const k = w.toLowerCase();
      el.dataset.pnWord = k;
      el.addClass('pn-inspi-cliquable');
      el.toggleClass('pn-selectionne', selectionApi.has(k));
      el.addEventListener('click', () => {
        selectionApi.toggle(w, theme, note);
        el.toggleClass('pn-selectionne', selectionApi.has(k));
      });
    };

    const localBody = makeSourceBlock(results, `${word} — themes (built-in, personal, Roget)`, true, true);
    const themes = findInspiration(word, this.plugin.personalDictionary);
    if (themes.length === 0) {
      localBody.createEl('p', {
        cls: 'pn-vide',
        text: `No theme is triggered by "${word}" — try a broader word (forest, sea, night, love, time, fire, weather, silence…), or add your own theme to the personal dictionary.`,
      });
    } else {
      for (const t of themes) {
        const block = localBody.createDiv({ cls: 'pn-groupe' });
        block.createDiv({ cls: 'pn-son-label', text: t.theme });
        const list = block.createDiv({ cls: 'pn-inspi-liste' });
        for (const entry of (t.words || [])) {
          const w = typeof entry === 'string' ? entry : entry.word;
          const note = typeof entry === 'string' ? '' : (entry.note || '');
          if (!w) continue;
          const row = list.createDiv({ cls: 'pn-inspi-mot' });
          const term = row.createSpan({ cls: 'pn-inspi-terme', text: w });
          if (note) row.createSpan({ cls: 'pn-inspi-note', text: note });
          makeSelectable(term, w, t.theme, note);
        }
      }
    }

    if (!includeDatamuse) return;
    const onlineBody = makeSourceBlock(results, `${word} — Datamuse`, true, false);
    const status = onlineBody.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
    try {
      const [related, coll] = await Promise.all([fetchDatamuseMeansLike(word), fetchDatamuseCollocations(word)]);
      status.remove();
      const groups = [
        ['Related words', related, 'pn-nature-lexical'],
        [`Often described as… (adjectives used with "${word}")`, coll.describedAs, 'pn-nature-carac'],
        [`Often describes… (nouns "${word}" qualifies)`, coll.describes, 'pn-nature-parties'],
        ['Often found near', coll.triggers, 'pn-nature-famille'],
      ].filter(([, list]) => list.length > 0);
      if (groups.length === 0) { onlineBody.createEl('p', { cls: 'pn-vide', text: `Nothing found on Datamuse for "${word}".` }); return; }
      const suggestedTheme = word.charAt(0).toUpperCase() + word.slice(1);
      groups.forEach(([title, list, nature]) => makeWordGroup(onlineBody, title, list, 'pn-mot pn-mot-inspi', this.plugin.cmudictIndex, {
        extraCls: nature,
        onChip: (span, w) => makeSelectable(span, w, suggestedTheme, ''),
      }));
    } catch (e) {
      status.setText('Datamuse: search impossible (no connection, site unreachable, or timeout).');
    }
  }
  // ---- Random tab ----
  // Same structure as the French Hasard tab: a "quick draw" banner of
  // filter shortcuts, two collapsible sections (filter by tags / exclude
  // tags), the draw zone (counter, button, word, note, tags, actions,
  // tag presets and form), then "add a rare word" and statistics.
  renderRandomTab(panel) {
    const state = {
      includeTags: new Set(),
      excludeTags: new Set(),
      includeMode: 'or',
      onlyLiked: false,
      onlyExcluded: false,
      hideTagged: false,
      multiTagged: false,
    };
    const pool = () => poolWithMeta(this.plugin.personalDictionary);
    const customTags = (w) => w.userTags || [];
    const filtered = () => filterPool(pool(), state).filter((w) => {
      const n = customTags(w).length;
      if (state.hideTagged && n > 0) return false;
      if (state.multiTagged && n < 2) return false;
      return true;
    });
    const allTags = () => allTagsFromPool(pool());
    const tagsByFrequency = () => {
      const counts = new Map();
      pool().forEach((w) => customTags(w).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    };

    let statsDiv = null;
    let counterEl = null;

    const filtersDiv = panel.createDiv({ cls: 'pn-hasard-filtres' });
    const banner = filtersDiv.createDiv({ cls: 'pn-hasard-bandeau' });
    banner.createDiv({ cls: 'pn-titre', text: 'Quick draw' });
    const quickDiv = banner.createDiv({ cls: 'pn-hasard-filtres-rapides' });

    const incl = makeCollapsibleSection(filtersDiv, 'Filter by tags', 'pn-hasard-section-inclusion');
    const inclForm = incl.body.createDiv({ cls: 'pn-hasard-ligne-form' });
    const inclListId = 'pn-random-taglist-' + Math.random().toString(36).slice(2, 8);
    const inclInput = inclForm.createEl('input', { attr: { type: 'text', placeholder: 'a tag (or click several pills below)…', list: inclListId } });
    const inclDatalist = inclForm.createEl('datalist', { attr: { id: inclListId } });
    const inclAddBtn = inclForm.createEl('button', { cls: 'pn-link-btn', text: '+ add tag' });
    const inclAllBtn = inclForm.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags' });
    const andLabel = incl.body.createEl('label', { cls: 'pn-hasard-mode-et' });
    const andCheckbox = andLabel.createEl('input', { attr: { type: 'checkbox' } });
    andLabel.createSpan({ text: ' All checked tags (AND) rather than at least one (OR)' });
    const inclChips = incl.body.createDiv({ cls: 'pn-hasard-filtres-chips' });

    const excl = makeCollapsibleSection(filtersDiv, 'Exclude tags', 'pn-hasard-section-exclusion');
    const exclForm = excl.body.createDiv({ cls: 'pn-hasard-ligne-form' });
    const exclListId = 'pn-random-excllist-' + Math.random().toString(36).slice(2, 8);
    const exclInput = exclForm.createEl('input', { attr: { type: 'text', placeholder: 'a tag to exclude (or click several pills)…', list: exclListId } });
    const exclDatalist = exclForm.createEl('datalist', { attr: { id: exclListId } });
    const exclAddBtn = exclForm.createEl('button', { cls: 'pn-link-btn', text: '+ exclude' });
    const exclAllBtn = exclForm.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags to exclude' });
    const exclChips = excl.body.createDiv({ cls: 'pn-hasard-filtres-chips' });

    incl.setCountBadge(() => state.includeTags.size);
    excl.setCountBadge(() => state.excludeTags.size);

    const inclPanel = makeAllTagsPanel(incl.body, inclAllBtn,
      () => allTags().filter((t) => !state.includeTags.has(t)),
      (t) => { state.includeTags.add(t); refresh(); });
    const exclPanel = makeAllTagsPanel(excl.body, exclAllBtn,
      () => allTags().filter((t) => !state.excludeTags.has(t)),
      (t) => { state.excludeTags.add(t); refresh(); }, 'See all tags to exclude');

    const renderQuick = () => {
      quickDiv.empty();
      [
        { label: '🚫 Explore excluded', on: state.onlyExcluded, color: '#a3831f', toggle: () => { state.onlyExcluded = !state.onlyExcluded; } },
        { label: '♥ Explore liked', on: state.onlyLiked, color: '#c2185b', toggle: () => { state.onlyLiked = !state.onlyLiked; } },
        { label: '📭 Hide words already tagged', on: state.hideTagged, color: 'var(--text-muted)', toggle: () => { state.hideTagged = !state.hideTagged; } },
        { label: '🏷️ Explore multi-tagged', on: state.multiTagged, color: 'var(--text-muted)', toggle: () => { state.multiTagged = !state.multiTagged; } },
      ].forEach((q) => {
        const b = quickDiv.createEl('button', { cls: 'pn-hasard-filtre-rapide' + (q.on ? ' pn-hasard-filtre-rapide-actif' : ''), text: q.label });
        b.style.borderColor = q.color;
        if (q.on) { b.style.background = q.color; b.style.color = '#fff'; } else { b.style.color = q.color; }
        b.addEventListener('click', () => { q.toggle(); refresh(); });
      });
    };

    const renderStats = () => {
      if (!statsDiv) return;
      statsDiv.empty();
      const all = pool();
      const excludedN = all.filter((w) => w.excluded).length;
      const likedN = all.filter((w) => w.liked).length;
      const untagged = all.filter((w) => customTags(w).length === 0).length;
      const item = (text, cls) => statsDiv.createSpan({ cls: 'pn-hasard-stat ' + cls, text });
      item(`${all.length} word(s) in total`, 'pn-hasard-stat-total');
      item(`${excludedN} excluded`, 'pn-hasard-stat-exclus');
      item(`${untagged} without a tag`, 'pn-hasard-stat-sanstag');
      item(`${likedN} liked`, 'pn-hasard-stat-vu');
      const counts = new Map();
      all.forEach((w) => customTags(w).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      if (counts.size) {
        const detail = statsDiv.createDiv({ cls: 'pn-hasard-stats-detail' });
        const bloc = detail.createDiv({ cls: 'pn-hasard-stats-bloc' });
        bloc.createDiv({ cls: 'pn-titre', text: 'By tag' });
        const list = bloc.createDiv({ cls: 'pn-hasard-stats-liste' });
        [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
          const chip = list.createSpan({ cls: 'pn-hasard-stats-chip', text: `${t} · ${n}` });
          const c = tagColor(t);
          chip.style.borderColor = c; chip.style.color = c;
        });
      }
    };

    const refresh = () => {
      state.includeMode = andCheckbox.checked ? 'and' : 'or';
      renderQuick();
      renderStats();
      incl.render();
      excl.render();
      const tags = allTags();
      inclDatalist.empty();
      exclDatalist.empty();
      tags.forEach((t) => {
        if (!state.includeTags.has(t)) inclDatalist.createEl('option', { attr: { value: t } });
        if (!state.excludeTags.has(t)) exclDatalist.createEl('option', { attr: { value: t } });
      });
      inclPanel.render();
      exclPanel.render();
      inclChips.empty();
      if (state.includeTags.size) {
        inclChips.createSpan({ cls: 'pn-sources-label', text: 'Active filters: ' });
        [...state.includeTags].forEach((t) => makeTagChip(inclChips, t, () => { state.includeTags.delete(t); refresh(); }));
      }
      exclChips.empty();
      if (state.excludeTags.size) {
        exclChips.createSpan({ cls: 'pn-sources-label', text: 'Excluded: ' });
        [...state.excludeTags].forEach((t) => makeTagChip(exclChips, t, () => { state.excludeTags.delete(t); refresh(); }));
      }
      if (counterEl) {
        const n = filtered().length;
        counterEl.setText(n === 0 ? 'No word matches these filters' : `${n} word${n > 1 ? 's' : ''} match${n > 1 ? '' : 'es'} these filters`);
      }
      if (current) renderPresets();
    };

    const addFrom = (input, set) => {
      const t = input.value.trim();
      if (!t) return;
      set.add(t);
      input.value = '';
      refresh();
    };
    inclAddBtn.addEventListener('click', () => addFrom(inclInput, state.includeTags));
    inclInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFrom(inclInput, state.includeTags); } });
    exclAddBtn.addEventListener('click', () => addFrom(exclInput, state.excludeTags));
    exclInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFrom(exclInput, state.excludeTags); } });
    andCheckbox.addEventListener('change', refresh);

    // ---- draw zone ----
    const zone = panel.createDiv({ cls: 'pn-hasard-zone' });
    counterEl = zone.createDiv({ cls: 'pn-hasard-compteur-pool' });
    const drawWrap = zone.createDiv({ cls: 'pn-hasard-bouton-wrap' });
    const drawBtn = drawWrap.createEl('button', { cls: 'pn-hasard-bouton', text: '🎲 Draw a random word' });
    const wordEl = zone.createDiv({ cls: 'pn-hasard-mot' });
    const noteEl = zone.createDiv({ cls: 'pn-hasard-note' });
    const chipsDiv = zone.createDiv({ cls: 'pn-hasard-tags' });
    const actions = zone.createDiv({ cls: 'pn-hasard-actions' });
    actions.style.display = 'none';
    const defsBtn = actions.createEl('button', { cls: 'pn-link-btn', text: 'See its definition →' });
    const rhymesBtn = actions.createEl('button', { cls: 'pn-link-btn', text: 'Find its rhymes →' });
    const likeBtn = actions.createEl('button', { cls: 'pn-link-btn' });
    const excludeBtn = actions.createEl('button', { cls: 'pn-link-btn pn-btn-exclure' });
    const presetsDiv = zone.createDiv({ cls: 'pn-hasard-tag-presets' });
    presetsDiv.style.display = 'none';
    const allTagsBtn = zone.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags' });
    allTagsBtn.style.display = 'none';
    const tagForm = zone.createDiv({ cls: 'pn-hasard-tag-ajout' });
    tagForm.style.display = 'none';
    const tagListId = 'pn-random-tagadd-' + Math.random().toString(36).slice(2, 8);
    const tagInput = tagForm.createEl('input', { attr: { type: 'text', placeholder: 'add a tag (e.g. archaic)', list: tagListId } });
    const tagDatalist = tagForm.createEl('datalist', { attr: { id: tagListId } });
    const tagAddBtn = tagForm.createEl('button', { cls: 'pn-link-btn', text: '+ tag' });

    let current = null; // pool entry currently shown

    const reloadCurrent = () => {
      if (!current) return;
      const fresh = pool().find((w) => w.word.toLowerCase() === current.word.toLowerCase());
      if (fresh) current = fresh;
    };
    const addTag = async (t) => {
      if (!current || !t) return;
      await this.plugin.addWordTag(current.word, t);
      reloadCurrent(); renderCurrent(); refresh();
    };
    const allTagsPanel = makeAllTagsPanel(zone, allTagsBtn, () => {
      const all = tagsByFrequency();
      return all.length > 6 ? [...all].sort() : [];
    }, addTag);
    const renderPresets = () => {
      presetsDiv.empty();
      const top = tagsByFrequency().filter((t) => !customTags(current).includes(t)).slice(0, 6);
      presetsDiv.style.display = top.length ? 'flex' : 'none';
      top.forEach((t) => {
        const b = presetsDiv.createEl('button', { cls: 'pn-hasard-preset-btn', text: '+ ' + t });
        const c = tagColor(t);
        b.style.borderColor = c; b.style.color = c;
        b.addEventListener('click', () => addTag(t));
      });
      allTagsPanel.render();
      tagDatalist.empty();
      allTags().forEach((t) => tagDatalist.createEl('option', { attr: { value: t } }));
    };

    const renderCurrent = () => {
      if (!current) return;
      wordEl.setText(current.word);
      noteEl.empty();
      if (current.note) noteEl.createDiv({ cls: 'pn-hasard-note-partie', text: current.note });
      if (current.estimated) {
        noteEl.createDiv({ cls: 'pn-hasard-note-sep', text: 'not in CMUdict: syllables estimated, rhymes only online (Datamuse)' });
      }
      chipsDiv.empty();
      const theme = current.theme || 'Untagged';
      const themeChip = chipsDiv.createSpan({ cls: 'pn-tag-chip', text: theme });
      themeChip.setAttr('title', 'Theme (always a tag)');
      customTags(current).forEach((t) => makeTagChip(chipsDiv, t, async () => {
        await this.plugin.removeWordTag(current.word, t);
        reloadCurrent(); renderCurrent(); refresh();
      }));
      likeBtn.setText(current.liked ? '♥ Liked (undo)' : '♡ Like');
      excludeBtn.setText(current.excluded ? '↩ Draw this word again' : '🚫 Stop drawing this word');
      actions.style.display = 'flex';
      tagForm.style.display = 'flex';
      renderPresets();
    };

    const draw = () => {
      const list = filtered();
      if (list.length === 0) {
        current = null;
        wordEl.setText('No word available with these filters.');
        noteEl.empty(); chipsDiv.empty(); presetsDiv.empty();
        presetsDiv.style.display = 'none';
        actions.style.display = 'none';
        tagForm.style.display = 'none';
        allTagsBtn.style.display = 'none';
        return;
      }
      current = list[Math.floor(Math.random() * list.length)];
      renderCurrent();
    };

    drawBtn.addEventListener('click', draw);
    defsBtn.addEventListener('click', () => {
      if (!current) return;
      this.switchTab('definitions');
      if (this._prefillDefinitions) this._prefillDefinitions(current.word);
    });
    rhymesBtn.addEventListener('click', () => {
      if (!current) return;
      this.switchTab('rhymes');
      if (this._prefillRhymes) this._prefillRhymes(current.word);
    });
    likeBtn.addEventListener('click', async () => {
      if (!current) return;
      await this.plugin.toggleWordLiked(current.word);
      reloadCurrent(); renderCurrent(); refresh();
    });
    excludeBtn.addEventListener('click', async () => {
      if (!current) return;
      const wasExcluded = current.excluded;
      await this.plugin.toggleWordExcluded(current.word);
      if (!wasExcluded) { new Notice(`"${current.word}" won't be drawn anymore.`); refresh(); draw(); return; }
      reloadCurrent(); renderCurrent(); refresh();
    });
    tagAddBtn.addEventListener('click', async () => { await addTag(tagInput.value.trim()); tagInput.value = ''; });
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tagAddBtn.click(); });

    // ---- add a rare word by hand ----
    const addDetails = panel.createEl('details', { cls: 'pn-hasard-ajout' });
    addDetails.createEl('summary', { text: '+ Add a rare word by hand' });
    const addForm = addDetails.createDiv({ cls: 'pn-hasard-ajout-form' });
    const inWord = addForm.createEl('input', { attr: { type: 'text', placeholder: 'word' } });
    const inNote = addForm.createEl('input', { attr: { type: 'text', placeholder: 'short definition (optional)' } });
    const inTags = addForm.createEl('input', { attr: { type: 'text', placeholder: 'tags, comma-separated (optional)' } });
    const addWordBtn = addForm.createEl('button', { cls: 'pn-link-btn', text: 'Add to my personal dictionary' });
    addWordBtn.addEventListener('click', async () => {
      const w = inWord.value.trim();
      if (!w) { new Notice('A word is required.'); return; }
      const tags = inTags.value.split(',').map((t) => t.trim()).filter(Boolean);
      if (!(await this.plugin.addRareWord(w, inNote.value.trim(), tags))) return;
      inWord.value = ''; inNote.value = ''; inTags.value = '';
      refresh();
    });

    // ---- statistics ----
    const statsDetails = panel.createEl('details', { cls: 'pn-hasard-stats-details' });
    statsDetails.createEl('summary', { text: 'Show statistics' });
    statsDiv = statsDetails.createDiv({ cls: 'pn-hasard-stats' });
    statsDetails.addEventListener('toggle', () => { if (statsDetails.open) renderStats(); });

    refresh();
    draw();
  }

  // ---- Notes tab ----
  // Same structure as the French Notes tab: lists personal-dictionary
  // words that have no note yet (rareWords and vocabularyThemes words),
  // each with an inline field to add one. Built-in themes always carry a
  // note, so only personal entries show up. Refreshed on each tab visit.
  renderNotesTab(panel) {
    const refreshBtn = panel.createEl('button', { cls: 'pn-link-btn', text: '↻ Refresh the list' });

    const rareSection = panel.createDiv({ cls: 'pn-groupe' });
    rareSection.createDiv({ cls: 'pn-son-label', text: 'Rare words without a note' });
    const rareList = rareSection.createDiv({ cls: 'pn-inspi-liste' });

    const themeSection = panel.createDiv({ cls: 'pn-groupe' });
    themeSection.createDiv({ cls: 'pn-son-label', text: 'Theme words without a note' });
    const themeList = themeSection.createDiv({ cls: 'pn-inspi-liste' });

    const dict = () => this.plugin.personalDictionary || {};

    const renderEditRow = (container, word, subText, save) => {
      const row = container.createDiv({ cls: 'pn-inspi-mot' });
      row.createSpan({ cls: 'pn-inspi-terme', text: word });
      if (subText) row.createSpan({ cls: 'pn-inspi-note', text: subText });
      const input = row.createEl('input', { attr: { type: 'text', placeholder: 'note / short definition' } });
      const btn = row.createEl('button', { cls: 'pn-link-btn', text: 'Save' });
      const submit = async () => {
        const note = input.value.trim();
        if (!note) return;
        save(note);
        await this.plugin.savePersonalDictionary();
        new Notice(`Poet's Notebook: note added for "${word}".`);
        row.remove();
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') submit(); });
    };

    const rerender = () => {
      rareList.empty();
      themeList.empty();

      const rare = Array.isArray(dict().rareWords) ? dict().rareWords : [];
      let rareCount = 0;
      rare.forEach((entry, i) => {
        const word = typeof entry === 'string' ? entry : entry && entry.word;
        if (!word || (entry && entry.note)) return;
        rareCount++;
        renderEditRow(rareList, word, '', (note) => {
          if (typeof rare[i] === 'string') rare[i] = { word, note };
          else rare[i].note = note;
        });
      });
      if (rareCount === 0) rareList.createEl('p', { cls: 'pn-vide', text: 'All your rare words have a note.' });

      const themes = Array.isArray(dict().vocabularyThemes) ? dict().vocabularyThemes : [];
      let themeCount = 0;
      themes.forEach((t) => {
        const words = Array.isArray(t && t.words) ? t.words : [];
        words.forEach((entry, i) => {
          const word = typeof entry === 'string' ? entry : entry && entry.word;
          if (!word || (entry && entry.note)) return;
          themeCount++;
          renderEditRow(themeList, word, `(${t.theme || 'untitled theme'})`, (note) => {
            if (typeof words[i] === 'string') words[i] = { word, note };
            else words[i].note = note;
          });
        });
      });
      if (themeCount === 0) themeList.createEl('p', { cls: 'pn-vide', text: 'All words in your personal themes have a note.' });
    };

    rerender();
    refreshBtn.addEventListener('click', rerender);
    this._refreshNotes = rerender;
  }
}

// ============================================================
// MODALS — rhymes / inspiration for a word selected in the editor
// (right-click menu). They reuse the view's rendering methods, which
// only depend on this.plugin. Local data only: no online lookup is
// made from a modal.
// ============================================================
class RhymeModal extends Modal {
  constructor(app, plugin, word) {
    super(app);
    this.plugin = plugin;
    this.word = word;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('poets-notebook-view');
    contentEl.createEl('h3', { text: `Rhymes for "${this.word}"` });
    const results = contentEl.createDiv({ cls: 'pn-resultats' });
    PoetsNotebookView.prototype.renderRhymeResults.call(
      { plugin: this.plugin }, results, this.word, { online: false }
    );
  }
  onClose() { this.contentEl.empty(); }
}

class InspirationModal extends Modal {
  constructor(app, plugin, word) {
    super(app);
    this.plugin = plugin;
    this.word = word;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('poets-notebook-view');
    contentEl.createEl('h3', { text: `Inspiration around "${this.word}"` });
    const results = contentEl.createDiv({ cls: 'pn-resultats' });
    PoetsNotebookView.prototype.renderInspirationResults.call(
      { plugin: this.plugin }, results, this.word, false, null
    );
  }
  onClose() { this.contentEl.empty(); }
}

// Single word from the current selection (trimmed, surrounding
// punctuation stripped), or null if the selection isn't one word.
function singleWordFromSelection(selection) {
  const w = normalizeApostrophes(selection || '').trim()
    .replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
  return w && /^[A-Za-z][A-Za-z'-]*$/.test(w) ? w : null;
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
      .setDesc('Re-scan the vault for cmudict.dict after adding or moving the file. If none is found, it is downloaded from this plugin\'s GitHub release.')
      .addButton((b) => b
        .setButtonText('Reload')
        .onClick(async () => {
          await this.plugin.loadCmudict();
          this.plugin.sonorityBaseline = buildPhonemeFrequencyBaseline(this.plugin.cmudictIndex);
          if (this.plugin.cmudictIndex) {
            new Notice(`CMUdict loaded: ${this.plugin.cmudictIndex.size} words`);
          } else {
            this.plugin._cmudictDownloadFailed = false;
            await this.plugin.fetchCmudictIfMissing();
          }
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

    // Missing data is fetched once, in the background: CMUdict if not in
    // the vault, the published base data if absent or outdated.
    this.app.workspace.onLayoutReady(async () => {
      await this.loadBaseData();
      if (!this.cmudictIndex) await this.fetchCmudictIfMissing();
    });

    // Right-click on a single selected word in the editor.
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      const word = singleWordFromSelection(editor.getSelection());
      if (!word) return;
      menu.addItem((item) => item
        .setTitle(`Rhymes for "${word}"`)
        .setIcon('feather')
        .onClick(() => new RhymeModal(this.app, this, word).open()));
      menu.addItem((item) => item
        .setTitle(`Inspiration around "${word}"`)
        .setIcon('sparkles')
        .onClick(() => new InspirationModal(this.app, this, word).open()));
    }));
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

  async loadBaseData() {
    let base = null;
    try { base = await readLocalBaseData(this.app, this.manifest); }
    catch (e) { console.warn("Poet's Notebook: local base data unreadable", e); }
    if (!base && !this._baseDownloadFailed) {
      try {
        base = await downloadBaseData(this.app, this.manifest);
        new Notice(`Poet's Notebook: base vocabulary installed (${base.themes.length} themes, ${base.rareWords.length} rare words).`);
      } catch (e) {
        this._baseDownloadFailed = true;
        console.warn("Poet's Notebook: base data download failed", e);
      }
    }
    if (!base) return;
    setBaseData(base);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view && leaf.view.render && leaf.view.render());
  }

  // Not found in the vault: download it in the background (one attempt
  // per session), then refresh the open panels.
  async fetchCmudictIfMissing() {
    if (this.cmudictIndex || this._cmudictDownloadFailed || this._cmudictDownloading) return;
    this._cmudictDownloading = true;
    new Notice("Poet's Notebook: downloading CMUdict (about 1 MB, once)…");
    try {
      const { index } = await downloadCmudict(this.app, this.manifest);
      this.cmudictIndex = index;
      this.sonorityBaseline = buildPhonemeFrequencyBaseline(index);
      new Notice(`Poet's Notebook: CMUdict installed (${index.size} words).`);
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view && leaf.view.render && leaf.view.render());
    } catch (e) {
      this._cmudictDownloadFailed = true;
      console.warn("Poet's Notebook: CMUdict download failed", e);
      new Notice("Poet's Notebook: CMUdict could not be downloaded (offline?) — approximate syllable counts for now; next try at the next start.");
    } finally {
      this._cmudictDownloading = false;
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

  // Rare word (Random tab form, Inspiration selection). Updates the note
  // and merges tags if the word is already there. Returns true on success.
  async addRareWord(word, note, tags, opts) {
    const w = (word || '').trim();
    if (!w) return false;
    const d = this.personalDictionary;
    if (!Array.isArray(d.rareWords)) d.rareWords = [];
    const i = d.rareWords.findIndex((e) => normalizeWordKey(typeof e === 'string' ? e : e && e.word) === normalizeWordKey(w));
    if (i >= 0) {
      const e = typeof d.rareWords[i] === 'string' ? { word: d.rareWords[i] } : d.rareWords[i];
      if (note && !e.note) e.note = note;
      d.rareWords[i] = e;
    } else {
      d.rareWords.push(note ? { word: w, note } : { word: w });
    }
    for (const t of (tags || [])) this._ensureWordMetaEntry(w).tags.includes(t) || this._ensureWordMetaEntry(w).tags.push(t);
    const ok = await this.savePersonalDictionary();
    if (!(opts && opts.quiet)) new Notice(ok ? `"${w}" added to your personal dictionary.` : 'Could not save — see console.');
    return ok;
  }

  // Adds words to a personal vocabulary theme, creating it (with the given
  // trigger words) if needed. Returns how many words were new.
  async addThemeWords(theme, triggers, words) {
    const d = this.personalDictionary;
    if (!Array.isArray(d.vocabularyThemes)) d.vocabularyThemes = [];
    let t = d.vocabularyThemes.find((x) => x && (x.theme || '').toLowerCase() === theme.toLowerCase());
    if (!t) {
      t = { theme, triggers: triggers.length ? triggers : [theme.toLowerCase()], words: [] };
      d.vocabularyThemes.push(t);
    } else if (triggers.length) {
      t.triggers = Array.from(new Set([...(t.triggers || []), ...triggers]));
    }
    if (!Array.isArray(t.words)) t.words = [];
    const have = new Set(t.words.map((e) => normalizeWordKey(typeof e === 'string' ? e : e && e.word)));
    let n = 0;
    for (const { word, note } of words) {
      if (have.has(normalizeWordKey(word))) continue;
      t.words.push(note ? { word, note } : { word });
      have.add(normalizeWordKey(word));
      n++;
    }
    await this.savePersonalDictionary();
    return n;
  }

  // Remembers which online sources are ticked, per tab ('rhymes',
  // 'inspiration', 'synonyms'), like the French plugin does.
  async setOnlineSource(kind, on) {
    const set = new Set(this.settings.onlineSources || []);
    if (on) set.add(kind); else set.delete(kind);
    this.settings.onlineSources = [...set];
    await this.saveSettings();
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
