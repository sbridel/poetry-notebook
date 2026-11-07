  renderRhymesTab(body) {
    const wrap = body.createDiv({ cls: 'pn-rhymes-tab' });

    const searchRow = wrap.createDiv({ cls: 'pn-rhyme-search-row' });
    const wordInput = searchRow.createEl('input', {
      cls: 'pn-rhyme-input',
      attr: { type: 'text', placeholder: 'Word to rhyme with…' },
    });
    const searchBtn = searchRow.createEl('button', { text: 'Search', cls: 'mod-cta' });

    const filtersRow = wrap.createDiv({ cls: 'pn-rhyme-filters-row' });
    const letterLabel = filtersRow.createEl('label', { cls: 'pn-filter-label', text: 'Starts with:' });
    const letterInput = letterLabel.createEl('input', {
      cls: 'pn-rhyme-filter-input',
      attr: { type: 'text', maxlength: '3', placeholder: 'any' },
    });
    const syllLabel = filtersRow.createEl('label', { cls: 'pn-filter-label', text: 'Syllables:' });
    const syllInput = syllLabel.createEl('input', {
      cls: 'pn-rhyme-filter-input',
      attr: { type: 'number', min: '1', placeholder: 'any' },
    });

    const optionsRow = wrap.createDiv({ cls: 'pn-options-row' });
    const datamuseLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const datamuseCheckbox = datamuseLabel.createEl('input', { attr: { type: 'checkbox' } });
    datamuseLabel.appendText(' Include Datamuse (online)');

    const rhymezoneLink = optionsRow.createEl('a', {
      cls: 'pn-external-link',
      text: 'Open in RhymeZone ↗',
      attr: { href: '#' },
    });
    rhymezoneLink.addEventListener('click', (evt) => {
      evt.preventDefault();
      const w = wordInput.value.trim();
      if (!w) return;
      window.open(`https://www.rhymezone.com/r/rhyme.cgi?Word=${encodeURIComponent(w)}&typeofrhyme=perfect`, '_blank');
    });

    const results = wrap.createDiv({ cls: 'pn-rhyme-results' });

    const doSearch = () => {
      const word = wordInput.value.trim();
      if (!word) return;
      this.runRhymeSearch(word, {
        letter: letterInput.value.trim(),
        syllables: syllInput.value ? Number(syllInput.value) : null,
        includeDatamuse: datamuseCheckbox.checked,
      }, results);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
  }

  renderRhymeGroup(container, title, items, cls) {
    if (!items || items.length === 0) return;
    const section = container.createDiv({ cls: `pn-rhyme-section ${cls || ''}` });
    section.createEl('h4', { text: `${title} (${items.length})` });

    const bySyllables = new Map();
    for (const item of items) {
      const n = item.syllableCount || 0;
      if (!bySyllables.has(n)) bySyllables.set(n, []);
      bySyllables.get(n).push(item.word);
    }
    const syllableCounts = [...bySyllables.keys()].sort((a, b) => a - b);
    for (const n of syllableCounts) {
      const row = section.createDiv({ cls: 'pn-rhyme-syll-group' });
      row.createSpan({ cls: 'pn-rhyme-syll-label', text: n ? `${n} syll.:` : '?:' });
      row.createSpan({ cls: 'pn-rhyme-word-list', text: bySyllables.get(n).join(', ') });
    }
  }

  async runRhymeSearch(word, options, resultsEl) {
    resultsEl.empty();

    if (!this.plugin.cmudictIndex) {
      resultsEl.createDiv({ cls: 'pn-banner', text: 'CMUdict not loaded — rhyme search needs it. See the banner above.' });
      return;
    }

    const local = searchLocalRhymes(word, this.plugin.cmudictIndex, {
      letter: options.letter,
      syllables: options.syllables,
    });

    if (!local) {
      resultsEl.createDiv({ text: `"${word}" wasn't found in CMUdict, so I can't work out its rhyme sound. Try a different spelling.` });
      return;
    }

    this.renderRhymeGroup(resultsEl, 'Perfect rhymes', local.perfect, 'pn-rhyme-perfect');

    if (!this.plugin.settings.strictRhymeMode) {
      this.renderRhymeGroup(resultsEl, 'Near / slant rhymes', local.near, 'pn-rhyme-near');
    }

    if (local.perfect.length === 0 && local.near.length === 0) {
      resultsEl.createDiv({ text: 'No rhymes found in CMUdict for this word with the current filters.' });
    }

    if (options.includeDatamuse) {
      const loading = resultsEl.createDiv({ cls: 'pn-rhyme-loading', text: 'Querying Datamuse…' });
      try {
        const [perfect, near] = await Promise.all([
          fetchDatamuseRhymes(word, false),
          this.plugin.settings.strictRhymeMode ? Promise.resolve([]) : fetchDatamuseRhymes(word, true),
        ]);
        loading.remove();
        const localWords = new Set([...local.perfect, ...local.near].map((w) => w.word));
        const extraPerfect = perfect.filter((d) => !localWords.has(d.word.toLowerCase()));
        const extraNear = near.filter((d) => !localWords.has(d.word.toLowerCase()));
        this.renderRhymeGroup(
          resultsEl, 'Online — Datamuse (perfect, not already listed above)',
          extraPerfect.map((d) => ({ word: d.word, syllableCount: d.numSyllables || 0 })),
          'pn-rhyme-online'
        );
        if (!this.plugin.settings.strictRhymeMode) {
          this.renderRhymeGroup(
            resultsEl, 'Online — Datamuse (near, not already listed above)',
            extraNear.map((d) => ({ word: d.word, syllableCount: d.numSyllables || 0 })),
            'pn-rhyme-online'
          );
        }
      } catch (e) {
        loading.setText('Datamuse request failed (offline, or the API is unavailable).');
      }
    }
  }

