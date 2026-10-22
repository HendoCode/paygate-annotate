// Config persistence on chrome.storage.sync. Sync caps each item at 8KB, so the
// JSON config is split across "cfg.0", "cfg.1", ... with the count in "cfg.n".
(function (root) {
  'use strict';
  const core = root.PaygateCore;
  const area = chrome.storage.sync;
  const PREFIX = 'cfg.';
  // ASCII-only JSON, at worst doubled by quote escaping, stays well under 8KB.
  const CHUNK = 3000;

  function toAsciiJson(obj) {
    return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }

  async function load() {
    const all = await area.get(null);
    const n = all[PREFIX + 'n'];
    if (typeof n !== 'number') return null;
    let json = '';
    for (let i = 0; i < n; i++) json += all[PREFIX + i] || '';
    try {
      return core.normalizeConfig(JSON.parse(json));
    } catch (e) {
      console.warn('[paygate] stored config unreadable', e);
      return null;
    }
  }

  async function loadOrDefault() {
    return (await load()) || core.normalizeConfig({});
  }

  async function save(cfg) {
    const json = toAsciiJson(core.normalizeConfig(cfg));
    const items = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CHUNK) items[PREFIX + n++] = json.slice(i, i + CHUNK);
    items[PREFIX + 'n'] = n;
    const existing = await area.get(null);
    const stale = Object.keys(existing).filter((k) => k.startsWith(PREFIX) && k !== PREFIX + 'n' && Number(k.slice(PREFIX.length)) >= n);
    await area.set(items);
    if (stale.length) await area.remove(stale);
  }

  function onChange(fn) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) loadOrDefault().then(fn);
    });
  }

  root.PaygateStore = { load, loadOrDefault, save, onChange };
})(globalThis);
