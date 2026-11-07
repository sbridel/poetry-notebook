  // ---- Inspiration tab ----
  // Same structure as the French Inspiration tab: "complete online" box,
  // search form, then results per source. Words can be clicked to build a
  // selection (kept across searches) and added to a personal theme or as
  // rare words — those land in the Notes tab if they have no note.
  renderInspirationTab(panel) {
    const sourcesBox = panel.createDiv({ cls: 'pn-sources' });
    sourcesBox.createSpan({ cls: 'pn-sources-label', text: 'Complete online: ' });
    const datamuseToggle = makeTogglePill(sourcesBox, 'Datamuse (means like)', (this.plugin.settings.onlineSources || []).includes('inspiration'),
      'Adds loosely related words from Datamuse. Never queried unless checked.');

    const form = panel.createDiv({ cls: 'pn-rime-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A theme… (e.g. forest, sea, night, love, time)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });

    // --- selection kept across searches + action bar ---
    const selection = new Map(); // lowercase word -> { word, theme, note }
    const actionBar = panel.createDiv({ cls: 'pn-inspi-action-bar' });
    actionBar.style.display = 'none';

    const refreshHighlight = () => {
      panel.querySelectorAll('[data-pn-word]').forEach((el) => el.classList.toggle('pn-selectionne', selection.has(el.dataset.pnWord)));
    };
    const toggleSelection = (word, theme, note) => {
      const k = word.toLowerCase();
      if (selection.has(k)) selection.delete(k); else selection.set(k, { word, theme, note });
      renderActionBar();
    };
    const selectionApi = { has: (k) => selection.has(k), toggle: toggleSelection };

    const renderActionBar = () => {
      actionBar.empty();
      if (selection.size === 0) { actionBar.style.display = 'none'; return; }
      actionBar.style.display = 'flex';
      const chipsRow = actionBar.createDiv({ cls: 'pn-inspi-selection-chips' });
      chipsRow.createSpan({ cls: 'pn-sources-label', text: `${selection.size} word${selection.size > 1 ? 's' : ''} selected: ` });
      [...selection.values()].forEach(({ word }) => {
        const chip = chipsRow.createSpan({ cls: 'pn-tag-chip' });
        chip.createSpan({ text: word });
        const x = chip.createSpan({ cls: 'pn-tag-chip-x', text: ' ×' });
        x.addEventListener('click', () => { toggleSelection(word); refreshHighlight(); });
      });
      const clearBtn = chipsRow.createEl('button', { cls: 'pn-link-btn', text: 'Deselect all' });
      clearBtn.addEventListener('click', () => { selection.clear(); renderActionBar(); refreshHighlight(); });

      const actionsRow = actionBar.createDiv({ cls: 'pn-inspi-selection-actions' });
      const themeBtn = actionsRow.createEl('button', { cls: 'pn-hasard-graver-btn', text: '+ Add to a theme' });
      const rareBtn = actionsRow.createEl('button', { cls: 'pn-hasard-graver-btn', text: '+ Add as rare word(s)' });

      let themeForm = null;
      themeBtn.addEventListener('click', () => {
        if (themeForm) { themeForm.remove(); themeForm = null; return; }
        themeForm = actionBar.createDiv({ cls: 'pn-inspi-ajout-form' });
        const listId = 'pn-inspi-themes-' + Math.random().toString(36).slice(2, 8);
        const themeInput = themeForm.createEl('input', { attr: { type: 'text', placeholder: 'theme (e.g. Mountains)', list: listId } });
        const datalist = themeForm.createEl('datalist', { attr: { id: listId } });
        ((this.plugin.personalDictionary && this.plugin.personalDictionary.vocabularyThemes) || [])
          .forEach((t) => t && t.theme && datalist.createEl('option', { attr: { value: t.theme } }));
        const triggersInput = themeForm.createEl('input', { attr: { type: 'text', placeholder: 'trigger words, comma-separated (if new theme)' } });
        const okBtn = themeForm.createEl('button', { cls: 'pn-link-btn', text: `Add the ${selection.size} word(s)` });
        const suggested = [...new Set([...selection.values()].map((v) => v.theme).filter(Boolean))];
        if (suggested.length === 1) {
          const sug = themeForm.createDiv({ cls: 'pn-inspi-suggestion' });
          sug.createSpan({ text: 'Suggestion: ' });
          const sugBtn = sug.createEl('button', { cls: 'pn-link-btn', text: suggested[0] });
          sugBtn.addEventListener('click', () => { themeInput.value = suggested[0]; themeInput.focus(); });
        }
        const submit = async () => {
          const theme = themeInput.value.trim();
          if (!theme) { new Notice('A theme is required.'); return; }
          const triggers = triggersInput.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
          const words = [...selection.values()];
          const n = await this.plugin.addThemeWords(theme, triggers, words.map(({ word, note }) => ({ word, note })));
          new Notice(`Poet's Notebook: ${n} word(s) added to the theme "${theme}".`);
          selection.clear(); renderActionBar(); refreshHighlight();
        };
        okBtn.addEventListener('click', submit);
        themeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      });

      rareBtn.addEventListener('click', async () => {
        let n = 0;
        for (const { word, note } of selection.values()) if (await this.plugin.addRareWord(word, note || '', [], { quiet: true })) n++;
        new Notice(`Poet's Notebook: ${n} word(s) added as rare words to your personal dictionary.`);
        selection.clear(); renderActionBar(); refreshHighlight();
      });
    };

    const results = panel.createDiv({ cls: 'pn-resultats' });
    const doSearch = () => this.renderInspirationResults(results, wordInput.value, datamuseToggle.checked, selectionApi);

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });
    datamuseToggle.addEventListener('change', () => this.plugin.setOnlineSource('inspiration', datamuseToggle.checked));

    this._prefillInspiration = (word) => { wordInput.value = word; doSearch(); };
  }

  // Shared by the Inspiration tab and the Inspiration modal (editor
  // right-click on a selection). selectionApi is null in the modal.
  async renderInspirationResults(results, rawWord, includeDatamuse, selectionApi) {
    results.empty();
    const word = (rawWord || '').trim();
    if (!word) return;

    const makeSelectable = (el, w, theme, note) => {
      if (!selectionApi) return;
      const k = w.toLowerCase();
      el.dataset.pnWord = k;
      el.addClass('pn-inspi-cliquable');
      el.toggleClass('pn-selectionne', selectionApi.has(k));
      el.addEventListener('click', () => {
        selectionApi.toggle(w, theme, note);
        el.toggleClass('pn-selectionne', selectionApi.has(k));
      });
    };

    const localBody = makeSourceBlock(results, `${word} — built-in & personal themes`, true, true);
    const themes = findInspiration(word, this.plugin.personalDictionary);
    if (themes.length === 0) {
      localBody.createEl('p', {
        cls: 'pn-vide',
        text: `No theme is triggered by "${word}" — try a broader word (forest, sea, night, love, time, fire, weather, silence…), or add your own theme to the personal dictionary.`,
      });
    } else {
      for (const t of themes) {
        const block = localBody.createDiv({ cls: 'pn-groupe' });
        block.createDiv({ cls: 'pn-son-label', text: t.theme });
        const list = block.createDiv({ cls: 'pn-inspi-liste' });
        for (const entry of (t.words || [])) {
          const w = typeof entry === 'string' ? entry : entry.word;
          const note = typeof entry === 'string' ? '' : (entry.note || '');
          if (!w) continue;
          const row = list.createDiv({ cls: 'pn-inspi-mot' });
          const term = row.createSpan({ cls: 'pn-inspi-terme', text: w });
          if (note) row.createSpan({ cls: 'pn-inspi-note', text: note });
          makeSelectable(term, w, t.theme, note);
        }
      }
    }

    if (!includeDatamuse) return;
    const onlineBody = makeSourceBlock(results, `${word} — Datamuse`, true, false);
    const status = onlineBody.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
    try {
      const related = await fetchDatamuseMeansLike(word);
      status.remove();
      if (related.length === 0) { onlineBody.createEl('p', { cls: 'pn-vide', text: `Nothing found on Datamuse for "${word}".` }); return; }
      const suggestedTheme = word.charAt(0).toUpperCase() + word.slice(1);
      makeWordGroup(onlineBody, 'Related words', related, 'pn-mot pn-mot-inspi', this.plugin.cmudictIndex, {
        extraCls: 'pn-nature-lexical',
        onChip: (span, w) => makeSelectable(span, w, suggestedTheme, ''),
      });
    } catch (e) {
      status.setText('Datamuse: search impossible (no connection, site unreachable, or timeout).');
    }
  }
