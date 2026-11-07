// ============================================================
// SETTINGS TAB
// ============================================================
class PoetsNotebookSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: "Poet's Notebook settings" });

    new Setting(containerEl)
      .setName('Allow Datamuse online lookups')
      .setDesc('When a word is missing from CMUdict, query the free Datamuse API for its syllable count. Off by default — the plugin works fully offline otherwise.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.allowDatamuse)
        .onChange(async (v) => { this.plugin.settings.allowDatamuse = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Strict rhyme mode')
      .setDesc('When off, near/slant rhymes are also shown, in a visually separate section, never mixed with perfect rhymes.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.strictRhymeMode)
        .onChange(async (v) => { this.plugin.settings.strictRhymeMode = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Custom CMUdict path (optional)')
      .setDesc('Vault-relative path to cmudict.dict. Leave empty to auto-search the plugin folder, .obsidian/, the vault root, and the whole vault.')
      .addText((t) => t
        .setValue(this.plugin.settings.cmudictPathOverride)
        .onChange(async (v) => { this.plugin.settings.cmudictPathOverride = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reload CMUdict')
      .setDesc('Re-scan the vault for cmudict.dict after adding or moving the file. If none is found, it is downloaded from this plugin\'s GitHub release.')
      .addButton((b) => b
        .setButtonText('Reload')
        .onClick(async () => {
          await this.plugin.loadCmudict();
          this.plugin.sonorityBaseline = buildPhonemeFrequencyBaseline(this.plugin.cmudictIndex);
          if (this.plugin.cmudictIndex) {
            new Notice(`CMUdict loaded: ${this.plugin.cmudictIndex.size} words`);
          } else {
            this.plugin._cmudictDownloadFailed = false;
            await this.plugin.fetchCmudictIfMissing();
          }
        }));

    containerEl.createEl('h3', { text: 'Personal dictionary' });

    new Setting(containerEl)
      .setName('Custom personal dictionary path (optional)')
      .setDesc('Vault-relative path to poets-notebook-dictionary.json. Leave empty to auto-search, or to create a new one at the vault root the first time you save a synonym.')
      .addText((t) => t
        .setValue(this.plugin.settings.personalDictPathOverride)
        .onChange(async (v) => { this.plugin.settings.personalDictPathOverride = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reload personal dictionary')
      .setDesc('Re-scan the vault after adding or moving poets-notebook-dictionary.json.')
      .addButton((b) => b
        .setButtonText('Reload')
        .onClick(async () => {
          await this.plugin.loadPersonalDictionary();
          const count = Object.keys(this.plugin.personalDictionary.synonyms || {}).length;
          new Notice(`Personal dictionary loaded from ${this.plugin.personalDictionaryPath} (${count} word${count === 1 ? '' : 's'})`);
        }));
  }
}

