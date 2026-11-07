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
