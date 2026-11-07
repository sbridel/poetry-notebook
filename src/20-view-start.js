// ============================================================
// VIEW
// ============================================================
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
    container.addClass('poets-notebook-container');

    const tabBar = container.createDiv({ cls: 'pn-tab-bar' });
    const tabs = [
      ['syllables', 'Syllables'],
      ['rhymes', 'Rhymes'],
      ['inspiration', 'Inspiration'],
      ['synonyms', 'Synonyms'],
      ['definitions', 'Definitions'],
      ['guide', 'Guide'],
      ['random', 'Random'],
      ['notes', 'Notes'],
    ];
    for (const [id, label] of tabs) {
      const btn = tabBar.createEl('button', { text: label, cls: 'pn-tab-btn' });
      if (id === this.activeTab) btn.addClass('pn-tab-active');
      btn.addEventListener('click', () => {
        this.activeTab = id;
        this.render();
      });
    }

    const body = container.createDiv({ cls: 'pn-tab-body' });

    if (!this.plugin.cmudictIndex) {
      const banner = body.createDiv({ cls: 'pn-banner' });
      banner.setText(
        'CMUdict not found in this vault. Syllable/stress accuracy will fall back to an approximate heuristic. ' +
        'Place a cmudict.dict file at the vault root, in .obsidian/, or in this plugin\'s folder, then reopen this panel.'
      );
    }

    if (this.activeTab === 'syllables') {
      this.renderSyllablesTab(body);
    } else if (this.activeTab === 'rhymes') {
      this.renderRhymesTab(body);
    } else if (this.activeTab === 'synonyms') {
      this.renderSynonymsTab(body);
    } else if (this.activeTab === 'definitions') {
      this.renderDefinitionsTab(body);
    } else if (this.activeTab === 'guide') {
      this.renderGuideTab(body);
    } else if (this.activeTab === 'inspiration') {
      this.renderInspirationTab(body);
    } else if (this.activeTab === 'random') {
      this.renderRandomTab(body);
    } else if (this.activeTab === 'notes') {
      this.renderNotesTab(body);
    } else {
      body.createDiv({ cls: 'pn-placeholder', text: 'Coming soon.' });
    }
  }

