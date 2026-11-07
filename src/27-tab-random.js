  // ---- Random tab ----
  // Same structure as the French Hasard tab: a "quick draw" banner of
  // filter shortcuts, two collapsible sections (filter by tags / exclude
  // tags), the draw zone (counter, button, word, note, tags, actions,
  // tag presets and form), then "add a rare word" and statistics.
  renderRandomTab(panel) {
    const state = {
      includeTags: new Set(),
      // Remembered between sessions; by default the base's 'vulgar' and
      // 'sexual' words are left out of draws (one click to bring them back).
      excludeTags: new Set(this.plugin.settings.randomExcludedTags || []),
      includeMode: 'or',
      onlyLiked: false,
      onlyExcluded: false,
      hideTagged: false,
      multiTagged: false,
    };
    const pool = () => poolWithMeta(this.plugin.personalDictionary);
    const customTags = (w) => w.userTags || [];
    const filtered = () => filterPool(pool(), state).filter((w) => {
      const n = customTags(w).length;
      if (state.hideTagged && n > 0) return false;
      if (state.multiTagged && n < 2) return false;
      return true;
    });
    const allTags = () => allTagsFromPool(pool());
    const tagsByFrequency = () => {
      const counts = new Map();
      pool().forEach((w) => customTags(w).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    };

    let statsDiv = null;
    let counterEl = null;

    const filtersDiv = panel.createDiv({ cls: 'pn-hasard-filtres' });
    const banner = filtersDiv.createDiv({ cls: 'pn-hasard-bandeau' });
    banner.createDiv({ cls: 'pn-titre', text: 'Quick draw' });
    const quickDiv = banner.createDiv({ cls: 'pn-hasard-filtres-rapides' });

    const incl = makeCollapsibleSection(filtersDiv, 'Filter by tags', 'pn-hasard-section-inclusion');
    const inclForm = incl.body.createDiv({ cls: 'pn-hasard-ligne-form' });
    const inclListId = 'pn-random-taglist-' + Math.random().toString(36).slice(2, 8);
    const inclInput = inclForm.createEl('input', { attr: { type: 'text', placeholder: 'a tag (or click several pills below)…', list: inclListId } });
    const inclDatalist = inclForm.createEl('datalist', { attr: { id: inclListId } });
    const inclAddBtn = inclForm.createEl('button', { cls: 'pn-link-btn', text: '+ add tag' });
    const inclAllBtn = inclForm.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags' });
    const andLabel = incl.body.createEl('label', { cls: 'pn-hasard-mode-et' });
    const andCheckbox = andLabel.createEl('input', { attr: { type: 'checkbox' } });
    andLabel.createSpan({ text: ' All checked tags (AND) rather than at least one (OR)' });
    const inclChips = incl.body.createDiv({ cls: 'pn-hasard-filtres-chips' });

    const excl = makeCollapsibleSection(filtersDiv, 'Exclude tags', 'pn-hasard-section-exclusion');
    const exclForm = excl.body.createDiv({ cls: 'pn-hasard-ligne-form' });
    const exclListId = 'pn-random-excllist-' + Math.random().toString(36).slice(2, 8);
    const exclInput = exclForm.createEl('input', { attr: { type: 'text', placeholder: 'a tag to exclude (or click several pills)…', list: exclListId } });
    const exclDatalist = exclForm.createEl('datalist', { attr: { id: exclListId } });
    const exclAddBtn = exclForm.createEl('button', { cls: 'pn-link-btn', text: '+ exclude' });
    const exclAllBtn = exclForm.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags to exclude' });
    const exclChips = excl.body.createDiv({ cls: 'pn-hasard-filtres-chips' });

    incl.setCountBadge(() => state.includeTags.size);
    excl.setCountBadge(() => state.excludeTags.size);

    const inclPanel = makeAllTagsPanel(incl.body, inclAllBtn,
      () => allTags().filter((t) => !state.includeTags.has(t)),
      (t) => { state.includeTags.add(t); refresh(); });
    const exclPanel = makeAllTagsPanel(excl.body, exclAllBtn,
      () => allTags().filter((t) => !state.excludeTags.has(t)),
      (t) => { state.excludeTags.add(t); refresh(); }, 'See all tags to exclude');

    const renderQuick = () => {
      quickDiv.empty();
      [
        { label: '🚫 Explore excluded', on: state.onlyExcluded, color: '#a3831f', toggle: () => { state.onlyExcluded = !state.onlyExcluded; } },
        { label: '♥ Explore liked', on: state.onlyLiked, color: '#c2185b', toggle: () => { state.onlyLiked = !state.onlyLiked; } },
        { label: '📭 Hide words already tagged', on: state.hideTagged, color: 'var(--text-muted)', toggle: () => { state.hideTagged = !state.hideTagged; } },
        { label: '🏷️ Explore multi-tagged', on: state.multiTagged, color: 'var(--text-muted)', toggle: () => { state.multiTagged = !state.multiTagged; } },
      ].forEach((q) => {
        const b = quickDiv.createEl('button', { cls: 'pn-hasard-filtre-rapide' + (q.on ? ' pn-hasard-filtre-rapide-actif' : ''), text: q.label });
        b.style.borderColor = q.color;
        if (q.on) { b.style.background = q.color; b.style.color = '#fff'; } else { b.style.color = q.color; }
        b.addEventListener('click', () => { q.toggle(); refresh(); });
      });
    };

    const renderStats = () => {
      if (!statsDiv) return;
      statsDiv.empty();
      const all = pool();
      const excludedN = all.filter((w) => w.excluded).length;
      const likedN = all.filter((w) => w.liked).length;
      const untagged = all.filter((w) => customTags(w).length === 0).length;
      const item = (text, cls) => statsDiv.createSpan({ cls: 'pn-hasard-stat ' + cls, text });
      item(`${all.length} word(s) in total`, 'pn-hasard-stat-total');
      item(`${excludedN} excluded`, 'pn-hasard-stat-exclus');
      item(`${untagged} without a tag`, 'pn-hasard-stat-sanstag');
      item(`${likedN} liked`, 'pn-hasard-stat-vu');
      const counts = new Map();
      all.forEach((w) => customTags(w).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      if (counts.size) {
        const detail = statsDiv.createDiv({ cls: 'pn-hasard-stats-detail' });
        const bloc = detail.createDiv({ cls: 'pn-hasard-stats-bloc' });
        bloc.createDiv({ cls: 'pn-titre', text: 'By tag' });
        const list = bloc.createDiv({ cls: 'pn-hasard-stats-liste' });
        [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
          const chip = list.createSpan({ cls: 'pn-hasard-stats-chip', text: `${t} · ${n}` });
          const c = tagColor(t);
          chip.style.borderColor = c; chip.style.color = c;
        });
      }
    };

    const saveExcluded = () => {
      const now = [...state.excludeTags];
      const before = this.plugin.settings.randomExcludedTags || [];
      if (now.length === before.length && now.every((t) => before.includes(t))) return;
      this.plugin.settings.randomExcludedTags = now;
      this.plugin.saveSettings();
    };
    const refresh = () => {
      saveExcluded();
      state.includeMode = andCheckbox.checked ? 'and' : 'or';
      renderQuick();
      renderStats();
      incl.render();
      excl.render();
      const tags = allTags();
      inclDatalist.empty();
      exclDatalist.empty();
      tags.forEach((t) => {
        if (!state.includeTags.has(t)) inclDatalist.createEl('option', { attr: { value: t } });
        if (!state.excludeTags.has(t)) exclDatalist.createEl('option', { attr: { value: t } });
      });
      inclPanel.render();
      exclPanel.render();
      inclChips.empty();
      if (state.includeTags.size) {
        inclChips.createSpan({ cls: 'pn-sources-label', text: 'Active filters: ' });
        [...state.includeTags].forEach((t) => makeTagChip(inclChips, t, () => { state.includeTags.delete(t); refresh(); }));
      }
      exclChips.empty();
      if (state.excludeTags.size) {
        exclChips.createSpan({ cls: 'pn-sources-label', text: 'Excluded: ' });
        [...state.excludeTags].forEach((t) => makeTagChip(exclChips, t, () => { state.excludeTags.delete(t); refresh(); }));
      }
      if (counterEl) {
        const n = filtered().length;
        counterEl.setText(n === 0 ? 'No word matches these filters' : `${n} word${n > 1 ? 's' : ''} match${n > 1 ? '' : 'es'} these filters`);
      }
      if (current) renderPresets();
    };

    const addFrom = (input, set) => {
      const t = input.value.trim();
      if (!t) return;
      set.add(t);
      input.value = '';
      refresh();
    };
    inclAddBtn.addEventListener('click', () => addFrom(inclInput, state.includeTags));
    inclInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFrom(inclInput, state.includeTags); } });
    exclAddBtn.addEventListener('click', () => addFrom(exclInput, state.excludeTags));
    exclInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFrom(exclInput, state.excludeTags); } });
    andCheckbox.addEventListener('change', refresh);

    // ---- draw zone ----
    const zone = panel.createDiv({ cls: 'pn-hasard-zone' });
    counterEl = zone.createDiv({ cls: 'pn-hasard-compteur-pool' });
    const drawWrap = zone.createDiv({ cls: 'pn-hasard-bouton-wrap' });
    const drawBtn = drawWrap.createEl('button', { cls: 'pn-hasard-bouton', text: '🎲 Draw a random word' });
    const wordEl = zone.createDiv({ cls: 'pn-hasard-mot' });
    const noteEl = zone.createDiv({ cls: 'pn-hasard-note' });
    const chipsDiv = zone.createDiv({ cls: 'pn-hasard-tags' });
    const actions = zone.createDiv({ cls: 'pn-hasard-actions' });
    actions.style.display = 'none';
    const defsBtn = actions.createEl('button', { cls: 'pn-link-btn', text: 'See its definition →' });
    const rhymesBtn = actions.createEl('button', { cls: 'pn-link-btn', text: 'Find its rhymes →' });
    const likeBtn = actions.createEl('button', { cls: 'pn-link-btn' });
    const excludeBtn = actions.createEl('button', { cls: 'pn-link-btn pn-btn-exclure' });
    const presetsDiv = zone.createDiv({ cls: 'pn-hasard-tag-presets' });
    presetsDiv.style.display = 'none';
    const allTagsBtn = zone.createEl('button', { cls: 'pn-link-btn pn-hasard-voir-tous-tags', text: 'See all tags' });
    allTagsBtn.style.display = 'none';
    const tagForm = zone.createDiv({ cls: 'pn-hasard-tag-ajout' });
    tagForm.style.display = 'none';
    const tagListId = 'pn-random-tagadd-' + Math.random().toString(36).slice(2, 8);
    const tagInput = tagForm.createEl('input', { attr: { type: 'text', placeholder: 'add a tag (e.g. archaic)', list: tagListId } });
    const tagDatalist = tagForm.createEl('datalist', { attr: { id: tagListId } });
    const tagAddBtn = tagForm.createEl('button', { cls: 'pn-link-btn', text: '+ tag' });

    let current = null; // pool entry currently shown

    const reloadCurrent = () => {
      if (!current) return;
      const fresh = pool().find((w) => w.word.toLowerCase() === current.word.toLowerCase());
      if (fresh) current = fresh;
    };
    const addTag = async (t) => {
      if (!current || !t) return;
      await this.plugin.addWordTag(current.word, t);
      reloadCurrent(); renderCurrent(); refresh();
    };
    const allTagsPanel = makeAllTagsPanel(zone, allTagsBtn, () => {
      const all = tagsByFrequency();
      return all.length > 6 ? [...all].sort() : [];
    }, addTag);
    const renderPresets = () => {
      presetsDiv.empty();
      const top = tagsByFrequency().filter((t) => !customTags(current).includes(t)).slice(0, 6);
      presetsDiv.style.display = top.length ? 'flex' : 'none';
      top.forEach((t) => {
        const b = presetsDiv.createEl('button', { cls: 'pn-hasard-preset-btn', text: '+ ' + t });
        const c = tagColor(t);
        b.style.borderColor = c; b.style.color = c;
        b.addEventListener('click', () => addTag(t));
      });
      allTagsPanel.render();
      tagDatalist.empty();
      allTags().forEach((t) => tagDatalist.createEl('option', { attr: { value: t } }));
    };

    const renderCurrent = () => {
      if (!current) return;
      wordEl.setText(current.word);
      noteEl.empty();
      if (current.note) noteEl.createDiv({ cls: 'pn-hasard-note-partie', text: current.note });
      if (current.estimated) {
        noteEl.createDiv({ cls: 'pn-hasard-note-sep', text: 'not in CMUdict: syllables estimated, rhymes only online (Datamuse)' });
      }
      chipsDiv.empty();
      const theme = current.theme || 'Untagged';
      const themeChip = chipsDiv.createSpan({ cls: 'pn-tag-chip', text: theme });
      themeChip.setAttr('title', 'Theme (always a tag)');
      customTags(current).forEach((t) => makeTagChip(chipsDiv, t, async () => {
        await this.plugin.removeWordTag(current.word, t);
        reloadCurrent(); renderCurrent(); refresh();
      }));
      likeBtn.setText(current.liked ? '♥ Liked (undo)' : '♡ Like');
      excludeBtn.setText(current.excluded ? '↩ Draw this word again' : '🚫 Stop drawing this word');
      actions.style.display = 'flex';
      tagForm.style.display = 'flex';
      renderPresets();
    };

    const draw = () => {
      const list = filtered();
      if (list.length === 0) {
        current = null;
        wordEl.setText('No word available with these filters.');
        noteEl.empty(); chipsDiv.empty(); presetsDiv.empty();
        presetsDiv.style.display = 'none';
        actions.style.display = 'none';
        tagForm.style.display = 'none';
        allTagsBtn.style.display = 'none';
        return;
      }
      current = list[Math.floor(Math.random() * list.length)];
      renderCurrent();
    };

    drawBtn.addEventListener('click', draw);
    defsBtn.addEventListener('click', () => {
      if (!current) return;
      this.switchTab('definitions');
      if (this._prefillDefinitions) this._prefillDefinitions(current.word);
    });
    rhymesBtn.addEventListener('click', () => {
      if (!current) return;
      this.switchTab('rhymes');
      if (this._prefillRhymes) this._prefillRhymes(current.word);
    });
    likeBtn.addEventListener('click', async () => {
      if (!current) return;
      await this.plugin.toggleWordLiked(current.word);
      reloadCurrent(); renderCurrent(); refresh();
    });
    excludeBtn.addEventListener('click', async () => {
      if (!current) return;
      const wasExcluded = current.excluded;
      await this.plugin.toggleWordExcluded(current.word);
      if (!wasExcluded) { new Notice(`"${current.word}" won't be drawn anymore.`); refresh(); draw(); return; }
      reloadCurrent(); renderCurrent(); refresh();
    });
    tagAddBtn.addEventListener('click', async () => { await addTag(tagInput.value.trim()); tagInput.value = ''; });
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tagAddBtn.click(); });

    // ---- add a rare word by hand ----
    const addDetails = panel.createEl('details', { cls: 'pn-hasard-ajout' });
    addDetails.createEl('summary', { text: '+ Add a rare word by hand' });
    const addForm = addDetails.createDiv({ cls: 'pn-hasard-ajout-form' });
    const inWord = addForm.createEl('input', { attr: { type: 'text', placeholder: 'word' } });
    const inNote = addForm.createEl('input', { attr: { type: 'text', placeholder: 'short definition (optional)' } });
    const inTags = addForm.createEl('input', { attr: { type: 'text', placeholder: 'tags, comma-separated (optional)' } });
    const addWordBtn = addForm.createEl('button', { cls: 'pn-link-btn', text: 'Add to my personal dictionary' });
    addWordBtn.addEventListener('click', async () => {
      const w = inWord.value.trim();
      if (!w) { new Notice('A word is required.'); return; }
      const tags = inTags.value.split(',').map((t) => t.trim()).filter(Boolean);
      if (!(await this.plugin.addRareWord(w, inNote.value.trim(), tags))) return;
      inWord.value = ''; inNote.value = ''; inTags.value = '';
      refresh();
    });

    // ---- statistics ----
    const statsDetails = panel.createEl('details', { cls: 'pn-hasard-stats-details' });
    statsDetails.createEl('summary', { text: 'Show statistics' });
    statsDiv = statsDetails.createDiv({ cls: 'pn-hasard-stats' });
    statsDetails.addEventListener('toggle', () => { if (statsDetails.open) renderStats(); });

    refresh();
    draw();
  }
