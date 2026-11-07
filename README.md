# Poetry Notebook

An Obsidian plugin for writing and revising English poetry: syllable and meter
analysis, rhyme search, synonyms and antonyms, definitions, thematic
vocabulary, an experimental sound-pattern analyzer, and a quick-reference
guide — all in a tabbed sidebar panel.

Sibling project to the French plugin "Carnet du Poète," built independently
for English rather than as a translation or extension of it.

## Sommaire

- [Features](#features)
- [Sonorities (experimental)](#sonorities-experimental)
- [Installation](#installation)
- [Setting up CMUdict](#setting-up-cmudict)
- [Personal dictionary](#personal-dictionary)
- [Settings](#settings)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Changelog](#changelog)

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

Flip the card ("🔄 Sonorities" button, top-left) to switch to the sound-pattern
panel described below.

Above the draft, the action bar offers **Export** (copies the analysis as a
Markdown table), **Copy**, **Active note** (loads the selection in the open
note, else its first ```` ```poem ```` block, else the whole note, with
frontmatter and Markdown syntax stripped) and **Clear**. Each line shows its
rhyme letter, its meter spelled out ("iambic trimeter") and its syllable
count. Stanzas are separated by blank lines: below the lines, one row per
stanza gives its rhyme scheme and names the common ones (couplets AABB, cross
rhyme ABAB, enclosed rhyme ABBA). **Continuous rhymes across stanzas** (on by
default) carries the letters on from one stanza to the next; off, each stanza
restarts at A.

The **Form** menu (Syllables tab) checks the poem against a fixed form —
Shakespearean, Petrarchan or Spenserian sonnet, villanelle, limerick, haiku,
heroic couplets, blank verse, terza rima, ballad stanza — with a checklist
above the analysis: ✓ rule met, ✗ rule broken, ⚠ point to check (things the
engine can only estimate: stress-based meter, a syllable count one off, a
rhyme only on the last unstressed syllable, refrains with changed wording).
Line numbers in the checklist open the Rhymes tab on that line's last word.
A `form:` property in a note (e.g. `form: villanelle`) sets the menu when the
note is loaded with **Active note**.

### Rhymes
Search CMUdict for perfect rhymes (matching stressed vowel and everything
after it) and near/slant rhymes (consonance or assonance), grouped by
syllable count. Near rhymes are always shown in a separate section unless
"Strict rhyme mode" is on in Settings. Filter by starting letter, syllable
count or part of speech (noun, verb, adjective, adverb — needs Datamuse,
since CMUdict has no part of speech; words whose part of speech is unknown
are always kept). An optional Datamuse online lookup (off by default) adds any extra
matches; a link opens the word's RhymeZone page in your browser for
RhymeZone's own advanced filters.

### Synonyms & Antonyms
Look up a word against your personal dictionary, with an optional Datamuse
online lookup (off by default) shown as clickable chips — click one to save
it. You can also add entries by hand. Saved entries can be removed with the
× button.

### Definitions
On-demand lookup (nothing is fetched until you search), with two sources
switched by pills, like the French plugin's dictionaries: the **Free
Dictionary API** (dictionaryapi.dev, built on Wiktionary — pronunciation,
definitions with examples, synonyms/antonyms per part of speech), tried
first, and the **English Wiktionary** page itself (etymology and definitions),
used automatically when the first has no entry. An "Open on Wiktionary ↗"
link is always available.

### Inspiration
Type a common word (forest, sea, night, love, time, fire, weather,
silence…) to get rarer, more literary vocabulary on the same theme, each
with a short gloss. Ten built-in themes are included. An optional Datamuse
"means like" online lookup (off by default) adds loosely related words.

### Random
Draw a random rare/literary word from the same vocabulary pool used by
Inspiration, with a gloss and quick links to look it up in Definitions or
search it in Rhymes.

Every word — built-in or from your personal dictionary — can also carry your
own custom tags on top of its theme, be marked **♥ liked**, or **🚫 excluded**
from future draws. Tagging or excluding a built-in word never touches its
definition; it's tracked separately. Filter the draw pool by included tags
(switch between matching *any* or *all* of several at once), excluded tags,
a "liked only" quick filter, or a "review excluded" mode to revisit what
you've set aside — with a live count of how many words match the current
filters.

### Layout
Every tab follows the same layout as the French sibling plugin, Carnet du
Poète: framed filter boxes, a "complete online" box whose ticked sources are
remembered, and results in collapsible blocks, one per source (personal or
built-in data first, then each online source). Online word lists can be
clicked to leave a word out before saving them to your personal dictionary.
In Synonyms, Datamuse results carry a relevance (Datamuse's score rescaled to
0-100 against the best match): a threshold (All / 30% / 60% / 85%) hides the
weaker ones, and strong matches (70+) are shown in bold. In Inspiration, the
Datamuse block also gives collocations — adjectives often used with the word,
nouns it often qualifies, and words often found near it.
In Inspiration, clicking words builds a selection (kept across searches)
that can be added to a personal theme or as rare words.

### Notes
Lists the words in your personal dictionary that have no note yet —
`rareWords` and the words of your own `vocabularyThemes` — each with an
inline field to add a short definition, saved straight to the dictionary
file. Built-in themes always carry a note, so they never show up here.

### Right-click on a word
Select a single word in the editor and right-click: **Rhymes for "…"**
and **Inspiration around "…"** open the matching results in a pop-up,
without leaving your note. Pop-ups use local data only (CMUdict and the
vocabulary themes); no online lookup is made from them.

### Guide
A static reference: meter and foot names, perfect vs. slant rhyme, classic
poem forms (Shakespearean and Petrarchan sonnets, blank verse, villanelle,
limerick), and a short note on poetic elision.

## Sonorities (experimental)

A flip side of the Syllables tab's card: four sound patterns across the
*whole* poem, not just line endings.

- **Alliteration** — a consonant sound repeated at the start of nearby words.
- **Consonant web** — a consonant sound that recurs anywhere in a word
  (attack, middle, or coda), not just at the start. Click a sound in its
  list to spotlight only its occurrences in the draft, dimming the rest.
- **Internal assonance** — a vowel sound that recurs inside nearby words,
  aside from end-of-line rhyme.
- **Echo endings** — word endings that echo each other mid-line, not just
  the established end-of-line rhyme (reuses the same rhyme-key logic as the
  Rhymes tab, applied to every word instead of just line-final ones).

Three grouping levels — exact ARPAbet sounds, simplified families, extended
families with a voiced/voiceless split — each sound shown with a frequency
ratio ("×N.N") comparing how often it occurs in *this* poem against its
normal frequency in English, computed live from the loaded CMUdict index
(no external citation needed for this — unlike the French sibling plugin,
which has to lean on an older published study for lack of a better source).

**Why "experimental":** newer and less battle-tested than the rest of this
plugin. Detection relies entirely on CMUdict's phoneme data — a word missing
from CMUdict is skipped for Sonorities rather than guessed at from spelling,
since English spelling-to-sound is too irregular to approximate safely the
way this plugin's heuristic fallback does for basic syllable counts.
Highlighting also colors the whole word rather than a precise letter range:
CMUdict gives a word's phoneme identity, not a mapping back to letter
positions, so there's no reliable way to know which letters correspond to a
given sound the way the French plugin's orthographic scan can.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into a new folder at
   `<vault>/.obsidian/plugins/poetry-notebook/`.
2. In Obsidian, go to Settings → Community plugins, and enable "Poet's
   Notebook."
3. Open it from the ribbon icon (feather) or the command palette ("Open
   Poet's Notebook").

## Setting up CMUdict

The plugin works without CMUdict, using an approximate heuristic instead,
but CMUdict gives much more accurate syllable counts, stress, meter, and
rhyme detection — and is required for Sonorities.

1. Download `cmudict.dict` from the official repository:
   https://github.com/cmusphinx/cmudict
2. Place it in your vault at any of the following (checked in this order):
   - `<vault>/.obsidian/plugins/poetry-notebook/cmudict.dict`
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
  ],
  "wordMeta": {
    "petrichor": { "tags": ["favorite-sound"], "liked": true, "excluded": false }
  }
}
```

All five top-level keys are optional and can be combined in the same file:
- `synonyms` / `antonyms` — each key is a word (matched case-insensitively),
  each value an array of related words. Read and written by the Synonyms tab.
- `vocabularyThemes` — extends the Inspiration tab. `triggers` are the
  everyday words that surface the theme (matched case-insensitively, with
  simple plural stripping). Also feeds the Random tab's word pool.
- `rareWords` — standalone words for the Random tab's pool without building
  a full theme around them (shown with theme "Personal dictionary").
- `wordMeta` — per-word tags/liked/excluded state for the Random tab,
  applying to built-in words too. Written automatically by the Random tab's
  controls; editing it by hand is possible but not required for normal use.

A word cannot be saved as its own synonym or antonym through the UI.

## Settings

- **Allow Datamuse online lookups** — enables the Datamuse fallback used for
  syllable counts on the Syllables tab when a word is missing from CMUdict.
- **Strict rhyme mode** — hides near/slant rhymes everywhere, showing only
  perfect rhymes.
- **Custom CMUdict path** / **Reload CMUdict**
- **Custom personal dictionary path** / **Reload personal dictionary**
- **Rhyme colors** — toggled from the Syllables tab itself (Structure face),
  not the Settings page: colors the rhyme-scheme badges by group.

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
- Sonorities is experimental: CMUdict-only (no spelling-based fallback),
  and highlights whole words rather than precise letter ranges — see the
  [Sonorities](#sonorities-experimental) section above for why.

## Development

The source lives in `src/` as numbered files (engine, data, one file per
tab, settings, plugin), assembled into `main.js` by plain concatenation:

```
node build.js
```

Edit the files in `src/`, never `main.js` directly. `styles.css` stays at
the repository root; its first section is generated from Carnet du Poète's
stylesheet with the `cp-` prefix renamed `pn-` (the command is in the file's
header), so both plugins share one look without their classes colliding. A GitHub workflow (`.github/workflows/release.yml`)
publishes a release automatically when a push to `main` carries a
`manifest.json` version that has no tag yet, using that version's entry
in the changelog below as release notes.

## Changelog

- **1.4.0** — New **Form** menu in the Syllables tab: checks the poem against a
  fixed form (Shakespearean / Petrarchan / Spenserian sonnet, villanelle,
  limerick, haiku, heroic couplets, blank verse, terza rima, ballad stanza)
  with a ✓ / ✗ / ⚠ checklist and clickable line numbers; a `form:` note
  property sets it. Rhymes: part-of-speech filter (via Datamuse). Small
  spacing fix under the online-sources row.
- **1.3.1** — CSS lint fixes requested by Obsidian's plugin review: no more
  `!important` (more specific selectors instead) and no more `:has()` (toggle
  pills get an `is-checked` class from the code instead). Same look. README:
  install folder corrected to `.obsidian/plugins/poetry-notebook/` (the
  plugin id).
- **1.3.0** — Layout and styles aligned with the French sibling plugin, Carnet du
  Poète, across all tabs (title, persistent tabs, framed filters, collapsible
  per-source results, word chips with syllable counts). Syllables: Export and
  Active note buttons, meter spelled out, per-stanza rhyme schemes with names,
  continuous-rhymes toggle. Definitions: Free Dictionary API first, Wiktionary
  as fallback. Inspiration: Datamuse collocations, word selection added to a
  theme or as rare words. Synonyms: relevance threshold, "rhymes with" and
  syllable filters. Random: quick-draw shortcuts, collapsible tag filters, tag
  presets, manual add, statistics. Ticked online sources are remembered.
- **1.2.0** — New **Notes** tab: personal-dictionary words without a note
  (rare words and personal theme words), each with an inline field to add one.
  Right-click a single selected word in the editor for **Rhymes** or
  **Inspiration** in a pop-up (local data only). Source split into `src/`
  and assembled by `node build.js`; automatic GitHub release on push to `main`.
- **1.1.0** — New experimental **Sonorities** panel on the flip side of the Syllables tab's
  card: alliteration, consonant web, internal assonance, echo endings, with a live
  frequency-ratio badge per sound (see above). Random tab: words (built-in or personal) can now
  be tagged, liked, or excluded from the draw, with matching include/exclude filters. Ergonomics
  pass: checkboxes became pill-style toggles, secondary actions (Copy/Clear draft) became icon
  buttons, and the Syllables tab's action row moved above the textarea to match the French
  sibling plugin's layout. Fixed: several Sonorities palette colors had insufficient contrast
  with their white highlight text (as low as 2.54:1 against a 4.5:1 threshold) — darkened; and
  "Rhyme colors" was showing on both flip-card faces instead of just Structure.
- **1.0.2** — correction of readme.  Added Antonyms (Datamuse `rel_ant` plus a personal-dictionary
  `antonyms` key), alongside Synonyms.
- **1.0.1** — small corrections
- **1.0.0** — Initial release: Syllables, Rhymes, Synonyms, Definitions,
  Guide, Inspiration, and Random tabs; CMUdict-based syllable/stress/meter
  engine; personal dictionary support.
