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

