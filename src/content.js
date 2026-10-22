// Tags links whose destination matches a rule with data-paygate="<styleId>" and
// injects the generated stylesheet. Also remembers the last right-clicked link
// so the background worker can ask what its real destination is.
(function () {
  'use strict';
  const core = globalThis.PaygateCore;
  const store = globalThis.PaygateStore;
  const ATTR = 'data-paygate';
  const BARE = ATTR + '-bare';
  const CARD = ATTR + '-card';

  let cfg = { styles: [], rules: [] };
  let styleIds = new Set();
  let styleEl = null;
  let lastContextLink = null;
  // Per-anchor cache of the resolved target, keyed on the href it was computed for.
  const targetCache = new WeakMap();

  // --- Destination resolution -------------------------------------------------

  // Google News links are opaque /read/<token> URLs. Each article card carries a
  // faviconV2?url=https://publisher.example image, so walk up from the link to
  // the nearest ancestor holding exactly one such favicon. That ancestor is the
  // article card.
  function googleNewsTarget(a) {
    let el = a;
    for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
      const favs = el.querySelectorAll('img[src*="faviconV2"]');
      if (favs.length > 1) return null;
      if (favs.length === 1) {
        try {
          const site = new URL(favs[0].src).searchParams.get('url');
          const u = site && core.parseHttpUrl(site);
          return u ? { host: u.hostname, url: null, card: el } : null;
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  function resolveTarget(a) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return null;
    const cached = targetCache.get(a);
    if (cached && cached.href === href) return cached.target;

    let target = null;
    const u = core.unwrapUrl(href, document.baseURI);
    if (u) {
      if (u.hostname === 'news.google.com' && /\/(read|articles)\//.test(u.pathname)) target = googleNewsTarget(a);
      else target = { host: u.hostname, url: u.href };
    }
    targetCache.set(a, { href, target });
    return target;
  }

  // --- Decoration -------------------------------------------------------------

  function decorate(a) {
    const target = resolveTarget(a);
    const rule = target && core.findRule(cfg.rules, target);
    const styleId = rule && styleIds.has(rule.styleId) ? rule.styleId : null;
    if (styleId) {
      if (a.getAttribute(ATTR) !== styleId) a.setAttribute(ATTR, styleId);
      // Overlay and image-only links get the style but no text markers.
      const bare = !a.textContent.trim();
      if (bare !== a.hasAttribute(BARE)) a.toggleAttribute(BARE, bare);
    } else if (a.hasAttribute(ATTR)) {
      a.removeAttribute(ATTR);
      a.removeAttribute(BARE);
    }
    // Every link in a card resolves to the same target, so they agree on this.
    const card = target && target.card;
    if (card && card.isConnected) {
      if (styleId) {
        if (card.getAttribute(CARD) !== styleId) card.setAttribute(CARD, styleId);
      } else if (card.hasAttribute(CARD)) {
        card.removeAttribute(CARD);
      }
    }
  }

  function scan(root) {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.tagName === 'A') decorate(root);
    root.querySelectorAll('a[href]').forEach(decorate);
  }

  function applyStylesheet() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'paygate-annotate-styles';
    }
    styleEl.textContent = core.buildStylesheet(cfg.styles, ATTR);
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
  }

  function setConfig(next) {
    cfg = next;
    styleIds = new Set(cfg.styles.map((s) => s.id));
    applyStylesheet();
    scan(document);
  }

  // Batch mutation work: collect added subtrees and changed links, process once
  // per animation frame.
  const pending = new Set();
  let scheduled = false;
  function queue(node) {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const nodes = [...pending];
      pending.clear();
      for (const n of nodes) if (n.isConnected) scan(n);
      // Some SPAs replace <head>; keep our stylesheet attached.
      if (styleEl && !styleEl.isConnected) applyStylesheet();
    });
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') queue(r.target);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && queue(n));
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

  // --- Context menu support ---------------------------------------------------

  document.addEventListener('contextmenu', (e) => {
    lastContextLink = e.composedPath().find((n) => n.tagName === 'A' && n.hasAttribute('href')) || null;
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'paygate:resolve-context-link') {
      const a = lastContextLink;
      if (a) targetCache.delete(a);
      const t = a && resolveTarget(a);
      sendResponse({ target: t ? { host: t.host, url: t.url } : null });
    }
  });

  store.onChange(setConfig);
  store.loadOrDefault().then(setConfig);
})();
