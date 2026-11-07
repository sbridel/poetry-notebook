const { group, test, assertEqual, assertTrue } = require('./framework');

// Smoke test of the panel: every tab builds, the main interactions run
// without throwing (fake DOM from mock-obsidian.js). Catches the errors
// that would leave the panel blank in Obsidian.
module.exports = function testsView(m) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const files = {};
  const app = {
    workspace: { on: () => ({}), getLeavesOfType: () => [], getActiveFile: () => null, iterateAllLeaves: () => {} },
    vault: { adapter: { exists: async () => false, read: async () => '', write: async () => {} }, getFiles: () => [], getAbstractFileByPath: () => null, read: async () => '' },
    metadataCache: { getFileCache: () => null },
  };
  const makeView = () => {
    const p = new m.PluginClass(app, { dir: 'x' });
    p.settings = { showRhymeColors: true, continuousRhymes: true, onlineSources: [], poemForm: 'shakespearean' };
    p.saveSettings = async () => {};
    p.cmudictIndex = m.idx;
    p.sonorityBaseline = m.buildPhonemeFrequencyBaseline(m.idx);
    p.personalDictionary = { synonyms: { bright: ['shining'] }, rareWords: [{ word: 'petrichor' }] };
    p.draftText = 'Shall I compare thee to a summer\'s day?\nThou art more lovely and more temperate:';
    const v = new m.PoetsNotebookView({}, p);
    v.app = app;
    return v;
  };

  group('Panel — smoke test', () => {
    test('all eight tabs build, in the French plugin\'s order', () => {
      const v = makeView();
      v.render();
      const root = v.containerEl.children[1];
      assertEqual(root.find('pn-tab').map((t) => t.text).join(), 'Syllables,Rhymes,Inspiration,Synonyms,Guide,Definitions,Random,Notes');
      assertEqual(root.find('pn-panel').length, 8);
    });
    test('Syllables: analysis, stanza totals and form checklist render', async () => {
      const v = makeView();
      v.render();
      await sleep(400);
      const syl = v.panels.syllables;
      assertEqual(syl.find('pn-ligne').length, 2);
      assertTrue(syl.find('pn-bilan-titre').length === 1, 'checklist');
      assertTrue(syl.find('pn-total-bar')[0].dump().includes('2 lines'));
    });
    test('switching tabs and prefilled searches', async () => {
      const v = makeView();
      v.render();
      v.switchTab('rhymes'); v._prefillRhymes('night'); await sleep(20);
      assertTrue(v.panels.rhymes.find('pn-mot').length > 0, 'rhyme chips');
      v._prefillInspiration('night'); await sleep(20);
      assertTrue(v.panels.inspiration.find('pn-inspi-terme').length > 0, 'inspiration words');
      v._prefillSynonyms('bright'); await sleep(20);
      assertTrue(v.panels.synonyms.dump().includes('shining'), 'saved synonym');
      v.switchTab('notes');
      assertTrue(v.panels.notes.dump().includes('petrichor'), 'notes list');
      assertTrue(v.tabButtons.notes.hasClass('active'));
    });
    test('right-click modals render', async () => {
      const v = makeView();
      const r = new m.RhymeModal(app, v.plugin, 'light'); r.open(); await sleep(20);
      assertTrue(r.contentEl.dump().includes('Perfect rhymes'));
      const i = new m.InspirationModal(app, v.plugin, 'night'); i.open(); await sleep(20);
      assertTrue(i.contentEl.dump().includes('Night & darkness'));
    });
  });
};
