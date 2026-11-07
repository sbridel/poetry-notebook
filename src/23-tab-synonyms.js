  // ---- Synonyms tab ----
  renderSynonymsTab(body) {
    const wrap = body.createDiv({ cls: 'pn-synonyms-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online)');

    const synPanel = this.buildRelationPanel(wrap, {
      kind: 'synonyms',
      label: 'Synonym',
      fetchOnline: fetchDatamuseSynonyms,
      addToDict: (w, s) => this.plugin.addSynonymToPersonalDictionary(w, s),
      removeFromDict: (w, s) => this.plugin.removeSynonymFromPersonalDictionary(w, s),
    });
    const antPanel = this.buildRelationPanel(wrap, {
      kind: 'antonyms',
      label: 'Antonym',
      fetchOnline: fetchDatamuseAntonyms,
      addToDict: (w, s) => this.plugin.addAntonymToPersonalDictionary(w, s),
      removeFromDict: (w, s) => this.plugin.removeAntonymFromPersonalDictionary(w, s),
    });

    const doSearch = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      await Promise.all([
        synPanel.search(word, datamuseCheckbox.checked),
        antPanel.search(word, datamuseCheckbox.checked),
      ]);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  // Builds one Synonyms- or Antonyms-shaped panel: a manual add row plus a
  // results area (personal dictionary list with remove buttons, and an
  // optional Datamuse section). `opts.kind` is the personal-dictionary key
  // ('synonyms' or 'antonyms'). Returns { search(word, includeOnline) }.
  buildRelationPanel(wrap, opts) {
    wrap.createEl('h4', { cls: 'pn-relation-panel-title', text: opts.label + 's' });

    const addRow = wrap.createDiv({ cls: 'pn-synonym-add-row' });
    const addLabel = addRow.createSpan({ cls: 'pn-synonym-add-label', text: `${opts.label} for “…”:` });
    const addInput = addRow.createEl('input', { cls: 'pn-rhyme-input', attr: { type: 'text' } });
    const addBtn = addRow.createEl('button', { text: 'Save to my dictionary' });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });
    let currentWord = '';

    const renderPersonalSection = () => {
      const key = currentWord.toLowerCase().trim();
      const dict = this.plugin.personalDictionary[opts.kind] || {};
      const list = dict[key] || [];
      let section = results.querySelector('.pn-synonym-personal');
      if (!section) {
        section = results.createDiv({ cls: 'pn-rhyme-section pn-synonym-personal' });
        results.prepend(section);
      }
      section.empty();
      section.createEl('h4', { text: `My dictionary (${list.length})` });
      if (list.length === 0) {
        section.createDiv({ cls: 'pn-rhyme-word-list', text: `No ${opts.label.toLowerCase()}s saved for this word yet.` });
      } else {
        const listEl = section.createDiv({ cls: 'pn-rhyme-word-list' });
        list.forEach((s) => {
          const chip = listEl.createSpan({ cls: 'pn-synonym-chip pn-synonym-chip-saved' });
          chip.appendText(s + ' ');
          const removeBtn = chip.createEl('span', { cls: 'pn-synonym-remove', text: '×' });
          removeBtn.addEventListener('click', async () => {
            await opts.removeFromDict(currentWord, s);
            renderPersonalSection();
          });
        });
      }
    };

    const search = async (word, includeOnline) => {
      currentWord = word;
      addLabel.setText(`${opts.label} for “${word}”:`);
      results.empty();
      renderPersonalSection();

      if (includeOnline) {
        const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
        try {
          const found = await opts.fetchOnline(word);
          loading.remove();
          const personalSet = new Set(((this.plugin.personalDictionary[opts.kind] || {})[word.toLowerCase()]) || []);
          const extra = found.filter((s) => !personalSet.has(s.toLowerCase()) && s.toLowerCase() !== word.toLowerCase());
          const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-online' });
          section.createEl('h4', { text: `Online — Datamuse (${extra.length})` });
          const list = section.createDiv({ cls: 'pn-rhyme-word-list' });
          if (extra.length === 0) {
            list.setText(`No additional ${opts.label.toLowerCase()}s found.`);
          } else {
            extra.forEach((s, i) => {
              const btn = list.createEl('button', { cls: 'pn-synonym-chip', text: s });
              btn.setAttr('title', `Click to save "${s}" into your personal dictionary`);
              btn.addEventListener('click', async () => {
                const res = await opts.addToDict(word, s);
                new Notice(res.ok ? `Saved "${s}" to your dictionary` : 'Could not save — see console');
                if (res.ok) renderPersonalSection();
              });
              if (i < extra.length - 1) list.appendText(' ');
            });
          }
        } catch (e) {
          loading.setText('Datamuse request failed (offline, or the API is unavailable).');
        }
      }
    };

    addBtn.addEventListener('click', async () => {
      const value = addInput.value.trim();
      if (!currentWord) { new Notice('Search a word first — the manual field only adds an entry FOR that word.'); return; }
      if (!value) { new Notice(`Type the ${opts.label.toLowerCase()} to save.`); return; }
      const res = await opts.addToDict(currentWord, value);
      if (!res.ok && res.reason === 'self') {
        new Notice(`"${value}" is the same as "${currentWord}" — a word can't be its own ${opts.label.toLowerCase()}.`);
        return;
      }
      new Notice(res.ok ? `Saved "${value}" to your dictionary` : 'Could not save — see console');
      if (res.ok) { addInput.value = ''; renderPersonalSection(); }
    });

    return { search };
  }

