
  // ---- Notes tab ----
  // Lists personal-dictionary words that have no note yet (rareWords and
  // vocabularyThemes words), each with an inline field to add one.
  // Built-in themes always carry a note, so only personal entries show up.
  // Mirrors the French plugin's Notes tab.
  renderNotesTab(body) {
    const wrap = body.createDiv({ cls: 'pn-notes-tab' });
    const refreshBtn = wrap.createEl('button', { cls: 'pn-icon-btn', text: '↻ Refresh list' });

    const rareSection = wrap.createDiv({ cls: 'pn-rhyme-section' });
    rareSection.createEl('h4', { text: 'Rare words without a note' });
    const rareList = rareSection.createDiv({ cls: 'pn-notes-list' });

    const themeSection = wrap.createDiv({ cls: 'pn-rhyme-section' });
    themeSection.createEl('h4', { text: 'Theme words without a note' });
    const themeList = themeSection.createDiv({ cls: 'pn-notes-list' });

    const dict = () => this.plugin.personalDictionary || {};

    const renderEditRow = (container, word, subText, save) => {
      const row = container.createDiv({ cls: 'pn-notes-row' });
      row.createEl('strong', { text: word });
      if (subText) row.createSpan({ cls: 'pn-notes-sub', text: subText });
      const input = row.createEl('input', {
        cls: 'pn-notes-input',
        attr: { type: 'text', placeholder: 'note / short definition' },
      });
      const btn = row.createEl('button', { text: 'Save' });
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
      if (rareCount === 0) rareList.createDiv({ cls: 'pn-placeholder', text: 'All your rare words have a note.' });

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
      if (themeCount === 0) themeList.createDiv({ cls: 'pn-placeholder', text: 'All words in your personal themes have a note.' });
    };

    rerender();
    refreshBtn.addEventListener('click', rerender);
  }
