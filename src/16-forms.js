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
  if (form.scheme || form.couplets || form.terza || form.ballad) {
    // Identical rhymes (night / knight, or the same word): allowed but weak.
    const poem = analyzePoem(text, cmudictIndex, null, true);
    const nonEmpty = poem.lines.filter((l) => !l.empty);
    const ident = nonEmpty.map((l, i) => (l.identicalWith !== undefined ? i + 1 : 0)).filter(Boolean);
    add('No identical rhymes (same sound before the vowel, or the same word)', ident.length === 0, ident, ident.length ? 'usually felt as weak in English' : '', true);
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
