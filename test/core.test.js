const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/lib/core.js');

test('registrableDomain', () => {
  assert.equal(core.registrableDomain('www.theatlantic.com'), 'theatlantic.com');
  assert.equal(core.registrableDomain('theatlantic.com'), 'theatlantic.com');
  assert.equal(core.registrableDomain('a.b.nytimes.com'), 'nytimes.com');
  assert.equal(core.registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(core.registrableDomain('WWW.SMH.COM.AU.'), 'smh.com.au');
  assert.equal(core.registrableDomain('127.0.0.1'), '127.0.0.1');
});

test('unwrapUrl follows redirect wrappers', () => {
  assert.equal(core.unwrapUrl('https://www.google.com/url?q=https://www.nytimes.com/x&sa=D').hostname, 'www.nytimes.com');
  assert.equal(core.unwrapUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.wsj.com%2Fa').hostname, 'www.wsj.com');
  assert.equal(core.unwrapUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fft.com%2F').hostname, 'ft.com');
  assert.equal(core.unwrapUrl('/story/1', 'https://www.techmeme.com/').href, 'https://www.techmeme.com/story/1');
  // Same-host ?q= (a search page) is not a redirect.
  assert.equal(core.unwrapUrl('https://example.com/search?q=https://example.com/a').hostname, 'example.com');
  assert.equal(core.unwrapUrl('javascript:void(0)'), null);
});

test('domain rules match subdomains only on label boundaries', () => {
  const rule = { kind: 'domain', pattern: 'theatlantic.com', styleId: 'ban' };
  assert.ok(core.ruleMatches(rule, { host: 'www.theatlantic.com' }));
  assert.ok(core.ruleMatches(rule, { host: 'theatlantic.com' }));
  assert.ok(!core.ruleMatches(rule, { host: 'nottheatlantic.com' }));
});

test('regex rules test the full URL, or https://host/ when only the host is known', () => {
  const rule = { kind: 'regex', pattern: 'nytimes\\.com/(?!games)', styleId: 'ban' };
  assert.ok(core.ruleMatches(rule, { host: 'www.nytimes.com', url: 'https://www.nytimes.com/2026/politics' }));
  assert.ok(!core.ruleMatches(rule, { host: 'www.nytimes.com', url: 'https://www.nytimes.com/games/wordle' }));
  assert.ok(core.ruleMatches(rule, { host: 'www.nytimes.com', url: null }));
  assert.ok(!core.ruleMatches({ kind: 'regex', pattern: '(', styleId: 'x' }, { host: 'a.com' }));
});

test('findRule returns the first match', () => {
  const rules = [
    { kind: 'domain', pattern: 'cooking.nytimes.com', styleId: 'awesome' },
    { kind: 'domain', pattern: 'nytimes.com', styleId: 'ban' },
  ];
  assert.equal(core.findRule(rules, { host: 'cooking.nytimes.com' }).styleId, 'awesome');
  assert.equal(core.findRule(rules, { host: 'www.nytimes.com' }).styleId, 'ban');
  assert.equal(core.findRule(rules, { host: 'example.com' }), null);
});

test('upsertDomainRule replaces in place or prepends', () => {
  let rules = [{ kind: 'domain', pattern: 'a.com', styleId: 'ban' }];
  rules = core.upsertDomainRule(rules, 'b.com', 'demur');
  assert.deepEqual(rules.map((r) => r.pattern), ['b.com', 'a.com']);
  rules = core.upsertDomainRule(rules, 'a.com', 'awesome');
  assert.deepEqual(rules.map((r) => [r.pattern, r.styleId]), [['b.com', 'demur'], ['a.com', 'awesome']]);
});

test('removeDomainRulesFor drops matching domain rules but keeps regexes', () => {
  const rules = [
    { kind: 'domain', pattern: 'theatlantic.com', styleId: 'ban' },
    { kind: 'regex', pattern: 'theatlantic', styleId: 'ban' },
    { kind: 'domain', pattern: 'wsj.com', styleId: 'ban' },
  ];
  assert.deepEqual(core.removeDomainRulesFor(rules, 'www.theatlantic.com').map((r) => r.pattern), ['theatlantic', 'wsj.com']);
});

test('buildStylesheet', () => {
  const css = core.buildStylesheet([{ id: 'ban', before: '☢', after: '"x"', css: 'color: red; background: url(a;b); } body { display:none' }]);
  assert.match(css, /a\[data-paygate="ban"\] \{ color: red !important; background: url\(a;b\) !important; body  display:none !important \}/);
  assert.match(css, /::before \{ content: "☢" !important;/);
  assert.match(css, /::after \{ content: "\\"x\\"" !important;/);
  assert.ok(!css.includes('}  body'), 'user CSS cannot close the rule');
});

test('buildStylesheet emits card rules only when cardCss is set', () => {
  const css = core.buildStylesheet([{ id: 'ban', cardCss: 'opacity: .4' }, { id: 'meh', cardCss: '' }]);
  assert.match(css, /\[data-paygate-card="ban"\] \{ opacity: \.4 !important \}/);
  assert.ok(!css.includes('data-paygate-card="meh"'));
});

test('normalizeConfig seeds default styles', () => {
  const cfg = core.normalizeConfig(undefined);
  assert.deepEqual(cfg.styles.map((s) => s.name), ['Ban', 'Demur', 'Awesome']);
  assert.match(cfg.styles[0].cardCss, /opacity: .4; outline: 2px dashed/);
  assert.deepEqual(cfg.rules, []);
});

test('normalizeConfig fills cardCss for pre-card configs but keeps explicit blanks', () => {
  const cfg = core.normalizeConfig({ styles: [{ id: 'ban', name: 'Ban' }, { id: 'demur', cardCss: '' }, { id: 'mine' }] });
  assert.deepEqual(cfg.styles.map((s) => s.cardCss), [core.DEFAULT_STYLES[0].cardCss, '', '']);
});
