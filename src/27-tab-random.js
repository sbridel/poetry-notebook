  // ---- Random tab ----
  renderRandomTab(body) {
    const wrap = body.createDiv({ cls: 'pn-random-tab' });

    // Filter state, kept in closure across re-renders of this tab instance.
    const state = {
      includeTags: new Set(),
      excludeTags: new Set(),
      includeMode: 'or', // 'or' | 'and' — only matters with 2+ include tags
      onlyLiked: false,
      onlyExcluded: false, // review mode: browse only excluded words
    };
    let lastPick = null; // re-rendered in place when its tags/like/excluded change

    const quickRow = wrap.createDiv({ cls: 'pn-random-quickrow' });
    const likedPill = quickRow.createEl('button', { cls: 'pn-tag-pill', text: '♥ Liked only' });
    const reviewPill = quickRow.createEl('button', { cls: 'pn-tag-pill', text: '🚫 Review excluded' });

    const includeDetails = wrap.createEl('details', { cls: 'pn-random-filters' });
    includeDetails.createEl('summary', { text: 'Filter by tag' });
    const includeModeRow = includeDetails.createDiv({ cls: 'pn-tag-mode-row' });
    const includeModeBtn = includeModeRow.createEl('button', { cls: 'pn-tag-pill', text: 'Match: any (OR)' });
    const includePillsRow = includeDetails.createDiv({ cls: 'pn-tag-pills-row' });

    const excludeDetails = wrap.createEl('details', { cls: 'pn-random-filters' });
    excludeDetails.createEl('summary', { text: 'Exclude tags' });
    const excludePillsRow = excludeDetails.createDiv({ cls: 'pn-tag-pills-row' });

    const statsLine = wrap.createDiv({ cls: 'pn-random-stats' });
    const btn = wrap.createEl('button', { text: 'Give me a rare word', cls: 'mod-cta pn-random-btn' });
    const result = wrap.createDiv({ cls: 'pn-random-result' });

    const currentPool = () => poolWithMeta(this.plugin.personalDictionary);
    const currentFiltered = () => filterPool(currentPool(), state);

    const renderTagPills = (rowEl, tags, activeSet, onToggle) => {
      rowEl.empty();
      tags.forEach((tag) => {
        const pill = rowEl.createEl('button', { cls: 'pn-tag-pill', text: tag });
        if (activeSet.has(tag)) pill.addClass('pn-tag-pill-active');
        pill.addEventListener('click', () => {
          if (activeSet.has(tag)) activeSet.delete(tag); else activeSet.add(tag);
          refreshFilters();
        });
      });
    };

    const refreshFilters = () => {
      const pool = currentPool();
      const tags = allTagsFromPool(pool);
      renderTagPills(includePillsRow, tags, state.includeTags, refreshFilters);
      renderTagPills(excludePillsRow, tags, state.excludeTags, refreshFilters);
      includeModeBtn.setText(state.includeMode === 'and' ? 'Match: all (AND)' : 'Match: any (OR)');
      includeModeRow.style.display = state.includeTags.size > 1 ? 'block' : 'none';
      likedPill.toggleClass('pn-tag-pill-active', state.onlyLiked);
      reviewPill.toggleClass('pn-tag-pill-active', state.onlyExcluded);
      const n = currentFiltered().length;
      statsLine.setText(`${n} word${n === 1 ? '' : 's'} match${n === 1 ? 'es' : ''} the current filters (${pool.length} total).`);
    };

    likedPill.addEventListener('click', () => { state.onlyLiked = !state.onlyLiked; refreshFilters(); });
    reviewPill.addEventListener('click', () => { state.onlyExcluded = !state.onlyExcluded; refreshFilters(); });
    includeModeBtn.addEventListener('click', () => {
      state.includeMode = state.includeMode === 'and' ? 'or' : 'and';
      refreshFilters();
    });

    const renderCard = (pick) => {
      lastPick = pick;
      result.empty();
      const card = result.createDiv({ cls: 'pn-rhyme-section pn-rhyme-perfect pn-random-card' });
      card.createEl('h2', { text: pick.word });
      card.createDiv({ cls: 'pn-random-note', text: pick.note });

      const tagsRow = card.createDiv({ cls: 'pn-random-tags' });
      pick.tags.forEach((tag) => {
        const isTheme = tag === pick.theme;
        const chip = tagsRow.createSpan({ cls: 'pn-tag-chip' + (isTheme ? ' pn-tag-chip-theme' : ''), text: tag });
        if (!isTheme) {
          const remove = chip.createSpan({ cls: 'pn-tag-chip-remove', text: ' ✕' });
          remove.addEventListener('click', async () => {
            await this.plugin.removeWordTag(pick.word, tag);
            renderCard({ ...pick, tags: pick.tags.filter((t) => t !== tag) });
            refreshFilters();
          });
        }
      });
      const addTagRow = card.createDiv({ cls: 'pn-random-add-tag' });
      const addTagInput = addTagRow.createEl('input', { attr: { type: 'text', placeholder: 'Add a tag…' } });
      const addTagBtn = addTagRow.createEl('button', { cls: 'pn-icon-btn', text: '+' });
      const doAddTag = async () => {
        const t = addTagInput.value.trim();
        if (!t) return;
        await this.plugin.addWordTag(pick.word, t);
        addTagInput.value = '';
        renderCard({ ...pick, tags: Array.from(new Set([...pick.tags, t])) });
        refreshFilters();
      };
      addTagBtn.addEventListener('click', doAddTag);
      addTagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddTag(); });

      const statusRow = card.createDiv({ cls: 'pn-random-status-row' });
      const likeBtn = statusRow.createEl('button', { cls: 'pn-tag-pill' + (pick.liked ? ' pn-tag-pill-active' : ''), text: '♥ Liked' });
      likeBtn.addEventListener('click', async () => {
        const liked = await this.plugin.toggleWordLiked(pick.word);
        renderCard({ ...pick, liked });
        refreshFilters();
      });
      const excludeBtn = statusRow.createEl('button', { cls: 'pn-tag-pill' + (pick.excluded ? ' pn-tag-pill-active' : ''), text: '🚫 Exclude from draws' });
      excludeBtn.addEventListener('click', async () => {
        const excluded = await this.plugin.toggleWordExcluded(pick.word);
        renderCard({ ...pick, excluded });
        refreshFilters();
      });

      const linkRow = card.createDiv({ cls: 'pn-random-links' });
      const defLink = linkRow.createEl('a', { text: 'Look up in Definitions →', attr: { href: '#' } });
      defLink.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.activeTab = 'definitions';
        this.render();
        setTimeout(() => {
          const input = this.containerEl.querySelector('.pn-definitions-tab .pn-rhyme-input');
          if (input) { input.value = pick.word; input.focus(); }
        }, 0);
      });
      const rhymeLink = linkRow.createEl('a', { text: 'Find rhymes →', attr: { href: '#' } });
      rhymeLink.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.activeTab = 'rhymes';
        this.render();
        setTimeout(() => {
          const input = this.containerEl.querySelector('.pn-rhymes-tab .pn-rhyme-input');
          if (input) { input.value = pick.word; input.focus(); }
        }, 0);
      });
    };

    btn.addEventListener('click', () => {
      const pool = currentFiltered();
      if (pool.length === 0) { result.empty(); result.setText('No word matches the current filters.'); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      renderCard(pick);
    });

    refreshFilters();
  }
