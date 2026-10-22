// Pure logic shared by the background worker, content script, options page and
// Node tests. No chrome.* APIs in here.
(function (root) {
  'use strict';

  const DEFAULT_STYLES = [
    { id: 'ban', name: 'Ban', before: '☢', after: '☢', css: 'color: #c62828; text-decoration: line-through;', cardCss: 'opacity: .4; outline: 2px dashed #c62828; outline-offset: 2px;' },
    { id: 'demur', name: 'Demur', before: '🤨', after: '', css: 'color: #888; font-style: italic;', cardCss: 'opacity: .7;' },
    { id: 'awesome', name: 'Awesome', before: '⭐', after: '', css: 'color: #2e7d32; font-weight: bold;', cardCss: 'box-shadow: inset 3px 0 0 #2e7d32;' },
  ];

  // Multi-label public suffixes we care about. Not the full PSL, just enough to
  // turn www.bbc.co.uk into bbc.co.uk rather than co.uk.
  const MULTI_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'org.nz', 'govt.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr',
    'co.in', 'net.in', 'org.in', 'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk',
    'com.sg', 'com.tw', 'com.tr', 'co.za', 'co.il', 'com.my', 'com.ph', 'com.pk',
  ]);

  // Query params that commonly carry the real destination of a redirect link.
  const REDIRECT_PARAMS = ['url', 'u', 'q', 'uddg', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'to', 'link'];

  function registrableDomain(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    return MULTI_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
  }

  function parseHttpUrl(s, base) {
    try {
      const u = new URL(s, base);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch (e) {
      return null;
    }
  }

  // Follow redirect-wrapper links (google.com/url?q=, l.facebook.com/l.php?u=,
  // duckduckgo /l/?uddg=, ...) to the URL they point at.
  function unwrapUrl(href, base) {
    let u = parseHttpUrl(href, base);
    for (let i = 0; u && i < 3; i++) {
      let next = null;
      for (const p of REDIRECT_PARAMS) {
        const v = u.searchParams.get(p);
        if (v && /^https?:\/\//i.test(v)) {
          next = parseHttpUrl(v);
          if (next) break;
        }
      }
      if (!next || next.hostname === u.hostname) break;
      u = next;
    }
    return u;
  }

  function hostMatchesDomain(host, domain) {
    host = String(host).toLowerCase();
    domain = String(domain).toLowerCase().replace(/^\*?\./, '');
    return host === domain || host.endsWith('.' + domain);
  }

  const regexCache = new Map();
  function compileRegex(pattern) {
    if (!regexCache.has(pattern)) {
      let re = null;
      try {
        re = new RegExp(pattern, 'i');
      } catch (e) {
        re = null;
      }
      regexCache.set(pattern, re);
    }
    return regexCache.get(pattern);
  }

  function ruleMatches(rule, target) {
    if (!rule || !rule.pattern || !target || !target.host) return false;
    if (rule.kind === 'regex') {
      const re = compileRegex(rule.pattern);
      return !!re && re.test(target.url || 'https://' + target.host + '/');
    }
    return hostMatchesDomain(target.host, rule.pattern);
  }

  // First matching rule wins; rules list order is the precedence order.
  function findRule(rules, target) {
    for (const r of rules || []) if (ruleMatches(r, target)) return r;
    return null;
  }

  // Insert or replace the domain rule for `domain`, keeping its position if it
  // already exists so precedence doesn't shuffle.
  function upsertDomainRule(rules, domain, styleId) {
    const out = (rules || []).slice();
    const i = out.findIndex((r) => r.kind !== 'regex' && r.pattern.toLowerCase() === domain);
    const rule = { kind: 'domain', pattern: domain, styleId };
    if (i >= 0) out[i] = rule;
    else out.unshift(rule);
    return out;
  }

  // Drop every domain rule that would match `host`. Regex rules are left alone
  // since they're hand-written and may cover more than this one site.
  function removeDomainRulesFor(rules, host) {
    return (rules || []).filter((r) => r.kind === 'regex' || !hostMatchesDomain(host, r.pattern));
  }

  function slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'style';
  }

  function cssString(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ') + '"';
  }

  // Split "a: b; c: url(x;y)" on top-level semicolons only.
  function splitDeclarations(css) {
    const out = [];
    let cur = '', depth = 0, quote = null;
    for (const ch of String(css || '')) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ';' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((d) => d.trim()).filter((d) => d.includes(':'));
  }

  // User CSS is declarations only; braces and angle brackets are stripped so a
  // typo can't escape the rule or the <style> element. Declarations get
  // !important because we're fighting arbitrary site stylesheets.
  function importantDeclarations(css) {
    return splitDeclarations(String(css || '').replace(/[{}<>]/g, ''))
      .map((d) => (/!important\s*$/i.test(d) ? d : d + ' !important'))
      .join('; ');
  }

  function buildStylesheet(styles, attr) {
    attr = attr || 'data-paygate';
    const out = [];
    for (const s of styles || []) {
      if (!s || !s.id) continue;
      const sel = `a[${attr}="${s.id.replace(/"/g, '')}"]`;
      out.push(`${sel} { ${importantDeclarations(s.css)} }`);
      // inline-block stops the link's text-decoration (strikethrough) running
      // through the markers.
      const marker = 'display: inline-block !important; text-decoration: none !important;';
      if (s.before) out.push(`${sel}:not([${attr}-bare])::before { content: ${cssString(s.before)} !important; ${marker} margin-right: .25em !important; }`);
      if (s.after) out.push(`${sel}:not([${attr}-bare])::after { content: ${cssString(s.after)} !important; ${marker} margin-left: .25em !important; }`);
      // Whole article card, on sites with an adapter that can find one.
      if (s.cardCss) out.push(`[${attr}-card="${s.id.replace(/"/g, '')}"] { ${importantDeclarations(s.cardCss)} }`);
    }
    return out.join('\n');
  }

  function normalizeConfig(cfg) {
    cfg = cfg || {};
    const styles = Array.isArray(cfg.styles) ? cfg.styles : DEFAULT_STYLES.map((s) => ({ ...s }));
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
    // Styles saved before cardCss existed pick up the default card CSS for
    // their id; an explicit '' (cleared by the user) is kept.
    const defaultCard = (id) => (DEFAULT_STYLES.find((d) => d.id === id) || {}).cardCss || '';
    return {
      styles: styles.filter((s) => s && s.id).map((s) => ({
        id: String(s.id), name: String(s.name || s.id), before: String(s.before || ''), after: String(s.after || ''), css: String(s.css || ''),
        cardCss: s.cardCss === undefined ? defaultCard(String(s.id)) : String(s.cardCss || ''),
      })),
      rules: rules.filter((r) => r && r.pattern).map((r) => ({ kind: r.kind === 'regex' ? 'regex' : 'domain', pattern: String(r.pattern).trim(), styleId: String(r.styleId || '') })),
    };
  }

  const api = {
    DEFAULT_STYLES, registrableDomain, parseHttpUrl, unwrapUrl, hostMatchesDomain, ruleMatches, findRule,
    upsertDomainRule, removeDomainRulesFor, slugify, splitDeclarations, buildStylesheet, normalizeConfig,
  };
  root.PaygateCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
