(function () {
  'use strict';
  const core = globalThis.PaygateCore;
  const store = globalThis.PaygateStore;
  const $ = (sel) => document.querySelector(sel);

  let cfg = { styles: [], rules: [] };
  let dirty = false;

  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    for (const c of children) e.append(c);
    return e;
  }

  function setDirty(d) {
    dirty = d;
    $('#status').textContent = d ? 'Unsaved changes' : '';
    $('#status').classList.toggle('dirty', d);
  }

  function changed() {
    setDirty(true);
    $('#preview-styles').textContent = core.buildStylesheet(cfg.styles, 'data-paygate');
  }

  function uniqueStyleId(base) {
    const ids = new Set(cfg.styles.map((s) => s.id));
    let id = core.slugify(base), n = 2;
    while (ids.has(id)) id = core.slugify(base) + '-' + n++;
    return id;
  }

  // --- Styles -----------------------------------------------------------------

  function renderStyles() {
    const tbody = $('#styles tbody');
    tbody.replaceChildren();
    cfg.styles.forEach((s, i) => {
      const bind = (field, input) => {
        input.value = s[field];
        input.addEventListener('input', () => {
          s[field] = input.value;
          changed();
          if (field === 'name') renderRules();
        });
        return input;
      };
      const preview = el('a', { className: 'preview', href: '#', textContent: 'Example headline' });
      preview.setAttribute('data-paygate', s.id);
      preview.addEventListener('click', (e) => e.preventDefault());
      const del = el('button', { type: 'button', className: 'icon', title: 'Delete style', textContent: '✕' });
      del.addEventListener('click', () => {
        cfg.styles.splice(i, 1);
        changed();
        render();
      });
      tbody.append(el('tr', {},
        el('td', {}, bind('name', el('input', { type: 'text' }))),
        el('td', {}, bind('before', el('input', { type: 'text' }))),
        el('td', {}, bind('after', el('input', { type: 'text' }))),
        el('td', {}, bind('css', el('textarea', { spellcheck: false }))),
        el('td', {}, preview),
        el('td', {}, del)));
    });
  }

  // --- Rules ------------------------------------------------------------------

  function validatePattern(input, rule) {
    let ok = !!rule.pattern;
    if (ok && rule.kind === 'regex') {
      try { new RegExp(rule.pattern); } catch (e) { ok = false; }
    }
    input.classList.toggle('invalid', !ok);
  }

  function renderRules() {
    const tbody = $('#rules tbody');
    const filter = $('#rule-filter').value.trim().toLowerCase();
    tbody.replaceChildren();
    cfg.rules.forEach((r, i) => {
      if (filter && !r.pattern.toLowerCase().includes(filter)) return;
      const move = (delta) => {
        const j = i + delta;
        if (j < 0 || j >= cfg.rules.length) return;
        [cfg.rules[i], cfg.rules[j]] = [cfg.rules[j], cfg.rules[i]];
        changed();
        renderRules();
      };
      const up = el('button', { type: 'button', className: 'icon', title: 'Move up', textContent: '↑' });
      const down = el('button', { type: 'button', className: 'icon', title: 'Move down', textContent: '↓' });
      up.addEventListener('click', () => move(-1));
      down.addEventListener('click', () => move(1));

      const kind = el('select', {}, el('option', { value: 'domain', textContent: 'Domain' }), el('option', { value: 'regex', textContent: 'Regex' }));
      const pattern = el('input', { type: 'text', spellcheck: false, value: r.pattern });
      kind.value = r.kind;
      kind.addEventListener('change', () => { r.kind = kind.value; validatePattern(pattern, r); changed(); });
      pattern.addEventListener('input', () => { r.pattern = pattern.value.trim(); validatePattern(pattern, r); changed(); });
      validatePattern(pattern, r);

      const style = el('select', {}, ...cfg.styles.map((s) => el('option', { value: s.id, textContent: s.name })));
      if (!cfg.styles.some((s) => s.id === r.styleId)) style.prepend(el('option', { value: r.styleId, textContent: '— missing style —' }));
      style.value = r.styleId;
      style.addEventListener('change', () => { r.styleId = style.value; changed(); });

      const del = el('button', { type: 'button', className: 'icon', title: 'Delete rule', textContent: '✕' });
      del.addEventListener('click', () => { cfg.rules.splice(i, 1); changed(); renderRules(); });

      tbody.append(el('tr', {}, el('td', {}, up, down), el('td', {}, kind), el('td', {}, pattern), el('td', {}, style), el('td', {}, del)));
    });
  }

  function render() {
    renderStyles();
    renderRules();
    $('#preview-styles').textContent = core.buildStylesheet(cfg.styles, 'data-paygate');
  }

  // --- Wiring -----------------------------------------------------------------

  async function reload() {
    cfg = await store.loadOrDefault();
    setDirty(false);
    render();
  }

  $('#add-style').addEventListener('click', () => {
    cfg.styles.push({ id: uniqueStyleId('style'), name: 'New style', before: '', after: '', css: '' });
    changed();
    render();
  });

  $('#add-rule').addEventListener('click', () => {
    cfg.rules.unshift({ kind: 'domain', pattern: '', styleId: (cfg.styles[0] || {}).id || '' });
    $('#rule-filter').value = '';
    changed();
    renderRules();
    $('#rules tbody input').focus();
  });

  $('#rule-filter').addEventListener('input', renderRules);

  $('#save').addEventListener('click', async () => {
    try {
      await store.save(cfg);
      await reload();
      $('#status').textContent = 'Saved';
    } catch (e) {
      $('#status').textContent = 'Save failed: ' + e.message;
      $('#status').classList.add('dirty');
    }
  });

  $('#revert').addEventListener('click', reload);

  $('#export').addEventListener('click', () => {
    $('#json').value = JSON.stringify(core.normalizeConfig(cfg), null, 2);
  });

  $('#import').addEventListener('click', () => {
    try {
      const parsed = JSON.parse($('#json').value);
      cfg = core.normalizeConfig({ styles: parsed.styles || cfg.styles, rules: parsed.rules || cfg.rules });
      changed();
      render();
    } catch (e) {
      $('#status').textContent = 'Import failed: ' + e.message;
      $('#status').classList.add('dirty');
    }
  });

  $('#reset').addEventListener('click', () => {
    cfg = core.normalizeConfig({ rules: cfg.rules });
    changed();
    render();
  });

  // Pick up rules added from the context menu while this page is open, unless
  // that would clobber unsaved edits.
  store.onChange((next) => {
    if (dirty) return;
    cfg = next;
    render();
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  reload();
})();
