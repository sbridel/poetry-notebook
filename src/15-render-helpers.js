// ============================================================
// SHARED RENDERING HELPERS
// English counterparts of the French plugin's display helpers (word
// chips with a syllable count, "+ N more" lists, collapsible source
// blocks, tag chips and collapsible filter sections), so every tab
// is built from the same pieces in both plugins.
// ============================================================
const WORDS_SHOWN_CAP = 15;

// A word list item is either a plain string or { word, rank } when the
// source gives a relevance (0-100, or null when unknown).
function itemText(item) { return typeof item === 'string' ? item : (item ? item.word : ''); }
function itemRank(item) { return (item && typeof item === 'object' && typeof item.rank === 'number') ? item.rank : null; }

function syllablesOfExpression(expr, cmudictIndex) {
  return (expr || '').trim().split(/\s+/).filter(Boolean)
    .reduce((n, w) => n + (lookupWord(w, cmudictIndex, null).syllableCount || 0), 0);
}

function lastWordOfExpression(expr) {
  const words = (expr || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : '';
}

// True when both words have a known rhyme key and it is the same.
function wordsRhyme(a, b, cmudictIndex) {
  const ka = rhymeKeyForWord(a, cmudictIndex);
  const kb = rhymeKeyForWord(b, cmudictIndex);
  return ka !== null && ka === kb;
}

// Syllable filter value: '' (any), '1'…'4', or '5+'.
function filterBySyllables(list, value, cmudictIndex) {
  if (!value) return list || [];
  const target = value === '5+' ? null : parseInt(value, 10);
  return (list || []).filter((w) => {
    const n = syllablesOfExpression(itemText(w), cmudictIndex);
    return target === null ? n >= 5 : n === target;
  });
}

function filterByRhyme(list, target, cmudictIndex) {
  if (!target) return list || [];
  return (list || []).filter((w) => wordsRhyme(target, lastWordOfExpression(itemText(w)), cmudictIndex));
}

function makeSyllableSelect(parent) {
  const wrap = parent.createDiv({ cls: 'pn-select-wrap' });
  const select = wrap.createEl('select', { cls: 'pn-filtre-syllabes' });
  wrap.createSpan({ cls: 'pn-select-arrow', text: '▾' });
  [['', 'Any syllables'], ['1', '1 syll.'], ['2', '2 syll.'], ['3', '3 syll.'], ['4', '4 syll.'], ['5+', '5+ syll.']]
    .forEach(([v, label]) => select.createEl('option', { attr: { value: v }, text: label }));
  return select;
}

// A toggle pill (checkbox hidden, filled when checked).
function makeTogglePill(parent, label, checked, title) {
  const lbl = parent.createEl('label', { cls: 'pn-hasard-toggle-pool' });
  const input = lbl.createEl('input', { attr: { type: 'checkbox' } });
  input.checked = !!checked;
  lbl.createSpan({ text: ' ' + label });
  if (title) lbl.setAttr('title', title);
  return input;
}

// Collapsible block for one source of results (local dictionary, Datamuse…).
function makeSourceBlock(container, title, open, local) {
  const details = container.createEl('details', { cls: 'pn-syn-source-details' + (local ? ' pn-syn-source-local' : '') });
  if (open) details.setAttr('open', 'true');
  details.createEl('summary', { cls: 'pn-syn-source-details-titre', text: title });
  return details.createDiv({ cls: 'pn-syn-source-corps' });
}

// One word chip with its syllable count as a superscript. With an
// `excluded` Set, clicking the chip toggles it in/out of that set
// (greyed + struck through) — used before saving online results.
function makeWordChip(parent, item, cls, cmudictIndex, excluded) {
  const word = itemText(item);
  const rank = itemRank(item);
  const span = parent.createSpan({ cls, text: word });
  if (rank !== null && rank >= 70) span.style.fontWeight = '700';
  span.createEl('sup', { text: String(syllablesOfExpression(word, cmudictIndex)) });
  const rankNote = rank !== null ? `Relevance (Datamuse, rescaled): ${rank}/100` : '';
  if (excluded) {
    span.addClass('pn-mot-excluable');
    span.setAttr('title', (rankNote ? rankNote + ' — ' : '') + 'click to leave this word out before saving to your personal dictionary (click again to undo).');
    span.addEventListener('click', () => {
      if (excluded.has(word)) { excluded.delete(word); span.removeClass('pn-mot-exclu'); }
      else { excluded.add(word); span.addClass('pn-mot-exclu'); }
    });
  } else if (rankNote) {
    span.setAttr('title', rankNote);
  }
  return span;
}

// Shows the first WORDS_SHOWN_CAP items, then a "+ N more" button.
function showWithLimit(parent, list, renderOne) {
  list.slice(0, WORDS_SHOWN_CAP).forEach(renderOne);
  const rest = list.slice(WORDS_SHOWN_CAP);
  if (rest.length > 0) {
    const more = parent.createEl('button', { cls: 'pn-mot-voir-plus', text: `+ ${rest.length} more` });
    more.addEventListener('click', () => { more.remove(); rest.forEach(renderOne); });
  }
}

// Titled group of word chips. opts: { type ('syno'|'anto'|null),
// excluded (Set, makes chips excludable), extraCls (on the group),
// onChip(span, word) (hook after each chip is created) }.
function makeWordGroup(container, title, list, chipCls, cmudictIndex, opts) {
  if (!list || list.length === 0) return null;
  const o = opts || {};
  const g = container.createDiv({ cls: 'pn-groupe' + (o.type ? ' pn-groupe-' + o.type : '') + (o.extraCls ? ' ' + o.extraCls : '') });
  g.createDiv({ cls: 'pn-titre', text: `${title} (${list.length})` });
  const words = g.createDiv({ cls: 'pn-mots' });
  showWithLimit(words, list, (w) => {
    const span = makeWordChip(words, w, chipCls, cmudictIndex, o.excluded);
    if (o.onChip) o.onChip(span, itemText(w));
  });
  return g;
}

// ---- tags (Random tab) ----
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return RHYME_PALETTE[hash % RHYME_PALETTE.length];
}

function makeTagChip(container, tag, onRemove) {
  const chip = container.createSpan({ cls: 'pn-tag-chip' });
  const c = tagColor(tag);
  chip.style.background = c;
  chip.style.borderColor = c;
  chip.style.color = '#fff';
  chip.createSpan({ text: tag });
  if (onRemove) {
    const x = chip.createSpan({ cls: 'pn-tag-chip-x', text: ' ×' });
    x.addEventListener('click', onRemove);
  }
  return chip;
}

// Collapsible section with a coloured frame and an "· N active" badge.
function makeCollapsibleSection(container, title, colorCls) {
  const wrap = container.createDiv({ cls: 'pn-hasard-section-repliable' + (colorCls ? ' ' + colorCls : '') });
  const header = wrap.createDiv({ cls: 'pn-hasard-section-header' });
  const caret = header.createSpan({ cls: 'pn-hasard-section-caret', text: '▸' });
  header.createSpan({ cls: 'pn-hasard-section-titre', text: title });
  const badge = header.createSpan({ cls: 'pn-hasard-section-badge' });
  const body = wrap.createDiv({ cls: 'pn-hasard-section-body' });
  body.style.display = 'none';
  let open = false;
  let countFn = () => 0;
  const render = () => {
    const n = countFn();
    badge.setText(n > 0 ? `· ${n} active` : '');
    caret.setText(open ? '▾' : '▸');
    body.style.display = open ? 'block' : 'none';
  };
  header.addEventListener('click', () => { open = !open; render(); });
  return { body, render, setCountBadge: (fn) => { countFn = fn; } };
}

// "See all tags" toggle + searchable grid of tag buttons.
function makeAllTagsPanel(container, toggleBtn, getTags, onPick, label) {
  label = label || 'See all tags';
  let open = false;
  const box = container.createDiv({ cls: 'pn-hasard-tous-tags-box' });
  box.style.display = 'none';
  const search = box.createEl('input', { cls: 'pn-hasard-tous-tags-filtre', attr: { type: 'text', placeholder: 'Filter the list…' } });
  const grid = box.createDiv({ cls: 'pn-hasard-tous-tags-grille' });
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    grid.empty();
    const tags = getTags().filter((t) => !q || t.toLowerCase().includes(q));
    if (tags.length === 0) { grid.createEl('p', { cls: 'pn-vide', text: 'No tag matches.' }); return; }
    tags.forEach((tag) => {
      const b = grid.createEl('button', { cls: 'pn-hasard-preset-btn-mini', text: tag });
      const c = tagColor(tag);
      b.style.borderColor = c;
      b.style.color = c;
      b.addEventListener('click', () => onPick(tag));
    });
  };
  search.addEventListener('input', renderGrid);
  const render = () => {
    const tags = getTags();
    toggleBtn.style.display = tags.length > 0 ? 'inline-block' : 'none';
    toggleBtn.setText(open ? 'Hide the other tags' : `${label} (${tags.length})`);
    box.style.display = open ? 'block' : 'none';
    if (open) renderGrid();
  };
  toggleBtn.addEventListener('click', () => { open = !open; render(); });
  return { render };
}

