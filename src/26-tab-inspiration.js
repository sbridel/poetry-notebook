  // ---- Inspiration tab ----
  renderInspirationTab(body) {
    const wrap = body.createDiv({ cls: 'pn-inspiration-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'A common word (forest, sea, night, love…)' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online, "means like")');

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = () => {
      const word = wordInput.value.trim();
      if (!word) return;
      this.renderInspirationResults(results, word, datamuseCheckbox.checked);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  // Shared by the Inspiration tab and the Inspiration modal (editor
  // right-click on a selection). Uses only this.plugin.
  async renderInspirationResults(results, word, includeDatamuse) {
    results.empty();

    const themes = findInspiration(word, this.plugin.personalDictionary);
    if (themes.length === 0) {
      results.createDiv({ text: `No built-in theme is triggered by "${word}" yet. Try a broader word (forest, sea, night, love, time, fire, weather, silence…), or add your own theme to the personal dictionary.` });
    } else {
      for (const t of themes) {
        const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-perfect' });
        section.createEl('h4', { text: `${t.theme} (${t.words.length})` });
        const list = section.createEl('div', { cls: 'pn-inspiration-word-grid' });
        for (const w of t.words) {
          const item = list.createDiv({ cls: 'pn-inspiration-word' });
          item.createEl('strong', { text: w.word });
          item.createSpan({ text: ' — ' + w.note });
        }
      }
    }

    if (includeDatamuse) {
      const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
      try {
        const related = await fetchDatamuseMeansLike(word);
        loading.remove();
        const section = results.createDiv({ cls: 'pn-rhyme-section pn-rhyme-online' });
        section.createEl('h4', { text: `Online — Datamuse, related to "${word}" (${related.length})` });
        section.createDiv({ cls: 'pn-rhyme-word-list', text: related.length ? related.join(', ') : 'Nothing found.' });
      } catch (e) {
        loading.setText('Datamuse request failed (offline, or the API is unavailable).');
      }
    }
  }
