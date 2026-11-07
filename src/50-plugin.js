// ============================================================
// PLUGIN
// ============================================================
module.exports = class PoetsNotebookPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.draftText = saved && saved.draftText ? saved.draftText : '';
    this.cmudictIndex = null;
    this.personalDictionary = { synonyms: {} };
    this.personalDictionaryPath = 'poets-notebook-dictionary.json';

    await this.loadCmudict();
    await this.loadPersonalDictionary();
    // Computed once here rather than on every keystroke — scanning the
    // whole ~135k-word index is not something to redo per render.
    this.sonorityBaseline = buildPhonemeFrequencyBaseline(this.cmudictIndex);

    this.registerView(VIEW_TYPE, (leaf) => new PoetsNotebookView(leaf, this));

    this.addRibbonIcon('feather', "Poet's Notebook", () => this.activateView());
    this.addCommand({
      id: 'open-poets-notebook',
      name: "Open Poet's Notebook",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new PoetsNotebookSettingTab(this.app, this));

    // No CMUdict in the vault: fetch it once in the background.
    if (!this.cmudictIndex) this.app.workspace.onLayoutReady(() => this.fetchCmudictIfMissing());

    // Right-click on a single selected word in the editor.
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      const word = singleWordFromSelection(editor.getSelection());
      if (!word) return;
      menu.addItem((item) => item
        .setTitle(`Rhymes for "${word}"`)
        .setIcon('feather')
        .onClick(() => new RhymeModal(this.app, this, word).open()));
      menu.addItem((item) => item
        .setTitle(`Inspiration around "${word}"`)
        .setIcon('sparkles')
        .onClick(() => new InspirationModal(this.app, this, word).open()));
    }));
  }

  async loadCmudict() {
    try {
      const text = await findAndReadVaultFile(
        this.app, this.manifest, ['cmudict.dict', 'cmudict.txt'], this.settings.cmudictPathOverride
      );
      this.cmudictIndex = text ? buildCmudictIndex(text) : null;
    } catch (e) {
      console.error("Poet's Notebook: failed to load CMUdict", e);
      this.cmudictIndex = null;
    }
  }

  // Not found in the vault: download it in the background (one attempt
  // per session), then refresh the open panels.
  async fetchCmudictIfMissing() {
    if (this.cmudictIndex || this._cmudictDownloadFailed || this._cmudictDownloading) return;
    this._cmudictDownloading = true;
    new Notice("Poet's Notebook: downloading CMUdict (about 1 MB, once)…");
    try {
      const { index } = await downloadCmudict(this.app, this.manifest);
      this.cmudictIndex = index;
      this.sonorityBaseline = buildPhonemeFrequencyBaseline(index);
      new Notice(`Poet's Notebook: CMUdict installed (${index.size} words).`);
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view && leaf.view.render && leaf.view.render());
    } catch (e) {
      this._cmudictDownloadFailed = true;
      console.warn("Poet's Notebook: CMUdict download failed", e);
      new Notice("Poet's Notebook: CMUdict could not be downloaded (offline?) — approximate syllable counts for now; next try at the next start.");
    } finally {
      this._cmudictDownloading = false;
    }
  }

  // Personal dictionary: same multi-location search as CMUdict (plugin
  // folder → .obsidian/ → vault root → anywhere in the vault), since BRAT
  // only syncs main.js/manifest.json/styles.css. If nothing is found, a new
  // one is created at the vault root on first save.
  async loadPersonalDictionary() {
    try {
      const found = await findVaultFileWithPath(
        this.app, this.manifest, ['poets-notebook-dictionary.json'], this.settings.personalDictPathOverride
      );
      if (found) {
        this.personalDictionary = JSON.parse(found.text);
        if (!this.personalDictionary.synonyms) this.personalDictionary.synonyms = {};
        if (!this.personalDictionary.antonyms) this.personalDictionary.antonyms = {};
        if (!this.personalDictionary.wordMeta) this.personalDictionary.wordMeta = {};
        this.personalDictionaryPath = found.path;
      } else {
        this.personalDictionary = { synonyms: {}, antonyms: {} };
        this.personalDictionaryPath = 'poets-notebook-dictionary.json';
      }
    } catch (e) {
      console.error("Poet's Notebook: failed to load personal dictionary", e);
      this.personalDictionary = { synonyms: {}, antonyms: {} };
      this.personalDictionaryPath = 'poets-notebook-dictionary.json';
    }
  }

  async savePersonalDictionary() {
    try {
      await this.app.vault.adapter.write(this.personalDictionaryPath, JSON.stringify(this.personalDictionary, null, 2));
      return true;
    } catch (e) {
      console.error("Poet's Notebook: failed to save personal dictionary", e);
      return false;
    }
  }

  async _addWordRelation(kind, word, related) {
    const key = word.toLowerCase().trim();
    const value = related.toLowerCase().trim();
    if (!key || !value) return { ok: false, reason: 'empty' };
    if (key === value) return { ok: false, reason: 'self' };
    if (!this.personalDictionary[kind]) this.personalDictionary[kind] = {};
    if (!this.personalDictionary[kind][key]) this.personalDictionary[kind][key] = [];
    if (this.personalDictionary[kind][key].includes(value)) return { ok: true };
    this.personalDictionary[kind][key].push(value);
    const saved = await this.savePersonalDictionary();
    return { ok: saved };
  }

  async _removeWordRelation(kind, word, related) {
    const key = word.toLowerCase().trim();
    const value = related.toLowerCase().trim();
    if (!this.personalDictionary[kind] || !this.personalDictionary[kind][key]) return true;
    this.personalDictionary[kind][key] = this.personalDictionary[kind][key].filter((s) => s !== value);
    if (this.personalDictionary[kind][key].length === 0) delete this.personalDictionary[kind][key];
    return await this.savePersonalDictionary();
  }

  // ---- Random tab metadata: tags / liked / excluded, per word ----
  // Applies to any word from the pool, built-in or personal — tagging or
  // excluding a built-in word never touches its definition, it's tracked
  // entirely separately here.
  _ensureWordMetaEntry(word) {
    if (!this.personalDictionary.wordMeta) this.personalDictionary.wordMeta = {};
    const key = normalizeWordKey(word);
    if (!this.personalDictionary.wordMeta[key]) {
      this.personalDictionary.wordMeta[key] = { tags: [], liked: false, excluded: false };
    }
    return this.personalDictionary.wordMeta[key];
  }

  async addWordTag(word, tag) {
    const t = (tag || '').trim();
    if (!t) return false;
    const entry = this._ensureWordMetaEntry(word);
    if (!entry.tags.includes(t)) entry.tags.push(t);
    return this.savePersonalDictionary();
  }

  async removeWordTag(word, tag) {
    const entry = this._ensureWordMetaEntry(word);
    entry.tags = entry.tags.filter((x) => x !== tag);
    return this.savePersonalDictionary();
  }

  async toggleWordLiked(word) {
    const entry = this._ensureWordMetaEntry(word);
    entry.liked = !entry.liked;
    await this.savePersonalDictionary();
    return entry.liked;
  }

  async toggleWordExcluded(word) {
    const entry = this._ensureWordMetaEntry(word);
    entry.excluded = !entry.excluded;
    await this.savePersonalDictionary();
    return entry.excluded;
  }

  // Rare word (Random tab form, Inspiration selection). Updates the note
  // and merges tags if the word is already there. Returns true on success.
  async addRareWord(word, note, tags, opts) {
    const w = (word || '').trim();
    if (!w) return false;
    const d = this.personalDictionary;
    if (!Array.isArray(d.rareWords)) d.rareWords = [];
    const i = d.rareWords.findIndex((e) => normalizeWordKey(typeof e === 'string' ? e : e && e.word) === normalizeWordKey(w));
    if (i >= 0) {
      const e = typeof d.rareWords[i] === 'string' ? { word: d.rareWords[i] } : d.rareWords[i];
      if (note && !e.note) e.note = note;
      d.rareWords[i] = e;
    } else {
      d.rareWords.push(note ? { word: w, note } : { word: w });
    }
    for (const t of (tags || [])) this._ensureWordMetaEntry(w).tags.includes(t) || this._ensureWordMetaEntry(w).tags.push(t);
    const ok = await this.savePersonalDictionary();
    if (!(opts && opts.quiet)) new Notice(ok ? `"${w}" added to your personal dictionary.` : 'Could not save — see console.');
    return ok;
  }

  // Adds words to a personal vocabulary theme, creating it (with the given
  // trigger words) if needed. Returns how many words were new.
  async addThemeWords(theme, triggers, words) {
    const d = this.personalDictionary;
    if (!Array.isArray(d.vocabularyThemes)) d.vocabularyThemes = [];
    let t = d.vocabularyThemes.find((x) => x && (x.theme || '').toLowerCase() === theme.toLowerCase());
    if (!t) {
      t = { theme, triggers: triggers.length ? triggers : [theme.toLowerCase()], words: [] };
      d.vocabularyThemes.push(t);
    } else if (triggers.length) {
      t.triggers = Array.from(new Set([...(t.triggers || []), ...triggers]));
    }
    if (!Array.isArray(t.words)) t.words = [];
    const have = new Set(t.words.map((e) => normalizeWordKey(typeof e === 'string' ? e : e && e.word)));
    let n = 0;
    for (const { word, note } of words) {
      if (have.has(normalizeWordKey(word))) continue;
      t.words.push(note ? { word, note } : { word });
      have.add(normalizeWordKey(word));
      n++;
    }
    await this.savePersonalDictionary();
    return n;
  }

  // Remembers which online sources are ticked, per tab ('rhymes',
  // 'inspiration', 'synonyms'), like the French plugin does.
  async setOnlineSource(kind, on) {
    const set = new Set(this.settings.onlineSources || []);
    if (on) set.add(kind); else set.delete(kind);
    this.settings.onlineSources = [...set];
    await this.saveSettings();
  }

  async addSynonymToPersonalDictionary(word, synonym) {
    return this._addWordRelation('synonyms', word, synonym);
  }

  async removeSynonymFromPersonalDictionary(word, synonym) {
    return this._removeWordRelation('synonyms', word, synonym);
  }

  async addAntonymToPersonalDictionary(word, antonym) {
    return this._addWordRelation('antonyms', word, antonym);
  }

  async removeAntonymFromPersonalDictionary(word, antonym) {
    return this._removeWordRelation('antonyms', word, antonym);
  }

  async saveSettings() {
    await this.saveData({ ...this.settings, draftText: this.draftText });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload() {
    // views are cleaned up by Obsidian automatically
  }
};
