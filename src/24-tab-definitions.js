  // ---- Definitions tab ----
  // Same structure as the French Définitions tab: form (field, Search,
  // "open on…" link), then a titled result with a framed quick block
  // (etymology) and one collapsible block per part of speech.
  renderDefinitionsTab(panel) {
    const form = panel.createDiv({ cls: 'pn-rime-form pn-defs-form' });
    const wordInput = form.createEl('input', { attr: { type: 'text', placeholder: 'A word… (e.g. melancholy, canopy, ire)' } });
    const searchBtn = form.createEl('button', { text: 'Search' });
    const openLink = form.createEl('a', { cls: 'pn-icon-btn', text: 'Open on Wiktionary ↗', attr: { target: '_blank', rel: 'noopener', href: 'https://en.wiktionary.org/' } });
    const syncLink = () => {
      const w = wordInput.value.trim();
      openLink.setAttr('href', w ? `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` : 'https://en.wiktionary.org/');
    };
    wordInput.addEventListener('input', syncLink);

    const results = panel.createDiv({ cls: 'pn-resultats' });

    // Two sources, switched with pills like the French plugin's CNRTL
    // dictionaries: Free Dictionary API (clean JSON, first) and the
    // Wiktionary page extract (fallback, has etymology more often).
    const SOURCES = [
      { id: 'freedict', label: 'Free Dictionary', render: (zone, word) => this.renderFreeDictionary(zone, word) },
      { id: 'wiktionary', label: 'Wiktionary', render: (zone, word) => this.renderWiktionaryDefinition(zone, word) },
    ];

    const doSearch = async () => {
      const word = wordInput.value.trim();
      results.empty();
      if (!word) return;
      syncLink();
      results.createDiv({ cls: 'pn-son-label', text: word });
      const pills = results.createDiv({ cls: 'pn-cnrtl-source-pills' });
      const zone = results.createDiv({ cls: 'pn-cnrtl-source-zone' });
      const buttons = [];
      const show = async (src) => {
        buttons.forEach(({ b, id }) => b.toggleClass('active', id === src.id));
        zone.empty();
        const status = zone.createEl('p', { cls: 'pn-vide', text: 'Searching…' });
        let found = false;
        try {
          found = await src.render(zone, word);
          status.remove();
        } catch (e) {
          status.setText(`${src.label}: search impossible (no connection, site unreachable, or timeout).`);
          return false;
        }
        if (!found) zone.createEl('p', { cls: 'pn-vide', text: `"${word}" has no English entry on ${src.label}.` });
        return found;
      };
      SOURCES.forEach((src) => {
        const b = pills.createEl('button', { cls: 'pn-cnrtl-source-pill', text: src.label });
        b.addEventListener('click', () => show(src));
        buttons.push({ b, id: src.id });
      });
      // First source; if it has nothing (or fails), fall back to Wiktionary.
      const ok = await show(SOURCES[0]).catch(() => false);
      if (!ok) await show(SOURCES[1]);
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });

    this._prefillDefinitions = (word) => { wordInput.value = word; doSearch(); };
  }

  // Free Dictionary API block. Returns true when an entry was found.
  async renderFreeDictionary(zone, word) {
    const entry = await fetchFreeDictionaryEntry(word);
    if (!entry || entry.groups.length === 0) return false;
    if (entry.phonetics.length || entry.origin) {
      const block = zone.createDiv({ cls: 'pn-cnrtl-bloc' });
      if (entry.phonetics.length) {
        block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Pronunciation' });
        block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.phonetics.join('  ·  ') });
      }
      if (entry.origin) {
        block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Origin' });
        block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.origin });
      }
    }
    entry.groups.forEach((g, i) => {
      const det = zone.createEl('details', { cls: 'pn-cnrtl-details' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-cnrtl-details-titre', text: `${g.pos} (${g.definitions.length})` });
      const body = det.createDiv({ cls: 'pn-cnrtl-texte' });
      const list = body.createEl('ol');
      g.definitions.forEach((d) => {
        const li = list.createEl('li', { text: d.text });
        if (d.example) li.createDiv({ cls: 's-example', text: d.example });
      });
      const idx = this.plugin.cmudictIndex;
      makeWordGroup(body, 'Synonyms', g.synonyms, 'pn-mot pn-mot-syno', idx, { type: 'syno' });
      makeWordGroup(body, 'Antonyms', g.antonyms, 'pn-mot pn-mot-anto', idx, { type: 'anto' });
    });
    zone.createEl('a', { cls: 'pn-cnrtl-lien', text: 'Source: Wiktionary via dictionaryapi.dev (CC BY-SA)', attr: { href: 'https://dictionaryapi.dev/', target: '_blank', rel: 'noopener' } });
    return true;
  }

  // Wiktionary page-extract block (the original parser). Returns true when
  // an entry was found.
  async renderWiktionaryDefinition(zone, word) {
    const entry = await fetchWiktionaryEntry(word);
    if (!entry) return false;
    const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    zone.createEl('a', { cls: 'pn-cnrtl-lien', text: `See "${word}" on Wiktionary →`, attr: { href: url, target: '_blank', rel: 'noopener' } });
    if (entry.etymology) {
      const block = zone.createDiv({ cls: 'pn-cnrtl-bloc' });
      block.createDiv({ cls: 'pn-cnrtl-titre', text: 'Etymology' });
      block.createEl('p', { cls: 'pn-cnrtl-texte', text: entry.etymology });
    }
    if (entry.definitions.length === 0) {
      zone.createEl('p', { cls: 'pn-vide', text: 'No definitions parsed for this word — the Wiktionary page may use an unusual layout. Use the link above to read it directly.' });
    }
    entry.definitions.forEach((group, i) => {
      const det = zone.createEl('details', { cls: 'pn-cnrtl-details' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-cnrtl-details-titre', text: group.pos });
      const body = det.createDiv({ cls: 'pn-cnrtl-texte' });
      const numbered = group.lines.filter((l) => /^\d+\.\s/.test(l));
      const list = body.createEl('ol');
      (numbered.length > 0 ? numbered : group.lines).forEach((line) => list.createEl('li', { text: line.replace(/^\d+\.\s*/, '') }));
    });
    return true;
  }
