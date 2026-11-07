'use strict';

const { Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, requestUrl } = require('obsidian');

const VIEW_TYPE = 'poets-notebook-view';

const DEFAULT_SETTINGS = {
  allowDatamuse: false,       // never queried without this being explicitly on
  strictRhymeMode: false,     // false = also show slant/near rhymes, kept visually separate
  cmudictPathOverride: '',    // optional explicit vault-relative path
  personalDictPathOverride: '', // optional explicit vault-relative path for the personal dictionary
  showRhymeColors: true,      // color the rhyme badges by group
};

