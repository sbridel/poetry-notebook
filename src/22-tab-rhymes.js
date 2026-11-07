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
      const keepItems = (list) => list.filter((r) => sylMatch(r.syllableCount) && posMatch(r.word));
      const perfectItems = f.perfect ? keepItems(local.perfect) : [];
      const nearItems = showNear ? keepItems(local.near) : [];
      const kind = rhymeLengthLabel(local.length);
      if (kind) {
        localBody.createDiv({ cls: 'pn-son-label', text: `"${word}": ${kind} rhyme — ${local.length} syllable${local.length > 1 ? 's' : ''} from the stressed vowel` });
      }
      if (perfectItems.length === 0 && nearItems.length === 0) {
        localBody.createEl('p', { cls: 'pn-vide', text: 'No word matches these filters.' });
      }
      // Identical rhymes (same sound before the stressed vowel: night /
      // knight, light / delight) are kept apart: usually avoided in English.
      makeWordGroup(localBody, 'Perfect rhymes', perfectItems.filter((r) => !r.identical).map((r) => r.word), 'pn-mot', idx);
      const identical = perfectItems.filter((r) => r.identical).map((r) => r.word);
      if (identical.length) {
        const g = makeWordGroup(localBody, 'Identical rhymes — same sound before the vowel, usually avoided', identical, 'pn-mot pn-mot-assonance', idx);
        if (g) g.setAttr('title', 'In English, a rhyme that also repeats the consonant before the stressed vowel (night / knight, light / delight) is felt as weak — the opposite of the French "rime riche".');
      }
      const nearGroup = (title, list, tip) => {
        if (!list.length) return;
        const block = localBody.createDiv({ cls: 'pn-groupe pn-bloc-assonance' });
        block.createDiv({ cls: 'pn-titre pn-label-assonance', text: `${title} (${list.length})` });
        block.setAttr('title', tip);
        const words = block.createDiv({ cls: 'pn-mots' });
        showWithLimit(words, list, (w) => makeWordChip(words, w, 'pn-mot pn-mot-assonance', idx));
      };
      nearGroup('Near rhymes — assonance (same stressed vowel)', nearItems.filter((r) => r.nearType === 'assonance').map((r) => r.word), 'Same stressed vowel, different ending: lake / fate.');
      nearGroup('Near rhymes — consonance (same final consonants)', nearItems.filter((r) => r.nearType !== 'assonance').map((r) => r.word), 'Same final consonants, different vowel: shape / keep.');
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
