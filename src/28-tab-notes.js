
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
