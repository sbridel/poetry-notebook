  // ---- Syllables tab ----
  // Same structure as the French plugin's Syllabes tab: action bar
  // (Sonorities flip + Export / Copy / Active note / Clear), the draft,
  // then a flip card — Structure on the front (options, one row per line,
  // stanza schemes, totals), Sonorities on the back.
  renderSyllablesTab(panel) {
    const actionsBar = panel.createDiv({ cls: 'pn-toolbar-actions' });
    const flipBtn = actionsBar.createEl('button', { cls: 'pn-icon-btn pn-icon-btn-pill pn-icon-btn-cyan' });
    const flipIcon = flipBtn.createSpan({ text: '🔄' });
    const flipLabel = flipBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Sonorities' });
    flipBtn.createSpan({ cls: 'pn-experimental-tag', text: 'experimental' });
    flipBtn.setAttr('title', 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings). Experimental: newer and less battle-tested than the rest of this plugin — feedback welcome.');
    const saveState = actionsBar.createSpan({ cls: 'pn-save-state' });
    const mkBtn = (icon, label, title) => {
      const b = actionsBar.createEl('button', { cls: 'pn-icon-btn' });
      b.createSpan({ text: icon });
      b.createSpan({ cls: 'pn-icon-btn-label', text: label });
      b.setAttr('title', title);
      b.setAttr('aria-label', title);
      return b;
    };
    const exportBtn = mkBtn('⬇', 'Export', 'Copy the analysis as a Markdown table');
    const copyBtn = mkBtn('⎘', 'Copy', 'Copy the draft');
    const noteBtn = mkBtn('📄', 'Active note', 'Load into the draft the selection in the open note, else its first ```poem block, else the whole note (Markdown syntax removed).');
    const clearBtn = mkBtn('🗑️', 'Clear', 'Clear the draft');

    const textarea = panel.createEl('textarea', {
      cls: 'pn-textarea',
      attr: { placeholder: 'Write or paste your verses here, one per line…' },
    });
    if (this.plugin.draftText) textarea.value = this.plugin.draftText;

    const flipZone = panel.createDiv({ cls: 'pn-flip-zone' });
    const flipCard = flipZone.createDiv({ cls: 'pn-flip-card' });
    const flipFront = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-front' });
    const flipBack = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-back' });

    const toolbar = flipFront.createDiv({ cls: 'pn-toolbar' });
    const mkToggle = (parent, label, checked, title) => {
      const lbl = parent.createEl('label', { cls: 'pn-hasard-toggle-pool' });
      const input = lbl.createEl('input', { attr: { type: 'checkbox' } });
      input.checked = checked;
      lbl.createSpan({ text: ' ' + label });
      if (title) lbl.setAttr('title', title);
      return input;
    };
    const colorsToggle = mkToggle(toolbar, 'Rhyme colors', this.plugin.settings.showRhymeColors !== false);
    const continuousToggle = mkToggle(toolbar, 'Continuous rhymes across stanzas', this.plugin.settings.continuousRhymes !== false,
      'By default each stanza starts again at A. Check to carry the letters on from one stanza to the next (useful for sonnets: ABAB CDCD EFEF GG rather than ABAB ABAB…).');

    const analysisDiv = flipFront.createDiv({ cls: 'pn-analyse' });
    const schemaDiv = flipFront.createDiv({ cls: 'pn-schema-rimes' });
    const totalBar = flipFront.createDiv({ cls: 'pn-total-bar' });
    totalBar.style.display = 'none';

    const syncFlipHeight = () => {
      const activeFace = flipZone.hasClass('flipped') ? flipBack : flipFront;
      requestAnimationFrame(() => { flipCard.style.height = activeFace.scrollHeight + 'px'; });
    };

    let renderSonoritiesBack = () => {};
    let debounceTimer = null;
    const scheduleAnalysis = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await this.runAnalysis(textarea.value, analysisDiv, schemaDiv, totalBar,
          colorsToggle.checked, continuousToggle.checked);
        syncFlipHeight();
        if (flipZone.hasClass('flipped')) renderSonoritiesBack();
      }, 250);
    };

    let saveTimer = null;
    const saveDraft = () => {
      this.plugin.draftText = textarea.value;
      saveState.setText('…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await this.plugin.saveSettings();
        saveState.setText('draft saved');
        setTimeout(() => saveState.setText(''), 1200);
      }, 700);
    };

    textarea.addEventListener('input', () => { saveDraft(); scheduleAnalysis(); });

    colorsToggle.addEventListener('change', async () => {
      this.plugin.settings.showRhymeColors = colorsToggle.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });
    continuousToggle.addEventListener('change', async () => {
      this.plugin.settings.continuousRhymes = continuousToggle.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });

    flipBtn.addEventListener('click', () => {
      flipZone.toggleClass('flipped', !flipZone.hasClass('flipped'));
      const onBack = flipZone.hasClass('flipped');
      if (onBack) renderSonoritiesBack();
      syncFlipHeight();
      flipLabel.setText(onBack ? 'Structure' : 'Sonorities');
      flipBtn.setAttr('title', onBack
        ? 'Flip back to syllables, meter and rhyme scheme'
        : 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings)');
      flipIcon.addClass('pn-icon-flip');
      setTimeout(() => flipIcon.removeClass('pn-icon-flip'), 600);
    });

    exportBtn.addEventListener('click', async () => {
      const poem = analyzePoem(textarea.value, this.plugin.cmudictIndex, this.datamuseCache, continuousToggle.checked);
      const rows = poem.lines.filter((l) => !l.empty);
      if (rows.length === 0) { new Notice('Nothing to export.'); return; }
      let md = '| Line | Syllables | Meter | Rhyme |\n| --- | --- | --- | --- |\n';
      rows.forEach((l) => {
        md += `| ${l.text.trim().replace(/\|/g, '\\|')} | ${l.totalSyllables} | ${meterLabel(l.meter) || ''} | ${l.letter && l.letter !== '?' ? l.letter : ''} |\n`;
      });
      try {
        await navigator.clipboard.writeText(md);
        new Notice('Analysis copied as Markdown — paste it wherever you like.');
      } catch (e) {
        new Notice('Could not copy automatically; see the console for the generated Markdown.');
        console.log(md);
      }
    });

    copyBtn.addEventListener('click', async () => {
      if (!textarea.value.trim()) { new Notice('The draft is empty.'); return; }
      try {
        await navigator.clipboard.writeText(textarea.value);
        new Notice('Draft copied to clipboard.');
      } catch (e) {
        new Notice('Could not copy automatically (see the console).');
        console.log(textarea.value);
      }
    });

    noteBtn.addEventListener('click', async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') { new Notice("Poet's Notebook: no Markdown note is open."); return; }
      const content = await this.app.vault.read(file);
      let selection = '';
      this.app.workspace.iterateAllLeaves((leaf) => {
        const v = leaf.view;
        if (!selection && v && v.file === file && v.editor && typeof v.editor.getSelection === 'function') {
          selection = v.editor.getSelection() || '';
        }
      });
      const extract = extractPoemFromNote(content, selection);
      if (!extract.text) { new Notice("Poet's Notebook: nothing to load (note empty after cleanup)."); return; }
      textarea.value = extract.text;
      saveDraft();
      scheduleAnalysis();
      new Notice(`Poet's Notebook: "${file.basename}" loaded into the draft (${extract.source}).`);
    });

    clearBtn.addEventListener('click', async () => {
      textarea.value = '';
      this.plugin.draftText = '';
      await this.plugin.saveSettings();
      analysisDiv.empty();
      schemaDiv.empty();
      totalBar.style.display = 'none';
      if (flipZone.hasClass('flipped')) renderSonoritiesBack();
      syncFlipHeight();
    });

    renderSonoritiesBack = this.buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight);

    if (textarea.value.trim().length > 0) scheduleAnalysis();
  }

  // Back face of the flip card (Sonorities). Returns a render function to
  // call whenever the draft or settings change while the back is visible.
  buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight) {
    const toolbar = flipBack.createDiv({ cls: 'pn-toolbar' });
    const modeWrap = toolbar.createDiv({ cls: 'pn-select-wrap' });
    const modeSelect = modeWrap.createEl('select', { cls: 'pn-son-mode-select' });
    [['exact', 'Exact sounds'], ['simple', 'Simplified families'], ['extended', 'Extended families']]
      .forEach(([v, label]) => modeSelect.createEl('option', { attr: { value: v }, text: label }));
    modeWrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
    modeSelect.value = 'simple';
    modeSelect.setAttr('title', 'Exact sounds: each distinct ARPAbet phoneme. Simplified families: few groups, easiest to read. Extended families: fuller classification (e.g. voiced/voiceless stops apart) — more precise, more colours.');
    const seuilLabel = toolbar.createDiv({ cls: 'pn-son-seuil' });
    seuilLabel.createSpan({ text: 'Threshold ' });
    const seuilInput = seuilLabel.createEl('input', { attr: { type: 'number', min: '2', max: '9', value: '3' } });
    const mkToggle = (label, checked, title) => {
      const lbl = toolbar.createEl('label', { cls: 'pn-hasard-toggle-pool' });
      const input = lbl.createEl('input', { attr: { type: 'checkbox' } });
      input.checked = checked;
      lbl.createSpan({ text: ' ' + label });
      if (title) lbl.setAttr('title', title);
      return input;
    };
    const stopwordsToggle = mkToggle('Exclude stopwords', true);
    const top3Toggle = mkToggle('Highlight only the 3 most frequent', true,
      'The list stays complete; only the highlighting in the draft is limited to the 3 most frequent alliterations and assonances, for a less busy text.');

    flipBack.createEl('p', {
      cls: 'pn-son-soustitre',
      text: 'Experimental: sound detection relies entirely on CMUdict — words missing from it are skipped rather than guessed at. Filled background = starts with this consonant; underline = contains this vowel (a vowel-initial word can only ever be underlined).',
    });
    const legendDiv = flipBack.createDiv({ cls: 'pn-son-legende' });
    const draftDiv = flipBack.createDiv({ cls: 'pn-son-brouillon' });
    const jumpsDiv = flipBack.createDiv({ cls: 'pn-son-sauts' });
    const listDetails = flipBack.createEl('details', { cls: 'pn-son-liste-details' });
    listDetails.createEl('summary', { text: 'See the detail by sound' });
    const listDiv = listDetails.createDiv({ cls: 'pn-son-liste' });
    const sectionTitleEls = {};
    const SECTIONS = ['Alliteration', 'Internal assonance', 'Consonant web', 'Echo endings'];
    SECTIONS.forEach((title) => {
      const btn = jumpsDiv.createEl('button', { cls: 'pn-hasard-toggle-pool', text: title });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        listDetails.setAttr('open', 'true');
        requestAnimationFrame(() => {
          syncFlipHeight();
          if (sectionTitleEls[title]) sectionTitleEls[title].scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    });

    let spotlightSon = null; // Consonant web: click a sound to isolate it in the draft

    const familyFn = (mode, isVowel) => {
      if (mode === 'exact') return null;
      return isVowel
        ? (mode === 'simple' ? (ph => VOWEL_FAMILY_SIMPLE[ph]) : (ph => VOWEL_FAMILY_EXTENDED[ph]))
        : (mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
    };
    const colourFor = (son, isVowel) => (isVowel ? THEME_VOWEL[son] : THEME_CONSONANT[son]) || 'pn-son-c1';

    const render = () => {
      if (!this.plugin.cmudictIndex) {
        legendDiv.empty(); draftDiv.empty(); listDiv.empty();
        legendDiv.createSpan({ cls: 'pn-son-vide', text: 'CMUdict is required for Sonorities — see the banner above.' });
        syncFlipHeight();
        return;
      }
      const mode = modeSelect.value;
      const seuilMin = parseInt(seuilInput.value, 10) || 3;
      const excludeStopwords = stopwordsToggle.checked;
      const poemText = textarea.value;
      const result = analyzeSonorities(poemText, this.plugin.cmudictIndex, this.plugin.sonorityBaseline, { excludeStopwords, seuilMin, mode });

      const highlighted = top3Toggle.checked
        ? { alliteration: result.alliteration.slice(0, 3), internalAssonance: result.internalAssonance.slice(0, 3) }
        : result;

      // ---- legend: only the sounds actually highlighted below ----
      legendDiv.empty();
      const addLegendGroup = (title, list, isVowel) => {
        if (list.length === 0) return;
        const group = legendDiv.createDiv({ cls: 'pn-son-legende-groupe' });
        group.createSpan({ cls: 'pn-son-legende-titre', text: title + ': ' });
        list.forEach((entry) => {
          const chip = group.createSpan({ cls: 'pn-son-legende-puce' });
          chip.createSpan({ cls: 'pn-son-legende-couleur ' + (isVowel ? 'pn-son-legende-vox ' : '') + colourFor(entry.son, isVowel) });
          chip.createSpan({ cls: 'pn-son-legende-texte', text: entry.son });
        });
      };
      addLegendGroup('Alliteration', highlighted.alliteration, false);
      addLegendGroup('Assonance', highlighted.internalAssonance, true);
      if (highlighted.alliteration.length === 0 && highlighted.internalAssonance.length === 0) {
        legendDiv.createSpan({ cls: 'pn-son-vide', text: 'No pattern above the current threshold.' });
      }

      // ---- draft with highlighting (whole words: CMUdict gives phonemes,
      // not letter positions) ----
      draftDiv.empty();
      const dominantAllit = new Set(highlighted.alliteration.map((e) => e.son));
      const dominantAsson = new Set(highlighted.internalAssonance.map((e) => e.son));
      const famAllitFn = familyFn(mode, false);
      const famAssonFn = familyFn(mode, true);

      poemText.split('\n').forEach((line, idxLine) => {
        const lineEl = draftDiv.createDiv({ cls: 'pn-son-brouillon-ligne' });
        lineEl.createSpan({ cls: 'pn-son-brouillon-numero', text: String(idxLine + 1) });
        if (!line.trim()) { lineEl.createEl('br'); return; }
        line.split(/(\s+)/).forEach((frag) => {
          if (!frag.trim()) { lineEl.createSpan({ text: frag }); return; }
          const wordRaw = frag.replace(/[^A-Za-z']/g, '');
          const wl = wordRaw.toLowerCase().replace(/'/g, '');
          const entry = wordRaw ? resolveCmudictEntry(wordRaw, this.plugin.cmudictIndex) : null;
          const isStop = excludeStopwords && STOPWORDS_EN.has(wl);

          if (spotlightSon) {
            if (!entry || isStop) { lineEl.createSpan({ cls: 'pn-son-brouillon-dim', text: frag }); return; }
            const matches = allConsonantsOfEntry(entry).filter((c) => (famAllitFn ? famAllitFn(c.ph) : c.ph) === spotlightSon);
            lineEl.createSpan({
              cls: matches.length ? 'pn-son-surligne-init ' + colourFor(spotlightSon, false) : 'pn-son-brouillon-dim',
              text: frag,
            });
            return;
          }
          if (!entry || isStop) { lineEl.createSpan({ text: frag }); return; }

          const initPh = initialConsonantOfEntry(entry);
          const initKey = initPh ? (famAllitFn ? famAllitFn(initPh) : initPh) : null;
          const showInit = initKey && dominantAllit.has(initKey);
          const vows = allVowelsOfEntry(entry);
          const vowKey = vows.length ? (famAssonFn ? famAssonFn(vows[0].ph) : vows[0].ph) : null;
          const showVox = vowKey && dominantAsson.has(vowKey);

          if (showInit && showVox) {
            lineEl.createSpan({ cls: `pn-son-surligne-init ${colourFor(initKey, false)} ${colourFor(vowKey, true)}-underline`, text: frag });
          } else if (showInit) {
            lineEl.createSpan({ cls: 'pn-son-surligne-init ' + colourFor(initKey, false), text: frag });
          } else if (showVox) {
            lineEl.createSpan({ cls: 'pn-son-surligne-vox ' + colourFor(vowKey, true), text: frag });
          } else {
            lineEl.createSpan({ text: frag });
          }
        });
      });

      // ---- lists ----
      listDiv.empty();
      const renderSection = (title, subtitle, list, isVowel, onClick) => {
        const h4 = listDiv.createEl('h4', { text: title });
        sectionTitleEls[title] = h4;
        listDiv.createEl('p', { cls: 'pn-son-soustitre', text: subtitle });
        if (list.length === 0) {
          listDiv.createEl('p', { cls: 'pn-son-vide', text: 'No pattern above the current threshold.' });
          return;
        }
        list.forEach((entry) => {
          const row = listDiv.createDiv({ cls: 'pn-son-ligne' });
          const badge = row.createSpan({ cls: 'pn-son-badge ' + colourFor(entry.son, isVowel), text: entry.son.slice(0, 3) });
          badge.setAttr('title', entry.son);
          const words = Array.from(new Set(entry.occurrences.map((o) => o.word)));
          const lines = Array.from(new Set(entry.occurrences.map((o) => o.line)));
          row.createSpan({ cls: 'pn-son-mots', text: `${words.join(', ')} — line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` });
          row.createSpan({ cls: 'pn-son-count', text: `${entry.count} words` });
          if (entry.ratio != null) {
            const ratioSpan = row.createSpan({ cls: 'pn-son-ratio' + (entry.ratio >= 1.5 ? ' pn-son-ratio-fort' : '') });
            ratioSpan.setText('×' + entry.ratio.toFixed(1));
            ratioSpan.setAttr('title', `This sound occurs ${entry.ratio.toFixed(1)}× more often in this poem than in English on average (baseline computed live from the ${this.plugin.cmudictIndex.size}-word CMUdict index loaded in this vault).`);
          }
          if (onClick) {
            row.addClass('pn-son-ligne-cliquable');
            row.setAttr('title', 'Click to isolate this sound in the draft above.');
            if (entry.son === spotlightSon) row.addClass('pn-son-ligne-active');
            row.addEventListener('click', () => onClick(entry.son));
          }
        });
      };
      renderSection('Alliteration', 'Consonant sound repeated at the start of nearby words', result.alliteration, false);
      renderSection('Internal assonance', 'A vowel sound that recurs inside nearby words, aside from end-of-line rhyme', result.internalAssonance, true);
      renderSection('Consonant web', 'A consonant sound that recurs anywhere in a word — attack, middle, or coda — not just at the start. Click a sound to isolate it in the draft.', result.consonantWeb, false, (son) => {
        spotlightSon = spotlightSon === son ? null : son;
        render();
        syncFlipHeight();
        if (spotlightSon) requestAnimationFrame(() => draftDiv.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
      renderSection('Echo endings', 'Word endings that echo each other away from the line end — needs at least one mid-line occurrence, otherwise it would just restate the rhyme scheme.', result.echoEndings.map((e) => ({ ...e, son: e.key })), false);

      syncFlipHeight();
    };

    const rerender = () => { render(); syncFlipHeight(); };
    modeSelect.addEventListener('change', rerender);
    seuilInput.addEventListener('change', rerender);
    stopwordsToggle.addEventListener('change', rerender);
    top3Toggle.addEventListener('change', rerender);
    listDetails.addEventListener('toggle', syncFlipHeight);

    return render;
  }

  async runAnalysis(text, analysisDiv, schemaDiv, totalBar, showColors, continuous) {
    analysisDiv.empty();
    schemaDiv.empty();
    const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) { totalBar.style.display = 'none'; return; }

    // Optional Datamuse enrichment for words CMUdict doesn't know, only if allowed
    if (this.plugin.settings.allowDatamuse) {
      const allWords = new Set();
      for (const line of nonEmpty) for (const w of tokenizeLine(line)) allWords.add(w.toLowerCase());
      for (const w of allWords) {
        const key = w.replace(/[^a-z']/g, '');
        if (this.plugin.cmudictIndex && this.plugin.cmudictIndex.has(key)) continue;
        if (this.datamuseCache.has(key)) continue;
        try {
          const d = await fetchDatamuseSyllables(key);
          if (d) this.datamuseCache.set(key, d);
        } catch (e) { /* offline or API error: silently fall back to heuristic */ }
      }
      analysisDiv.empty();
      schemaDiv.empty();
    }

    const poem = analyzePoem(text, this.plugin.cmudictIndex, this.datamuseCache, continuous);
    let total = 0, count = 0;

    poem.lines.forEach((l) => {
      if (l.empty) return;
      count++;
      total += l.totalSyllables;
      const color = l.colorIdx !== null ? RHYME_PALETTE[l.colorIdx % RHYME_PALETTE.length] : null;

      const lineEl = analysisDiv.createDiv({ cls: 'pn-ligne' });
      const top = lineEl.createDiv({ cls: 'pn-ligne-top' });
      const textSpan = top.createSpan({ cls: 'pn-texte', text: l.text.trim() });
      textSpan.setAttr('title', l.words.map((w) => `${w.word}(${w.syllableCount}, ${w.source})`).join(' '));
      if (showColors && color) {
        textSpan.style.borderLeft = `3px solid ${color}`;
        textSpan.style.paddingLeft = '6px';
      }

      const badges = top.createDiv({ cls: 'pn-badges' });
      if (showColors && l.letter) {
        const rhymeBadge = badges.createSpan({ cls: 'pn-rime-lettre', text: l.letter });
        const c = color || 'var(--text-muted)';
        rhymeBadge.style.color = c;
        rhymeBadge.style.borderColor = c;
        rhymeBadge.setAttr('title', l.letter === '?' ? 'Rhyme unknown (word missing from CMUdict)' : `Rhyme group ${l.letter}`);
      }
      const label = meterLabel(l.meter);
      if (label) {
        const meterPill = badges.createSpan({ cls: 'pn-metre', text: label });
        meterPill.setAttr('title', l.meter.confidence === 'none'
          ? `No regular foot pattern (stresses: ${l.meter.rawPattern || '?'})`
          : `${label} (${l.meter.confidence === 'exact' ? 'exact match' : 'approximate: some flexible syllables'})`);
      }
      badges.createSpan({ cls: 'pn-compte', text: String(l.totalSyllables) });
    });

    if (poem.stanzas.some((s) => s.name) || poem.stanzas.length > 1) {
      poem.stanzas.forEach((s, i) => {
        const row = schemaDiv.createDiv({ cls: 'pn-schema-ligne' });
        const prefix = poem.stanzas.length > 1 ? `Stanza ${i + 1}: ` : 'Scheme: ';
        row.createSpan({ text: prefix + s.letters.join('') });
        if (s.name) row.createSpan({ cls: 'pn-metre', text: s.name });
      });
    }

    totalBar.style.display = 'flex';
    totalBar.empty();
    totalBar.createSpan({ text: `${count} line${count > 1 ? 's' : ''}` });
    totalBar.createEl('strong', { text: `${total} syllables` });
    totalBar.createSpan({ text: `≈ ${(total / count).toFixed(1)} / line` });
  }
