// ============================================================
// MODALS — rhymes / inspiration for a word selected in the editor
// (right-click menu). They reuse the view's rendering methods, which
// only depend on this.plugin. Local data only: no online lookup is
// made from a modal.
// ============================================================
class RhymeModal extends Modal {
  constructor(app, plugin, word) {
    super(app);
    this.plugin = plugin;
    this.word = word;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('poets-notebook-view');
    contentEl.createEl('h3', { text: `Rhymes for "${this.word}"` });
    const results = contentEl.createDiv({ cls: 'pn-resultats' });
    PoetsNotebookView.prototype.renderRhymeResults.call(
      { plugin: this.plugin }, results, this.word, { online: false }
    );
  }
  onClose() { this.contentEl.empty(); }
}

class InspirationModal extends Modal {
  constructor(app, plugin, word) {
    super(app);
    this.plugin = plugin;
    this.word = word;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('poets-notebook-view');
    contentEl.createEl('h3', { text: `Inspiration around "${this.word}"` });
    const results = contentEl.createDiv({ cls: 'pn-resultats' });
    PoetsNotebookView.prototype.renderInspirationResults.call(
      { plugin: this.plugin }, results, this.word, false, null
    );
  }
  onClose() { this.contentEl.empty(); }
}

// Single word from the current selection (trimmed, surrounding
// punctuation stripped), or null if the selection isn't one word.
function singleWordFromSelection(selection) {
  const w = normalizeApostrophes(selection || '').trim()
    .replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
  return w && /^[A-Za-z][A-Za-z'-]*$/.test(w) ? w : null;
}

