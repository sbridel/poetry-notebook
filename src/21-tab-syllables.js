  renderSyllablesTab(body) {
    const wrap = body.createDiv({ cls: 'pn-syllables-tab' });

    const btnRow = wrap.createDiv({ cls: 'pn-actions-row' });
    const flipBtn = btnRow.createEl('button', { cls: 'pn-icon-btn pn-icon-btn-cyan' });
    const flipIcon = flipBtn.createSpan({ text: '🔄' });
    const flipLabel = flipBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Sonorities' });
    flipBtn.createSpan({ cls: 'pn-experimental-tag', text: 'experimental' });
    flipBtn.setAttr('title', 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings). Experimental: newer and less battle-tested than the rest of this plugin — feedback welcome.');
    const rightActions = btnRow.createDiv({ cls: 'pn-actions-row-right' });
    const copyBtn = rightActions.createEl('button', { cls: 'pn-icon-btn' });
    copyBtn.createSpan({ text: '📋' });
    copyBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Copy draft' });
    const clearBtn = rightActions.createEl('button', { cls: 'pn-icon-btn' });
    clearBtn.createSpan({ text: '🗑️' });
    clearBtn.createSpan({ cls: 'pn-icon-btn-label', text: 'Clear draft' });

    const textarea = wrap.createEl('textarea', {
      cls: 'pn-textarea',
      attr: { placeholder: 'Paste your poem here, one verse per line…', rows: '8' },
    });
    if (this.plugin.draftText) textarea.value = this.plugin.draftText;

    const flipZone = wrap.createDiv({ cls: 'pn-flip-zone' });
    const flipCard = flipZone.createDiv({ cls: 'pn-flip-card' });
    const flipFront = flipCard.createDiv({ cls: 'pn-flip-face' });
    const flipBack = flipCard.createDiv({ cls: 'pn-flip-face pn-flip-back' });

    // "Rhyme colors" only makes sense on the Structure face (it colours
    // the rhyme-scheme badges below) — lives inside flipFront so it's
    // never shown while looking at Sonorities on the back face.
    const optionsRow = flipFront.createDiv({ cls: 'pn-options-row' });
    const colorLabel = optionsRow.createEl('label', { cls: 'pn-checkbox-label' });
    const colorCheckbox = colorLabel.createEl('input', { attr: { type: 'checkbox' } });
    colorCheckbox.checked = this.plugin.settings.showRhymeColors !== false;
    colorLabel.appendText(' Rhyme colors');

    const results = flipFront.createDiv({ cls: 'pn-results' });
    const summary = flipFront.createDiv({ cls: 'pn-summary' });

    const syncFlipHeight = () => {
      const activeFace = flipZone.hasClass('pn-flipped') ? flipBack : flipFront;
      requestAnimationFrame(() => { flipCard.style.height = activeFace.scrollHeight + 'px'; });
    };

    let debounceTimer = null;
    const scheduleAnalysis = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.runAnalysis(textarea.value, results, summary, colorCheckbox.checked);
        syncFlipHeight();
        if (flipZone.hasClass('pn-flipped')) renderSonoritiesBack();
      }, 250);
    };

    let renderSonoritiesBack = () => {}; // reassigned below, once dependencies are in scope

    textarea.addEventListener('input', () => {
      this.plugin.draftText = textarea.value;
      this.plugin.saveSettings();
      scheduleAnalysis();
    });

    colorCheckbox.addEventListener('change', async () => {
      this.plugin.settings.showRhymeColors = colorCheckbox.checked;
      await this.plugin.saveSettings();
      scheduleAnalysis();
    });

    flipBtn.addEventListener('click', () => {
      flipZone.toggleClass('pn-flipped', !flipZone.hasClass('pn-flipped'));
      const onBack = flipZone.hasClass('pn-flipped');
      if (onBack) renderSonoritiesBack();
      syncFlipHeight();
      flipLabel.setText(onBack ? 'Structure' : 'Sonorities');
      flipBtn.setAttr('title', onBack
        ? 'Flip back to syllables, stress and rhyme scheme'
        : 'Flip to see sound patterns (alliteration, consonant web, internal assonance, echo endings)');
      flipIcon.addClass('pn-icon-flip');
      setTimeout(() => flipIcon.removeClass('pn-icon-flip'), 600);
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textarea.value);
        new Notice('Draft copied to clipboard');
      } catch (e) {
        new Notice('Could not copy — clipboard access denied');
      }
    });

    clearBtn.addEventListener('click', async () => {
      textarea.value = '';
      this.plugin.draftText = '';
      await this.plugin.saveSettings();
      results.empty();
      summary.empty();
      if (flipZone.hasClass('pn-flipped')) renderSonoritiesBack();
      syncFlipHeight();
    });

    renderSonoritiesBack = this.buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight);

    // Live analysis on open if a draft already exists
    if (textarea.value.trim().length > 0) scheduleAnalysis();
  }

  // Builds the back-face renderer for the Sonorities flip card. Returns a
  // function to call whenever the poem text or settings change and the
  // back face is (or becomes) visible — kept separate from the front-face
  // analysis loop so the two don't re-render each other unnecessarily.
  buildSonoritiesRenderer(flipBack, textarea, syncFlipHeight) {
    const toolbar = flipBack.createDiv({ cls: 'pn-son-toolbar' });
    flipBack.createEl('p', {
      cls: 'pn-son-legend-hint',
      text: 'Experimental: this panel is newer and less tested than the rest of Poetry Notebook. Sound detection relies entirely on CMUdict — words missing from it are skipped rather than guessed at.',
    });
    const leftGroup = toolbar.createDiv({ cls: 'pn-son-toolbar-left' });
    const modeSelect = leftGroup.createEl('select');
    [['exact', 'Exact sounds'], ['simple', 'Simplified families'], ['extended', 'Extended families']]
      .forEach(([v, label]) => modeSelect.createEl('option', { attr: { value: v }, text: label }));
    modeSelect.value = 'simple';
    leftGroup.createSpan({ cls: 'pn-son-seuil-label', text: 'Threshold' });
    const seuilInput = leftGroup.createEl('input', { attr: { type: 'number', min: '2', value: '3', style: 'width:48px' } });

    const rightGroup = toolbar.createDiv({ cls: 'pn-son-toolbar-right' });
    const stopwordsLabel = rightGroup.createEl('label', { cls: 'pn-checkbox-label' });
    const stopwordsCheckbox = stopwordsLabel.createEl('input', { attr: { type: 'checkbox' } });
    stopwordsCheckbox.checked = true;
    stopwordsLabel.appendText(' Exclude stopwords');
    const top3Label = rightGroup.createEl('label', { cls: 'pn-checkbox-label' });
    const top3Checkbox = top3Label.createEl('input', { attr: { type: 'checkbox' } });
    top3Checkbox.checked = true;
    top3Label.appendText(' Highlight only the 3 most frequent');

    const legend = flipBack.createDiv({ cls: 'pn-son-legend' });
    flipBack.createEl('p', {
      cls: 'pn-son-legend-hint',
      text: 'Filled background = starts with this consonant. Underline = contains this vowel. A vowel-initial word (I, am, away, understand…) has no consonant to fill, so it can only ever be underlined — that\u2019s expected, not a bug.',
    });
    const draftDiv = flipBack.createDiv({ cls: 'pn-son-draft' });
    const jumpRow = flipBack.createDiv({ cls: 'pn-son-jump-row' });
    ['Alliteration', 'Consonant web', 'Internal assonance', 'Echo endings'].forEach((label) => {
      const pill = jumpRow.createEl('button', { cls: 'pn-tag-pill', text: label });
      pill.addEventListener('click', () => {
        const target = flipBack.querySelector(`[data-son-section="${label}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    const listDiv = flipBack.createDiv({ cls: 'pn-son-list' });

    let spotlightSon = null; // active in Consonant Web mode: click a son to isolate it in the draft

    const familyFn = (mode, isVowel) => {
      if (mode === 'exact') return null;
      return isVowel
        ? (mode === 'simple' ? (ph => VOWEL_FAMILY_SIMPLE[ph]) : (ph => VOWEL_FAMILY_EXTENDED[ph]))
        : (mode === 'simple' ? consonantFamilySimple : consonantFamilyExtended);
    };

    const colourFor = (son, isVowel) => (isVowel ? THEME_VOWEL[son] : THEME_CONSONANT[son]) || 'pn-son-c1';

    const render = () => {
      if (!this.plugin.cmudictIndex) {
        flipBack.empty();
        flipBack.createDiv({ cls: 'pn-son-empty', text: 'CMUdict is required for Sonorities — see the banner above.' });
        return;
      }
      const mode = modeSelect.value;
      const seuilMin = parseInt(seuilInput.value, 10) || 3;
      const excludeStopwords = stopwordsCheckbox.checked;
      const poemText = textarea.value;
      const result = analyzeSonorities(poemText, this.plugin.cmudictIndex, this.plugin.sonorityBaseline, { excludeStopwords, seuilMin, mode });

      // ---- legend ----
      legend.empty();
      const consFams = mode === 'exact'
        ? Array.from(new Set(result.alliteration.map((e) => e.son)))
        : Array.from(new Set(result.alliteration.map((e) => e.son)));
      const g1 = legend.createSpan({ cls: 'pn-son-legend-group' });
      g1.createSpan({ text: 'Alliteration: ' });
      consFams.forEach((f) => {
        g1.createSpan({ cls: 'pn-son-legend-dot ' + colourFor(f, false) });
        g1.createSpan({ text: f + '  ' });
      });
      const vowFams = Array.from(new Set(result.internalAssonance.map((e) => e.son)));
      const g2 = legend.createSpan({ cls: 'pn-son-legend-group' });
      g2.createSpan({ text: 'Assonance: ' });
      vowFams.forEach((f) => {
        g2.createSpan({ cls: 'pn-son-legend-underline ' + colourFor(f, true) });
        g2.createSpan({ text: f + '  ' });
      });

      // ---- draft with highlighting ----
      draftDiv.empty();
      const dominantAllit = top3Checkbox.checked ? new Set(result.alliteration.slice(0, 3).map((e) => e.son)) : null;
      const dominantAsson = top3Checkbox.checked ? new Set(result.internalAssonance.slice(0, 3).map((e) => e.son)) : null;

      const famAllitFn = familyFn(mode, false);
      const famAssonFn = familyFn(mode, true);

      poemText.split('\n').forEach((line, idxLine) => {
        const lineEl = draftDiv.createDiv({ cls: 'pn-son-line' });
        lineEl.createSpan({ cls: 'pn-son-linenum', text: String(idxLine + 1) });
        if (!line.trim()) { lineEl.createEl('br'); return; }
        const fragments = line.split(/(\s+)/);
        fragments.forEach((frag) => {
          if (!frag.trim()) { lineEl.createSpan({ text: frag }); return; }
          const wordRaw = frag.replace(/[^A-Za-z']/g, '');
          if (!wordRaw) { lineEl.createSpan({ text: frag }); return; }
          const wl = wordRaw.toLowerCase().replace(/'/g, '');
          const entry = resolveCmudictEntry(wordRaw, this.plugin.cmudictIndex);
          const isStop = excludeStopwords && STOPWORDS_EN.has(wl);

          if (spotlightSon) {
            if (!entry || isStop) { lineEl.createSpan({ cls: 'pn-son-dim', text: frag }); return; }
            const cons = allConsonantsOfEntry(entry);
            const matches = cons.filter((c) => (famAllitFn ? famAllitFn(c.ph) : c.ph) === spotlightSon);
            if (matches.length === 0) { lineEl.createSpan({ cls: 'pn-son-dim', text: frag }); return; }
            // Best-effort position: highlight the whole word (ARPAbet
            // phoneme index doesn't map cleanly back to letter offsets
            // the way orthographic scanning does in the French plugin).
            lineEl.createSpan({ cls: 'pn-son-init ' + colourFor(spotlightSon, false), text: frag });
            return;
          }

          if (!entry || isStop) { lineEl.createSpan({ text: frag }); return; }

          const initPh = initialConsonantOfEntry(entry);
          const initKey = initPh ? (famAllitFn ? famAllitFn(initPh) : initPh) : null;
          const showInit = initKey && (!dominantAllit || dominantAllit.has(initKey));

          const vows = allVowelsOfEntry(entry);
          const firstVowKey = vows.length ? (famAssonFn ? famAssonFn(vows[0].ph) : vows[0].ph) : null;
          const showVox = firstVowKey && (!dominantAsson || dominantAsson.has(firstVowKey));

          if (showInit && showVox) {
            const span = lineEl.createSpan({ cls: 'pn-son-init pn-son-vox ' + colourFor(initKey, false), text: frag });
            span.addClass(colourFor(firstVowKey, true) + '-underline');
          } else if (showInit) {
            lineEl.createSpan({ cls: 'pn-son-init ' + colourFor(initKey, false), text: frag });
          } else if (showVox) {
            lineEl.createSpan({ cls: 'pn-son-vox ' + colourFor(firstVowKey, true), text: frag });
          } else {
            lineEl.createSpan({ text: frag });
          }
        });
      });

      // ---- lists ----
      listDiv.empty();
      const renderSection = (label, subtitle, list, isVowel, clickable) => {
        const h4 = listDiv.createEl('h4', { text: label });
        h4.setAttr('data-son-section', label);
        listDiv.createEl('p', { cls: 'pn-son-subtitle', text: subtitle });
        if (list.length === 0) {
          listDiv.createDiv({ cls: 'pn-son-empty', text: 'Nothing above the current threshold.' });
          return;
        }
        list.forEach((entry) => {
          const row = listDiv.createDiv({ cls: 'pn-son-row' + (clickable ? ' pn-son-row-clickable' : '') });
          if (clickable && entry.son === spotlightSon) row.addClass('pn-son-row-active');
          const badge = row.createSpan({ cls: 'pn-son-badge ' + colourFor(entry.son, isVowel), text: entry.son.slice(0, 3) });
          const words = Array.from(new Set(entry.occurrences.map((o) => o.word)));
          const lines = Array.from(new Set(entry.occurrences.map((o) => o.line)));
          row.createSpan({ cls: 'pn-son-words', text: `${words.join(', ')} — line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` });
          row.createSpan({ cls: 'pn-son-count', text: `${entry.count} words` });
          if (entry.ratio != null) {
            const ratioSpan = row.createSpan({ cls: 'pn-son-ratio' + (entry.ratio >= 1.5 ? ' pn-son-ratio-high' : '') });
            ratioSpan.setText('×' + entry.ratio.toFixed(1));
            ratioSpan.setAttr('title', `This sound occurs ${entry.ratio.toFixed(1)}× more often in this poem than in English on average (baseline computed live from the ${this.plugin.cmudictIndex.size}-word CMUdict index loaded in this vault).`);
          }
          if (clickable) {
            row.addEventListener('click', () => {
              spotlightSon = spotlightSon === entry.son ? null : entry.son;
              render();
              syncFlipHeight();
              if (spotlightSon) requestAnimationFrame(() => draftDiv.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            });
          }
        });
      };
      renderSection('Alliteration', 'Consonant sound repeated at the start of nearby words', result.alliteration, false, false);
      renderSection('Consonant web', 'A consonant sound that recurs anywhere in a word — attack, middle, or coda — not just at the start. Click a sound to isolate it in the draft above.', result.consonantWeb, false, true);
      renderSection('Internal assonance', 'A vowel sound that recurs inside nearby words, aside from end-of-line rhyme', result.internalAssonance, true, false);
      renderSection('Echo endings', 'Word endings that echo each other mid-line, not just the established end-of-line rhyme — needs at least one occurrence away from the line end, otherwise it would just restate the rhyme scheme.', result.echoEndings.map((e) => ({ ...e, son: e.key })), false, false);

      syncFlipHeight();
    };

    modeSelect.addEventListener('change', render);
    seuilInput.addEventListener('change', render);
    stopwordsCheckbox.addEventListener('change', render);
    top3Checkbox.addEventListener('change', () => { render(); });

    return render;
  }

  meterAbbrev(meter) {
    if (!meter.name) return '?';
    if (meter.footType === 'iambic') return 'I';
    if (meter.footType === 'trochaic') return 'T';
    if (meter.footType === 'anapestic') return 'A';
    if (meter.footType === 'dactylic') return 'D';
    return '~'; // irregular / mixed
  }

  async runAnalysis(text, resultsEl, summaryEl, showColors) {
    resultsEl.empty();
    if (summaryEl) summaryEl.empty();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    // Optional Datamuse enrichment for words CMUdict doesn't know, only if allowed
    if (this.plugin.settings.allowDatamuse) {
      const allWords = new Set();
      for (const line of lines) for (const w of tokenizeLine(line)) allWords.add(w.toLowerCase());
      for (const w of allWords) {
        const key = w.replace(/[^a-z']/g, '');
        if (this.plugin.cmudictIndex && this.plugin.cmudictIndex.has(key)) continue;
        if (this.datamuseCache.has(key)) continue;
        try {
          const d = await fetchDatamuseSyllables(key);
          if (d) this.datamuseCache.set(key, d);
        } catch (e) { /* offline or API error: silently fall back to heuristic */ }
      }
    }

    const analyses = lines.map((line) => {
      const a = analyzeLine(line, this.plugin.cmudictIndex, this.datamuseCache);
      const meter = detectMeter(a.stressSeq, a.rigidSeq);
      return { line, ...a, meter };
    });

    const rhyme = detectRhymeScheme(lines, this.plugin.cmudictIndex);
    const rhymeColors = ['#e07a5f', '#3d84a8', '#81b29a', '#f2cc8f', '#9b5de5', '#00bbf9', '#f15bb5', '#fee440'];
    const letterColor = {};
    let colorIdx = 0;
    let totalSyllables = 0;

    lines.forEach((line, i) => {
      const a = analyses[i];
      totalSyllables += a.totalSyllables;
      const row = resultsEl.createDiv({ cls: 'pn-line-row' });

      const letter = rhyme.scheme[i];
      if (!(letter in letterColor)) { letterColor[letter] = rhymeColors[colorIdx % rhymeColors.length]; colorIdx++; }
      const color = (showColors && letter !== '?') ? letterColor[letter] : 'var(--text-muted)';
      row.style.borderLeftColor = color;

      const textEl = row.createSpan({ cls: 'pn-line-text', text: line });
      textEl.setAttr('title', a.words.map((w) => `${w.word}(${w.syllableCount}, ${w.source})`).join(' '));

      const badges = row.createDiv({ cls: 'pn-badges' });

      const rhymeBadge = badges.createSpan({ cls: 'pn-badge pn-rhyme-badge', text: letter });
      rhymeBadge.style.color = color;
      rhymeBadge.style.borderColor = color;
      rhymeBadge.setAttr('title', letter === '?' ? 'Rhyme unknown (word missing from CMUdict)' : `Rhyme group ${letter}`);

      const meterBadge = badges.createSpan({
        cls: `pn-badge pn-meter-badge pn-meter-${a.meter.confidence}`,
        text: this.meterAbbrev(a.meter),
      });
      meterBadge.setAttr('title', a.meter.name ? `${a.meter.name} (${a.meter.confidence})` : `Meter unknown — ${a.meter.reason}`);

      badges.createSpan({ cls: 'pn-badge pn-syll-badge', text: String(a.totalSyllables) });
    });

    if (summaryEl) {
      const avg = (totalSyllables / lines.length).toFixed(1);
      summaryEl.createSpan({ text: `${lines.length} line${lines.length > 1 ? 's' : ''}` });
      summaryEl.createSpan({ cls: 'pn-summary-total', text: `${totalSyllables} syllables` });
      summaryEl.createSpan({ text: `≈ ${avg} / line` });
    }
  }

