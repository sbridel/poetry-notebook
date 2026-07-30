# Poetry Notebook

An Obsidian plugin for writing and revising English poetry: syllable and meter
analysis, rhyme search, synonyms and antonyms, definitions, thematic
vocabulary, and a quick-reference guide — all in a tabbed sidebar panel.

Sibling project to the French plugin "Carnet du Poète," built independently
for English rather than as a translation or extension of it.

## Features

### Syllables
Paste a poem and get, per line: a syllable count, meter (iambic / trochaic /
anapestic / dactylic, named "pentameter," "tetrameter," etc.), and a rhyme
scheme with colored badges. Analysis updates live as you type.

Syllable and stress data comes primarily from CMUdict (see below), with:
- an approximate heuristic fallback for words missing from CMUdict,
- an optional Datamuse online fallback for syllable counts only (off by
  default, toggled in Settings),
- a small built-in override list for common words CMUdict lists with a more
  formal syllable count than natural speech uses (e.g. "our," "fire"),
- automatic handling of the archaic `-'d` elision (e.g. "plann'd" → "planned").

Hover any line to see a per-word breakdown, including which source
(CMUdict / override / heuristic / Datamuse) each word's syllable count
came from.

### Rhymes
Search CMUdict for perfect rhymes (matching stressed vowel and everything
after it) and near/slant rhymes (consonance or assonance), grouped by
syllable count. Near rhymes are always shown in a separate section unless
"Strict rhyme mode" is on in Settings. Filter by starting letter or syllable
count. An optional Datamuse online lookup (off by default) adds any extra
matches; a link opens the word's RhymeZone page in your browser for
RhymeZone's own advanced filters.

### Synonyms & Antonyms
Look up a word against your personal dictionary, with an optional Datamuse
online lookup (off by default) shown as clickable chips — click one to save
it. You can also add entries by hand. Saved entries can be removed with the
× button.

### Definitions
On-demand lookup (nothing is fetched until you search) against English
Wiktionary: etymology and definitions grouped by part of speech. A "View on
Wiktionary ↗" link is always shown alongside the parsed result.

### Inspiration
Type a common word (forest, sea, night, love, time, fire, weather,
silence…) to get rarer, more literary vocabulary on the same theme, each
with a short gloss. Ten built-in themes are included. An optional Datamuse
"means like" online lookup (off by default) adds loosely related words.

### Random
One button, one rare/literary word drawn from the same vocabulary pool used
by Inspiration, with a gloss and quick links to look it up in Definitions or
search it in Rhymes.

### Guide
A static reference: meter and foot names, perfect vs. slant rhyme, classic
poem forms (Shakespearean and Petrarchan sonnets, blank verse, villanelle,
limerick), and a short note on poetic elision.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into a new folder at
   `<vault>/.obsidian/plugins/poets-notebook/`.
2. In Obsidian, go to Settings → Community plugins, and enable "Poet's
   Notebook."
3. Open it from the ribbon icon (feather) or the command palette ("Open
   Poet's Notebook").

## Setting up CMUdict

The plugin works without CMUdict, using an approximate heuristic instead,
but CMUdict gives much more accurate syllable counts, stress, meter, and
rhyme detection.

1. Download `cmudict.dict` from the official repository:
   https://github.com/cmusphinx/cmudict
2. Place it in your vault at any of the following (checked in this order):
   - `<vault>/.obsidian/plugins/poets-notebook/cmudict.dict`
   - `<vault>/.obsidian/cmudict.dict`
   - `<vault>/cmudict.dict` (vault root)
   - anywhere else in the vault — the plugin falls back to a recursive
     filename search
3. In Settings → Poet's Notebook, click "Reload CMUdict" (or just reopen the
   panel).

CMUdict is public domain / unrestricted for research and commercial use.

## Personal dictionary

The Synonyms tab writes to `poets-notebook-dictionary.json` automatically,
but you can also create or edit this file by hand — for bulk-importing
vocabulary, or adding entries no online lookup surfaces.

**Where it's stored:** same search order as `cmudict.dict` above. If no file
is found anywhere in the vault, the first save creates one at the vault
root. Override the path in Settings → Poet's Notebook → "Custom personal
dictionary path," and re-scan at any time with "Reload personal dictionary."

**Format:**

```json
{
  "synonyms": {
    "happy": ["joyful", "glad", "content", "cheerful"]
  },
  "antonyms": {
    "happy": ["sad", "miserable"]
  },
  "vocabularyThemes": [
    {
      "theme": "Mountains",
      "triggers": ["mountain", "mountains", "peak"],
      "words": [
        { "word": "crag", "note": "a steep, rugged rock or cliff" },
        { "word": "escarpment", "note": "a long, steep slope at the edge of a plateau" }
      ]
    }
  ],
  "rareWords": [
    { "word": "petrichor", "note": "the smell of rain on dry earth" }
  ]
}
```

All four top-level keys are optional and can be combined in the same file:
- `synonyms` / `antonyms` — each key is a word (matched case-insensitively),
  each value an array of related words. Read and written by the Synonyms tab.
- `vocabularyThemes` — extends the Inspiration tab. `triggers` are the
  everyday words that surface the theme (matched case-insensitively, with
  simple plural stripping). Also feeds the Random tab's word pool.
- `rareWords` — standalone words for the Random tab's pool without building
  a full theme around them (shown with theme "Personal dictionary").

A word cannot be saved as its own synonym or antonym through the UI.

## Settings

- **Allow Datamuse online lookups** — enables the Datamuse fallback used for
  syllable counts on the Syllables tab when a word is missing from CMUdict.
- **Strict rhyme mode** — hides near/slant rhymes everywhere, showing only
  perfect rhymes.
- **Custom CMUdict path** / **Reload CMUdict**
- **Custom personal dictionary path** / **Reload personal dictionary**

## Known limitations

- The Wiktionary definitions parser may come back empty or malformed for a word that
  clearly has a Wiktionary entry, use the "View on Wiktionary ↗" link in that case.
- Near-rhyme matching covers consonance and assonance only.
- Poetic elision handling currently covers the `-'d` → `-ed` pattern (e.g.
  "plann'd," "belov'd"); other archaic contractions (o'er, 'twas, e'er) are
  not yet normalized.
- No letter-level syllable splitting within a word — syllable counts are
  available, not syllable boundaries.
- Inspiration's built-in vocabulary covers ten themes; extend it via the
  personal dictionary's `vocabularyThemes` as needed.
- No personal-dictionary override for rhyme search yet — only CMUdict and
  Datamuse.

## Changelog

- **1.0.2** — correction of readme.  Added Antonyms (Datamuse `rel_ant` plus a personal-dictionary
  `antonyms` key), alongside Synonyms.
- **1.0.1** — small corrections
- **1.0.0** — Initial release: Syllables, Rhymes, Synonyms, Definitions,
  Guide, Inspiration, and Random tabs; CMUdict-based syllable/stress/meter
  engine; personal dictionary support.
