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
    });

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
    letterInput.addEventListener('input', doSearch);
    syllSelect.addEventListener('change', doSearch);
    perfectToggle.addEventListener('change', doSearch);
    nearToggle.addEventListener('change', doSearch);
    datamuseToggle.addEventListener('change', async () => {
      await this.plugin.setOnlineSource('rhymes', datamuseToggle.checked);
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

    const localBody = makeSourceBlock(container, `${word} — CMUdict`, true, true);
    const local = idx ? searchLocalRhymes(word, idx, { letter: f.letter, syllables: null }) : null;
    if (!idx) {
      localBody.createEl('p', { cls: 'pn-vide', text: 'CMUdict not loaded — rhyme search needs it. See the banner above.' });
    } else if (!local) {
      localBody.createEl('p', { cls: 'pn-vide', text: `"${word}" wasn't found in CMUdict, so its rhyme sound is unknown. Try another spelling.` });
    } else {
      const perfect = f.perfect ? local.perfect.filter((r) => sylMatch(r.syllableCount)).map((r) => r.word) : [];
      const near = showNear ? local.near.filter((r) => sylMatch(r.syllableCount)).map((r) => r.word) : [];
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
    const status = onlineBody.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
    try {
      const [perfect, near] = await Promise.all([
        f.perfect ? fetchDatamuseRhymes(word, false) : Promise.resolve([]),
        showNear ? fetchDatamuseRhymes(word, true) : Promise.resolve([]),
      ]);
      status.remove();
      const known = new Set(local ? [...local.perfect, ...local.near].map((r) => r.word) : []);
      const keep = (list) => list
        .filter((d) => !known.has(d.word.toLowerCase()) && letterMatch(d.word) && sylMatch(d.numSyllables || 0))
        .map((d) => d.word);
      const extraPerfect = keep(perfect);
      const extraNear = keep(near);
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
    } catch (e) {
      status.setText('Datamuse: search impossible (no connection, site unreachable, or timeout).');
    }
  }
