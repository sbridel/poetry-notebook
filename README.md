# Poet's Notebook

Sibling project to "Carnet du Poète" (French), rebuilt from scratch for English —
not a multilingual extension of the French plugin.

## Status: all 7 tabs implemented

What's implemented:
- Plugin skeleton (tabbed sidebar panel, ribbon icon, command, settings tab)
- CMUdict-based syllable/stress engine, with:
  - offline CMUdict parsing (multi-location vault search, same pattern as the French
    plugin's `dictionnaire-perso.json`: plugin folder → `.obsidian/` → vault root →
    anywhere in the vault)
  - approximate heuristic fallback for words missing from CMUdict
  - optional Datamuse online fallback for syllable counts only (off by default —
    toggle in settings; stress from Datamuse is not reliable enough to use, so those
    words are marked "unknown stress" rather than guessed)
- Meter detection (iambic / trochaic / anapestic / dactylic, named "pentameter",
  "tetrameter", etc.), using a **flexible/rigid syllable model**: monosyllabic words
  can occupy either a strong or weak metrical position (their isolated CMUdict stress
  isn't reliable in context — e.g. "to" carries the beat in "thee TO a summer's day"
  despite being a preposition); only syllables from polysyllabic words are treated as
  a hard constraint, since CMUdict's *relative* stress within a word is reliable
  regardless of surrounding words.
- Rhyme scheme detection (AABB/ABAB/ABBA...) from the last stressed vowel onward,
  with colored badges per rhyme group.
- Rhymes tab: local CMUdict-based search for perfect rhymes (identical stressed
  vowel + everything after) and near/slant rhymes (consonance — same ending
  consonants, different vowel; or assonance — same stressed vowel, different
  ending), grouped by syllable count, near rhymes always in a visually separate
  section (dashed border) unless "Strict rhyme mode" is on in settings. Filters
  by starting letter and syllable count. Optional Datamuse online lookup
  (checkbox, off by default, only queried on explicit search) adds any extra
  matches not already found locally. A "Open in RhymeZone ↗" link opens the
  word's RhymeZone page in the browser for RhymeZone's own advanced filters
  (meter, primary vowel) — deliberately a link rather than a scraper: without
  access to RhymeZone's actual HTML markup there was no way to build and verify
  a scraper against ground truth, so Datamuse's clean JSON API is the online
  source instead.
- Synonyms tab: personal dictionary (`poets-notebook-dictionary.json`, same
  multi-location vault search as CMUdict) shown first; optional Datamuse
  online lookup (checkbox, off by default) shows additional synonyms as
  clickable chips — click one to save it into the personal dictionary. A
  manual "add a synonym" field lets you save anything by hand, Datamuse or
  not.
- Definitions tab: on-demand only (nothing fetched until you search).
  Fetches English Wiktionary via the official `extracts` API (plain text,
  no wikitext templates or HTML to strip), parses out the Etymology section
  and one definition list per part of speech (Noun, Verb, Adjective, etc.),
  skips Pronunciation/Usage notes/Related terms noise. Always shows a
  "View on Wiktionary ↗" link as a fallback. See the caveat below — this
  parser hasn't had a live-network test yet.
- Guide tab: static reference (no network) — meter/foot-name table, perfect
  vs. slant rhyme (consonance/assonance) explained, classic forms (both
  sonnet types, blank verse, villanelle, limerick), and a short note on
  poetic elision pointing back to the Syllables tab's per-word tooltip.

Validated by actually running the code (not just reading it) against the first two
lines of Shakespeare's Sonnet 18 — this caught two real bugs before they shipped:
1. CMUdict keeps apostrophes in words (`SUMMER'S`, not `SUMMERS`) — normalization
   has to match.
2. Naive per-word CMUdict stress fails on real verse, because CMUdict tags every
   monosyllabic word's stress as "1" in isolation. Fixed with the flexible/rigid
   model above.

Known remaining limitation (not a bug, a real linguistic edge case): historical
poetic elision (e.g. Shakespeare treating "temperate" as the 2-syllable "temp'rate")
isn't handled yet. Same family of problem as French `qu'`/`m'` contractions — needs
an explicit elision word list, planned but not built.

- Inspiration tab: type a common word (forest, sea, night, love, time, fire,
  weather, silence…) and get rarer, more literary English vocabulary on the
  same theme, each with a short gloss — ten built-in themes, hand-written for
  English (not translated from the French plugin's, which is curated
  separately for French vocabulary). Optional Datamuse "means like" online
  lookup (checkbox, off by default) adds loosely related words as a bonus.
  Extensible via the personal dictionary's `vocabularyThemes` key (see below).
- Random tab: one button, one rare/literary word pulled from the same pool
  used by Inspiration (built-in themes + anything you've added to the
  personal dictionary, including a dedicated `rareWords` key that isn't tied
  to any theme), with a gloss and one-click links to look it up in
  Definitions or search it in Rhymes.

## Extending Inspiration & Random (`vocabularyThemes` / `rareWords`)

Add either or both of these keys to `poets-notebook-dictionary.json` (same file,
same multi-location search, as the `synonyms` key above):

```json
{
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

`triggers` are the everyday words that surface the theme in the Inspiration tab
(matched case-insensitively, with simple plural stripping — "mountains" and
"mountain" both work). Everything under `vocabularyThemes` also feeds the
Random tab's word pool automatically; `rareWords` is for standalone words you
want in Random without building a whole theme around them (shown with theme
"Personal dictionary").
Unlike CMUdict and the RhymeZone/Datamuse rhyme code, the Wiktionary parser
in this build was **not tested against a live fetch** — the Wiktionary API
domain wasn't reachable from the sandbox this plugin was built in. The
parsing logic is written against real documented examples of the API's
plain-text output format (confirmed section-header format:
`== English ==` / `=== Etymology ===` / `=== Noun ===`), and a synthetic
extract built from those examples parses correctly (see git history /
conversation), but this still needs a first real check once used inside
Obsidian with actual network access. If definitions come back empty or
garbled for a word that clearly has a Wiktionary entry, that's the first
thing to look at — the "View on Wiktionary ↗" link next to the results is
there specifically as a fallback for this.

Letter-level syllable splitting within a word (e.g. showing "com·pare" rather than
just "compare(2)") is not implemented — CMUdict gives phoneme counts, not letter
boundaries, so this needs a separate syllabification step if wanted.

## Installing CMUdict (required for full accuracy; the plugin works without it,
just less precisely)

1. Download `cmudict.dict` from the official repo:
   https://github.com/cmusphinx/cmudict (the file `cmudict.dict` at the repo root).
2. Place it in your vault at **one** of:
   - `<vault>/.obsidian/plugins/poets-notebook/cmudict.dict` (won't survive a BRAT
     resync if BRAT only tracks main.js/manifest.json/styles.css — prefer one of
     the options below for durability)
   - `<vault>/.obsidian/cmudict.dict`
   - `<vault>/cmudict.dict` (vault root)
   - anywhere else in the vault — the plugin does a recursive filename search as a
     last resort
3. Open Poet's Notebook → Settings → "Reload CMUdict", or just reopen the panel.

License: CMUdict is public domain / unrestricted for research and commercial use.

## Extending your personal dictionary (`poets-notebook-dictionary.json`)

The Synonyms tab's "Save to my dictionary" button writes to this file automatically, but you
can also create or edit it by hand — useful for bulk-importing a synonym list, or adding entries
the Datamuse lookup doesn't surface.

### Where the plugin looks for it

Same search order as `cmudict.dict`, stopping at the first match:

1. The plugin's own folder (`.obsidian/plugins/poets-notebook/`).
2. The root of `.obsidian`.
3. The root of the vault itself.
4. Anywhere else in the vault — the simplest option on mobile or with BRAT: just drop the file
   in like any other note attachment.

If no file is found anywhere, the first save from the Synonyms tab creates a new one at the
vault root. You can override the path explicitly in Settings → Poet's Notebook → "Custom
personal dictionary path", and re-scan at any time with the "Reload personal dictionary" button
(no restart needed) — mirrors the equivalent CMUdict controls right above it.

### Format

```json
{
  "synonyms": {
    "happy": ["joyful", "glad", "content", "cheerful"],
    "sad": ["sorrowful", "downcast", "melancholy"]
  }
}
```

A flat object: each key is a word (lowercase; the plugin lowercases on lookup regardless of how
you type it), each value is an array of its synonyms. This `synonyms` key is what the Synonyms
tab reads and writes. The same file also supports `vocabularyThemes` and `rareWords` for the
Inspiration and Random tabs — see "Extending Inspiration & Random" above for their format; all
three keys can live in the same `poets-notebook-dictionary.json` together. The one thing still
missing is a French-style `familles`/complete-phonetic-dictionary equivalent for the Rhymes
tab — there's no personal-dictionary override for rhyme search yet, only CMUdict/Datamuse.

A word can't be saved as its own synonym through the UI — the plugin blocks that on add. If you
hand-edit the file and add one by mistake, nothing validates it on load; it'll just sit there
harmlessly (delete it directly in the JSON, or add it and remove it once from the Synonyms tab
to trigger the same cleanup the UI's × button does).

## Next steps (suggested order)
All 7 tabs are built. What's still genuinely untested or thin:
1. **Definitions tab (Wiktionary)** — the one piece of this whole plugin never
   validated against a live network call (see the caveat above). Test it on a
   handful of real words first.
2. **Inspiration's built-in vocabulary** — ten themes, hand-written, not
   exhaustive. Expect gaps; the personal dictionary's `vocabularyThemes` is the
   intended way to fill them in as you notice them, same as `dictionnaire-perso.json`
   in the French plugin.
3. **Near-rhyme definition** — currently consonance OR assonance (see the
   Rhymes tab conversation). Worth revisiting once you've used it on real drafts
   to see if it's too loose or too strict.
4. **Poetic elision list** — currently only the `-'d` → `-ed` pattern
   (plann'd, belov'd). Other archaic forms (o'er, 'twas, e'er) aren't
   normalized yet; add them to the elision fallback in `main.js` as they come up.
5. Letter-level syllable splitting within a word (e.g. "com·pare") is still not
   implemented — would need an actual syllabification step beyond CMUdict's
   phoneme counts, noted as a gap since the first version of this README.
   
## Changelog

- **1.0.0** — Initial release