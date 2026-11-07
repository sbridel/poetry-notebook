  // ---- Definitions tab ----
  renderDefinitionsTab(body) {
    const wrap = body.createDiv({ cls: 'pn-definitions-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Look up', cls: 'mod-cta' });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      results.empty();
      const loading = results.createDiv({ cls: 'pn-rhyme-loading', text: 'Looking up Wiktionary…' });

      let entry = null;
      try {
        entry = await fetchWiktionaryEntry(word);
      } catch (e) {
        loading.setText('Wiktionary request failed (offline, or the API is unavailable).');
        return;
      }
      loading.remove();

      const link = results.createEl('a', {
        cls: 'pn-external-link', text: `View "${word}" on Wiktionary ↗`, attr: { href: '#' },
      });
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        window.open(`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`, '_blank');
      });

      if (!entry) {
        results.createDiv({ text: `No English entry found for "${word}" on Wiktionary.` });
        return;
      }

      if (entry.etymology) {
        const etySection = results.createDiv({ cls: 'pn-rhyme-section pn-etymology' });
        etySection.createEl('h4', { text: 'Etymology' });
        etySection.createDiv({ text: entry.etymology });
      }

      if (entry.definitions.length === 0) {
        results.createDiv({ text: 'No definitions parsed for this word — the Wiktionary page may use an unusual layout. Use the link above to read it directly.' });
      }

      for (const group of entry.definitions) {
        const section = results.createDiv({ cls: 'pn-rhyme-section pn-definition-group' });
        section.createEl('h4', { text: group.pos });
        const numbered = group.lines.filter((l) => /^\d+\.\s/.test(l));
        const toShow = numbered.length > 0 ? numbered : group.lines;
        const list = section.createEl('ol', { cls: 'pn-definition-list' });
        for (const line of toShow) {
          list.createEl('li', { text: line.replace(/^\d+\.\s*/, '') });
        }
      }
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

