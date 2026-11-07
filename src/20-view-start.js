// ============================================================
// VIEW
// Same layout as the French sibling plugin (Carnet du Poète): a title,
// a tab bar, then one panel per tab, all built once and shown/hidden on
// tab switch (so a search or a draft isn't lost when changing tabs).
// CSS classes mirror the French plugin's names with a pn- prefix, so
// both plugins share one visual language (see styles.css).
// ============================================================
const PN_TABS = [
  ['syllables', 'Syllables', 'Write or paste your verses to count syllables, detect meter and see the rhyme scheme (AABB, ABAB…).\nThe "Sonorities" side (button at the top) also shows alliteration and internal assonance.'],
  ['rhymes', 'Rhymes', 'Find rhymes for a word in CMUdict, optionally completed online by Datamuse.\nFilter by starting letter, syllable count and rhyme type.'],
  ['inspiration', 'Inspiration', 'Type a common word, get rarer, more literary vocabulary on the same theme.'],
  ['synonyms', 'Synonyms', 'Type a word to see its synonyms and antonyms.\nUseful to vary a rhyme or a rhythm without changing the meaning.'],
  ['guide', 'Guide', 'Quick reference for the prosody terms used by the plugin: meter, feet, rhyme, forms.'],
  ['definitions', 'Definitions', 'Check the exact meaning and register of a word before using it (English Wiktionary).'],
  ['random', 'Random', 'A rare or literary word drawn at random — for surprise and inspiration.\nMark it (like, exclude, free tag) to tune future draws.'],
  ['notes', 'Notes', 'Find the words in your personal dictionary that have no note yet, and add one.\nSaved directly to your personal dictionary.'],
];

class PoetsNotebookView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = 'syllables';
    this.datamuseCache = new Map();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Poet's Notebook"; }
  getIcon() { return 'feather'; }

  async onOpen() {
    this.render();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('poets-notebook-view');

    container.createEl('h2', { text: 'Poetry Notebook' });

    if (!this.plugin.cmudictIndex) {
      const banner = container.createDiv({ cls: 'pn-banner' });
      banner.setText(
        'CMUdict not found in this vault. Syllable/stress accuracy will fall back to an approximate heuristic. ' +
        'Place a cmudict.dict file at the vault root, in .obsidian/, or in this plugin\'s folder, then reopen this panel.'
      );
    }

    const tabBar = container.createDiv({ cls: 'pn-tabs' });
    this.tabButtons = {};
    this.panels = {};
    for (const [id, label, tip] of PN_TABS) {
      const btn = tabBar.createEl('button', { text: label, cls: 'pn-tab' });
      btn.setAttr('title', tip);
      btn.addEventListener('click', () => this.switchTab(id));
      this.tabButtons[id] = btn;
    }
    for (const [id] of PN_TABS) this.panels[id] = container.createDiv({ cls: 'pn-panel' });

    this.renderSyllablesTab(this.panels.syllables);
    this.renderRhymesTab(this.panels.rhymes);
    this.renderInspirationTab(this.panels.inspiration);
    this.renderSynonymsTab(this.panels.synonyms);
    this.renderGuideTab(this.panels.guide);
    this.renderDefinitionsTab(this.panels.definitions);
    this.renderRandomTab(this.panels.random);
    this.renderNotesTab(this.panels.notes);

    this.switchTab(this.activeTab);
  }

  switchTab(id) {
    this.activeTab = id;
    for (const [tid] of PN_TABS) {
      this.tabButtons[tid].toggleClass('active', tid === id);
      this.panels[tid].toggleClass('active', tid === id);
    }
    if (id === 'notes' && this._refreshNotes) this._refreshNotes();
  }

