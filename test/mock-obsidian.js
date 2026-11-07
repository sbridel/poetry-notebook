// Mock of the 'obsidian' module — enough for main.js to load outside
// Obsidian, and for the view smoke test to build every tab: a tiny fake
// DOM element with Obsidian's helpers (createDiv, createEl, setText…),
// fake Plugin/ItemView/Modal classes, and a requestUrl whose responses
// a test can set through globalThis.__fakeRequest(options).

// Browser globals the view uses.
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => fn());

class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.cls = new Set(); this.text = ''; this.value = '';
    this.checked = false; this.attrs = {}; this.listeners = {}; this.parent = null; this.parentElement = null;
    this.dataset = {}; this.open = false;
    const self = this;
    this.style = { setProperty() {} };
    this.classList = {
      toggle: (c, b) => self.toggleClass(c, b === undefined ? !self.cls.has(c) : b),
      add: (c) => self.cls.add(c), remove: (c) => self.cls.delete(c), contains: (c) => self.cls.has(c),
    };
  }
  _make(tag, o) {
    o = o || {};
    const e = new El(tag);
    e.parent = this; e.parentElement = this;
    if (o.cls) o.cls.split(' ').filter(Boolean).forEach((c) => e.cls.add(c));
    if (o.text) e.text = o.text;
    if (o.attr) Object.assign(e.attrs, o.attr);
    this.children.push(e);
    return e;
  }
  createDiv(o) { return this._make('div', o); }
  createSpan(o) { return this._make('span', o); }
  createEl(tag, o) { return this._make(tag, o); }
  empty() { this.children = []; }
  addClass(c) { this.cls.add(c); }
  removeClass(c) { this.cls.delete(c); }
  hasClass(c) { return this.cls.has(c); }
  toggleClass(c, b) { if (b) this.cls.add(c); else this.cls.delete(c); }
  setText(t) { this.text = t; }
  appendText(t) { this.createSpan({ text: t }); }
  setAttr(k, v) { this.attrs[k] = v; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  async fire(ev, arg) { for (const fn of this.listeners[ev] || []) await fn(arg || { key: 'Enter', preventDefault() {}, stopPropagation() {} }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  scrollIntoView() {}
  set innerHTML(html) { this._html = html; }
  querySelectorAll(sel) {
    if (sel.startsWith('[data-pn-word]')) return this.all().filter((e) => e.dataset.pnWord);
    const tags = sel.split(',').map((s) => s.trim());
    return this.all().filter((e) => tags.includes(e.tag));
  }
  // test helpers
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
  find(cls) { return this.all().filter((e) => e.cls.has(cls)); }
  dump() { return this.all().map((e) => e.text).filter(Boolean).join(' | '); }
}

const notices = [];
class Notice { constructor(msg) { notices.push(msg); } }
class ItemView { constructor() { this.containerEl = { children: [new El('div'), new El('div')] }; } }
class Modal { constructor(app) { this.app = app; this.contentEl = new El('div'); } open() { this.onOpen(); } close() {} }
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; this._data = {}; }
  async loadData() { return this._data; }
  async saveData(d) { this._data = d; }
  registerView(type, factory) { this._viewFactory = factory; }
  addRibbonIcon() {} addCommand() {} addSettingTab() {}
  registerEvent() {}
}
class PluginSettingTab {}
class Setting {}
async function requestUrl(options) {
  if (globalThis.__fakeRequest) return globalThis.__fakeRequest(options);
  return { status: 200, json: [] };
}

module.exports = { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, requestUrl, El, notices };
