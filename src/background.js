importScripts('lib/core.js', 'lib/store.js');

const core = globalThis.PaygateCore;
const store = globalThis.PaygateStore;

const ROOT = 'paygate-root';
const STYLE_PREFIX = 'paygate-style:';
const REMOVE = 'paygate-remove';
const OPTIONS = 'paygate-options';

// contextMenus.removeAll/create calls can interleave if two rebuilds overlap,
// which throws duplicate-id errors; chain them.
let menuWork = Promise.resolve();
function rebuildMenus(cfg) {
  menuWork = menuWork.then(async () => {
    await chrome.contextMenus.removeAll();
    const contexts = ['link'];
    chrome.contextMenus.create({ id: ROOT, title: 'Paygate', contexts });
    for (const s of cfg.styles) {
      const marks = [s.before, s.after].filter(Boolean).join(' … ');
      chrome.contextMenus.create({ id: STYLE_PREFIX + s.id, parentId: ROOT, title: marks ? `${s.name}  ${marks}` : s.name, contexts });
    }
    chrome.contextMenus.create({ id: 'paygate-sep', parentId: ROOT, type: 'separator', contexts });
    chrome.contextMenus.create({ id: REMOVE, parentId: ROOT, title: 'Remove rule for this site', contexts });
    chrome.contextMenus.create({ id: OPTIONS, parentId: ROOT, title: 'Edit rules & styles…', contexts });
  }).catch((e) => console.warn('[paygate] menu rebuild failed', e));
  return menuWork;
}

// Ask the content script in the clicked frame for the link's real destination
// (it knows about aggregator adapters); fall back to unwrapping linkUrl here.
async function resolveTarget(info, tab) {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'paygate:resolve-context-link' }, { frameId: info.frameId || 0 });
    if (res && res.target && res.target.host) return res.target;
  } catch (e) {
    // No content script in this frame (e.g. tab predates install).
  }
  const u = core.unwrapUrl(info.linkUrl);
  return u ? { host: u.hostname, url: u.href } : null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === OPTIONS) return chrome.runtime.openOptionsPage();
  if (!tab) return;
  const target = await resolveTarget(info, tab);
  if (!target) return;
  const cfg = await store.loadOrDefault();
  if (info.menuItemId === REMOVE) {
    cfg.rules = core.removeDomainRulesFor(cfg.rules, target.host);
  } else if (String(info.menuItemId).startsWith(STYLE_PREFIX)) {
    const styleId = String(info.menuItemId).slice(STYLE_PREFIX.length);
    cfg.rules = core.upsertDomainRule(cfg.rules, core.registrableDomain(target.host), styleId);
  } else {
    return;
  }
  await store.save(cfg);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async () => {
  let cfg = await store.load();
  if (!cfg) {
    cfg = core.normalizeConfig({});
    await store.save(cfg);
  }
  rebuildMenus(cfg);
});
chrome.runtime.onStartup.addListener(() => store.loadOrDefault().then(rebuildMenus));
store.onChange(rebuildMenus);
