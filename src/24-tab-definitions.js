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

    const doSearch = async () => {
      const word = wordInput.value.trim();
      results.empty();
      if (!word) return;
      syncLink();
      results.createDiv({ cls: 'pn-son-label', text: `${word} — Wiktionary` });
      const zone = results.createDiv();
      const status = zone.createEl('p', { cls: 'pn-vide', text: 'Searching…' });

      let entry = null;
      try {
        entry = await fetchWiktionaryEntry(word);
      } catch (e) {
        status.setText('Wiktionary: search impossible (no connection, site unreachable, or timeout).');
        return;
      }
      status.remove();
      const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
      if (!entry) {
        zone.createEl('p', { cls: 'pn-vide', text: `"${word}" has no English entry on Wiktionary.` });
        return;
      }
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
    };

    searchBtn.addEventListener('click', doSearch);
    wordInput.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') doSearch(); });

    this._prefillDefinitions = (word) => { wordInput.value = word; doSearch(); };
  }
