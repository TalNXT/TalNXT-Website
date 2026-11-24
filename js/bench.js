/*
 * Talent Bench (talent-bench.html): anonymised bench profiles from the SharePoint
 * "Bench Profiles" list, served by the forms Worker at GET /api/bench.
 *
 * Everything after the fetch happens in the browser: faceted filters (vertical, technology,
 * experience, availability, work mode, location, budget), search, sort, card/table views,
 * and a shortlist that opens the staffing enquiry popup with the profile IDs filled in.
 * The filter state lives in the query string (e.g. ?tech=reactjs&vertical=engineering), so
 * every combination is a shareable link without separate pages.
 *
 * All SharePoint text is inserted with textContent, never innerHTML.
 * Local preview without the Worker: talent-bench.html?demo=1 loads data/bench-sample.json.
 */
(function () {
  'use strict';

  var app = document.getElementById('tb-app');
  if (!app) return;

  var PAGE = 24;
  var TECH_TOP = 8;
  var cfg = window.TALNXT_FORMS_CONFIG || {};
  var params = new URLSearchParams(window.location.search);
  var demo = params.get('demo') === '1';
  var API = demo ? 'data/bench-sample.json' : (cfg.apiBase ? cfg.apiBase.replace(/\/+$/, '') + '/api/bench' : '');

  /* Vertical colours follow the careers cards (site.css .cr-job.*); unknown verticals cycle through the rest. */
  var VERTICAL_COLOURS = {
    'engineering': ['#287CDB', '#EAF3FD'],
    'cloud & devops': ['#239B7A', '#E6F6F0'],
    'data & ai': ['#7857B0', '#EFE9F7'],
    'qa & testing': ['#B8862F', '#F6EFE0'],
    'erp / sap': ['#B3574A', '#F5ECE9'],
    'design': ['#C2477F', '#F8E8F0'],
    'project / delivery': ['#2F6F8F', '#E5F0F5']
  };
  var SPARE = [['#3d7c63', '#ebf3ef'], ['#1b5fc4', '#e4eaf6'], ['#8a5a2b', '#f3ebe2'], ['#5b6b86', '#edf0f5']];

  var EXP = [
    { key: '0-2', label: 'Under 2 years', test: function (y) { return y < 2; } },
    { key: '2-5', label: '2–5 years', test: function (y) { return y >= 2 && y < 5; } },
    { key: '5-8', label: '5–8 years', test: function (y) { return y >= 5 && y < 8; } },
    { key: '8-12', label: '8–12 years', test: function (y) { return y >= 8 && y < 12; } },
    { key: '12', label: '12+ years', test: function (y) { return y >= 12; } }
  ];
  var AVAIL = [
    { key: 'now', label: 'Immediate' },
    { key: '15', label: 'Within 15 days' },
    { key: '30', label: 'Within 30 days' },
    { key: 'later', label: 'Later' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var slug = function (s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9+#.]+/g, '-').replace(/^-+|-+$/g, ''); };
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };

  // ---------------------------------------------------------------- state

  var all = [];
  var facets = { vertical: {}, tech: {}, mode: {}, loc: {} };   // slug -> display label
  var state = {
    q: '', vertical: {}, tech: {}, exp: {}, avail: {}, mode: {}, loc: {},
    max: null, cur: 'INR', view: 'grid', sort: 'relevance'
  };
  var shown = PAGE;
  var techExpanded = false;
  var shortlist = loadShortlist();

  function loadShortlist() {
    try {
      var v = JSON.parse(window.localStorage.getItem('tb-shortlist') || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }).slice(0, 25) : [];
    } catch (e) { return []; }
  }
  function saveShortlist() {
    try { window.localStorage.setItem('tb-shortlist', JSON.stringify(shortlist)); } catch (e) { /* private mode */ }
  }

  var SETS = ['vertical', 'tech', 'exp', 'avail', 'mode', 'loc'];

  function readUrl() {
    SETS.forEach(function (k) {
      state[k] = {};
      (params.get(k) || '').split(',').forEach(function (v) { if (v) state[k][v] = true; });
    });
    state.q = (params.get('q') || '').slice(0, 80);
    state.cur = params.get('cur') === 'USD' ? 'USD' : 'INR';
    state.view = params.get('view') === 'table' ? 'table' : 'grid';
    state.sort = params.get('sort') || 'relevance';
    var m = Number(params.get('max'));
    state.max = m > 0 ? m : null;
  }

  function writeUrl() {
    var p = new URLSearchParams();
    if (demo) p.set('demo', '1');
    SETS.forEach(function (k) { var v = Object.keys(state[k]); if (v.length) p.set(k, v.join(',')); });
    if (state.q) p.set('q', state.q);
    if (state.cur !== 'INR') p.set('cur', state.cur);
    if (state.view !== 'grid') p.set('view', state.view);
    if (state.sort !== 'relevance') p.set('sort', state.sort);
    if (state.max) p.set('max', String(state.max));
    var qs = p.toString();
    try { window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash); } catch (e) { /* file:// */ }
  }

  // ---------------------------------------------------------------- derived values

  function availKey(p) {
    var a = (p.availability || '').toLowerCase();
    if (a === 'immediate') return 'now';
    var days = null;
    var m = /(\d+)\s*day/.exec(a);
    if (m) days = Number(m[1]);
    else if (p.availableFrom) days = Math.ceil((Date.parse(p.availableFrom) - Date.now()) / 86400000);
    if (days === null || isNaN(days)) return 'later';
    if (days <= 0) return 'now';
    if (days <= 15) return '15';
    if (days <= 30) return '30';
    return 'later';
  }

  function availLabel(p) {
    var k = availKey(p);
    if (k === 'now') return 'Available now';
    if (p.availableFrom && /date/i.test(p.availability || '')) {
      var d = new Date(p.availableFrom + 'T00:00:00');
      return 'From ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    return 'In ' + (p.availability || 'a few weeks');
  }

  function cost(p) { return state.cur === 'USD' ? p.costUsd : p.costInr; }

  function money(n) {
    if (n === null || n === undefined) return 'On request';
    try {
      return new Intl.NumberFormat(state.cur === 'USD' ? 'en-US' : 'en-IN', { style: 'currency', currency: state.cur, maximumFractionDigits: 0 }).format(n);
    } catch (e) { return (state.cur === 'USD' ? '$' : '₹') + Math.round(n); }
  }

  function colours(vertical) {
    var c = VERTICAL_COLOURS[String(vertical).toLowerCase()];
    if (c) return c;
    var keys = Object.keys(facets.vertical).sort();
    return SPARE[Math.max(0, keys.indexOf(slug(vertical))) % SPARE.length];
  }

  function prepare(list) {
    return list.map(function (p) {
      var o = {
        id: String(p.id || ''), role: String(p.role || ''), vertical: String(p.vertical || 'Other'), tech: String(p.tech || 'Other'),
        skills: Array.isArray(p.skills) ? p.skills.map(String) : [], experience: typeof p.experience === 'number' ? p.experience : null,
        availability: String(p.availability || ''), availableFrom: p.availableFrom || null, location: String(p.location || ''),
        workMode: Array.isArray(p.workMode) ? p.workMode.map(String) : [], summary: String(p.summary || ''),
        costInr: typeof p.costInr === 'number' ? p.costInr : null, costUsd: typeof p.costUsd === 'number' ? p.costUsd : null,
        updated: p.updated || ''
      };
      o.k = {
        vertical: slug(o.vertical), tech: slug(o.tech), avail: availKey(o), loc: o.location ? slug(o.location) : '',
        mode: o.workMode.map(slug),
        exp: o.experience === null ? '' : (EXP.filter(function (b) { return b.test(o.experience); })[0] || {}).key
      };
      o.text = [o.id, o.role, o.vertical, o.tech, o.skills.join(' '), o.summary, o.location].join(' ').toLowerCase();
      facets.vertical[o.k.vertical] = o.vertical;
      facets.tech[o.k.tech] = o.tech;
      if (o.k.loc) facets.loc[o.k.loc] = o.location;
      o.workMode.forEach(function (m, i) { facets.mode[o.k.mode[i]] = m; });
      return o;
    }).filter(function (o) { return o.id && o.role; });
  }

  // ---------------------------------------------------------------- filtering

  function any(obj) { for (var k in obj) if (obj[k]) return true; return false; }

  /** True if p passes every filter except `skip` (used for facet counts). */
  function matches(p, skip) {
    if (skip !== 'q' && state.q) {
      var words = state.q.toLowerCase().split(/\s+/);
      for (var i = 0; i < words.length; i++) if (words[i] && p.text.indexOf(words[i]) < 0) return false;
    }
    if (skip !== 'vertical' && any(state.vertical) && !state.vertical[p.k.vertical]) return false;
    if (skip !== 'tech' && any(state.tech) && !state.tech[p.k.tech]) return false;
    if (skip !== 'exp' && any(state.exp) && !state.exp[p.k.exp]) return false;
    if (skip !== 'avail' && any(state.avail) && !state.avail[p.k.avail]) return false;
    if (skip !== 'loc' && any(state.loc) && !state.loc[p.k.loc]) return false;
    if (skip !== 'mode' && any(state.mode) && !p.k.mode.some(function (m) { return state.mode[m]; })) return false;
    if (skip !== 'max' && state.max) { var c = cost(p); if (c !== null && c > state.max) return false; }
    return true;
  }

  function counts(key) {
    var out = {};
    all.forEach(function (p) {
      if (!matches(p, key)) return;
      var vals = key === 'mode' ? p.k.mode : [p.k[key]];
      vals.forEach(function (v) { if (v) out[v] = (out[v] || 0) + 1; });
    });
    return out;
  }

  var SORTS = {
    relevance: function (a, b) { return rank(a.k.avail) - rank(b.k.avail) || a.tech.localeCompare(b.tech) || (b.experience || 0) - (a.experience || 0); },
    'exp-desc': function (a, b) { return (b.experience || 0) - (a.experience || 0); },
    'exp-asc': function (a, b) { return (a.experience || 0) - (b.experience || 0); },
    avail: function (a, b) { return rank(a.k.avail) - rank(b.k.avail) || (a.availableFrom || '').localeCompare(b.availableFrom || ''); },
    updated: function (a, b) { return String(b.updated).localeCompare(String(a.updated)); }
  };
  function rank(k) { return { now: 0, '15': 1, '30': 2, later: 3 }[k]; }

  // ---------------------------------------------------------------- rendering: filters

  function renderVerticals() {
    var box = $('tb-verticals');
    box.textContent = '';
    var c = counts('vertical');
    var total = all.filter(function (p) { return matches(p, 'vertical'); }).length;
    var allBtn = el('button', 'tb-vpill');
    allBtn.type = 'button';
    allBtn.setAttribute('aria-pressed', String(!any(state.vertical)));
    allBtn.appendChild(document.createTextNode('All verticals'));
    allBtn.appendChild(el('span', 'n', String(total)));
    allBtn.addEventListener('click', function () { state.vertical = {}; update(); });
    box.appendChild(allBtn);
    Object.keys(facets.vertical).sort(function (a, b) { return facets.vertical[a].localeCompare(facets.vertical[b]); }).forEach(function (k) {
      var b = el('button', 'tb-vpill');
      b.type = 'button';
      var col = colours(facets.vertical[k]);
      b.style.setProperty('--tb-c', col[0]);
      b.style.setProperty('--tb-bg', col[1]);
      b.setAttribute('aria-pressed', String(!!state.vertical[k]));
      b.appendChild(el('i', 'tb-dot'));
      b.appendChild(document.createTextNode(facets.vertical[k]));
      b.appendChild(el('span', 'n', String(c[k] || 0)));
      if (!c[k] && !state.vertical[k]) b.disabled = true;
      b.addEventListener('click', function () { toggle('vertical', k); });
      box.appendChild(b);
    });
  }

  function checkList(boxId, key, options, limit) {
    var box = $(boxId);
    box.textContent = '';
    var c = counts(key);
    var shownN = 0;
    options.forEach(function (o) {
      if (limit && shownN >= limit && !state[key][o.key]) return;
      var label = el('label', 'tb-check');
      var input = el('input');
      input.type = 'checkbox';
      input.checked = !!state[key][o.key];
      var n = c[o.key] || 0;
      if (!n && !input.checked) label.classList.add('is-zero');
      input.addEventListener('change', function () { toggle(key, o.key); });
      label.appendChild(input);
      label.appendChild(el('span', 'tb-check-l', o.label));
      label.appendChild(el('span', 'n', String(n)));
      box.appendChild(label);
      shownN++;
    });
    if (!options.length) box.appendChild(el('p', 'tb-fnote', 'Nothing to filter yet.'));
  }

  function renderFilters() {
    renderVerticals();

    var tq = $('tb-tech-q').value.trim().toLowerCase();
    var tc = counts('tech');
    var techs = Object.keys(facets.tech)
      .filter(function (k) { return !tq || facets.tech[k].toLowerCase().indexOf(tq) >= 0; })
      .sort(function (a, b) { return (tc[b] || 0) - (tc[a] || 0) || facets.tech[a].localeCompare(facets.tech[b]); })
      .map(function (k) { return { key: k, label: facets.tech[k] }; });
    var limit = techExpanded || tq ? 0 : TECH_TOP;
    checkList('tb-f-tech', 'tech', techs, limit);
    var more = $('tb-tech-more');
    more.hidden = !!tq || techs.length <= TECH_TOP;
    more.textContent = techExpanded ? 'Show fewer' : 'Show all ' + techs.length;

    checkList('tb-f-exp', 'exp', EXP, 0);
    checkList('tb-f-avail', 'avail', AVAIL, 0);
    var byLabel = function (f) { return Object.keys(f).sort(function (a, b) { return f[a].localeCompare(f[b]); }).map(function (k) { return { key: k, label: f[k] }; }); };
    checkList('tb-f-mode', 'mode', byLabel(facets.mode), 0);
    checkList('tb-f-loc', 'loc', byLabel(facets.loc), 0);
    renderBudget();
  }

  var budgetMax = 0;
  function renderBudget() {
    var vals = all.map(cost).filter(function (v) { return v !== null; });
    var group = $('tb-budget-group');
    group.hidden = !vals.length;
    if (!vals.length) return;
    var step = state.cur === 'USD' ? 100 : 10000;
    var lo = Math.floor(Math.min.apply(null, vals) / step) * step;
    budgetMax = Math.ceil(Math.max.apply(null, vals) / step) * step;
    var r = $('tb-budget');
    r.min = String(lo);
    r.max = String(budgetMax);
    r.step = String(step);
    if (state.max && state.max > budgetMax) state.max = null;
    r.value = String(state.max || budgetMax);
    $('tb-budget-val').textContent = state.max ? 'Up to ' + money(state.max) : 'Any';
    $('tb-budget-reset').hidden = !state.max;
  }

  function renderActive() {
    var box = $('tb-active');
    box.textContent = '';
    var chips = [];
    var labels = {
      vertical: function (k) { return facets.vertical[k]; }, tech: function (k) { return facets.tech[k]; },
      exp: function (k) { return (EXP.filter(function (b) { return b.key === k; })[0] || {}).label; },
      avail: function (k) { return (AVAIL.filter(function (b) { return b.key === k; })[0] || {}).label; },
      mode: function (k) { return facets.mode[k]; }, loc: function (k) { return facets.loc[k]; }
    };
    SETS.forEach(function (key) {
      Object.keys(state[key]).forEach(function (k) {
        chips.push({ text: labels[key](k) || k, clear: function () { delete state[key][k]; } });
      });
    });
    if (state.q) chips.push({ text: '“' + state.q + '”', clear: function () { state.q = ''; $('tb-q').value = ''; } });
    if (state.max) chips.push({ text: 'Up to ' + money(state.max), clear: function () { state.max = null; } });
    chips.forEach(function (c) {
      var b = el('button', 'tb-achip');
      b.type = 'button';
      b.appendChild(document.createTextNode(c.text));
      b.appendChild(el('span', null, '✕'));
      b.setAttribute('aria-label', 'Remove filter ' + c.text);
      b.addEventListener('click', function () { c.clear(); update(); });
      box.appendChild(b);
    });
    var n = chips.length - (state.q ? 1 : 0);
    var badge = $('tb-filter-count');
    badge.hidden = !n;
    badge.textContent = String(n);
    $('tb-clear').disabled = !chips.length;
  }

  // ---------------------------------------------------------------- rendering: results

  var ICON = {
    exp: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    loc: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    mode: 'M3 10.5L12 4l9 6.5M5.5 9v10h13V9'
  };
  function icon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }
  function metaItem(path, text) {
    var li = el('li');
    li.appendChild(icon(path));
    li.appendChild(document.createTextNode(text));
    return li;
  }
  var yrs = function (p) { return p.experience === null ? '' : p.experience + (p.experience === 1 ? ' yr' : ' yrs'); };
  var inList = function (id) { return shortlist.indexOf(id) >= 0; };

  function shortlistButton(p, compact) {
    var b = el('button', 'tb-sl' + (compact ? ' tb-sl-compact' : ''));
    b.type = 'button';
    var on = inList(p.id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Remove ' : 'Shortlist ') + p.id);
    var svg = icon('M6 3h12v18l-6-4-6 4z');
    b.appendChild(svg);
    if (!compact) b.appendChild(el('span', null, on ? 'Shortlisted' : 'Shortlist'));
    b.addEventListener('click', function () { toggleShortlist(p.id); });
    return b;
  }

  function requestButton(p, cls) {
    var b = el('button', cls || 'tb-req', 'Request profile');
    b.type = 'button';
    b.addEventListener('click', function () { request([p.id], b); });
    return b;
  }

  function card(p) {
    var col = colours(p.vertical);
    var li = el('li', 'tb-card');
    li.style.setProperty('--tb-c', col[0]);
    li.style.setProperty('--tb-bg', col[1]);
    if (inList(p.id)) li.classList.add('is-listed');

    var top = el('div', 'tb-card-top');
    top.appendChild(el('span', 'tb-tag', p.vertical));
    top.appendChild(el('span', 'tb-avail tb-avail-' + p.k.avail, availLabel(p)));
    li.appendChild(top);

    var h = el('h3', 'tb-role', p.role);
    li.appendChild(h);
    var sub = el('div', 'tb-sub');
    sub.appendChild(el('span', 'tb-id', p.id));
    sub.appendChild(el('span', 'tb-tech', p.tech));
    li.appendChild(sub);

    var meta = el('ul', 'tb-meta');
    if (p.experience !== null) meta.appendChild(metaItem(ICON.exp, yrs(p) + ' experience'));
    if (p.location) meta.appendChild(metaItem(ICON.loc, p.location));
    if (p.workMode.length) meta.appendChild(metaItem(ICON.mode, p.workMode.join(' · ')));
    li.appendChild(meta);

    if (p.summary) li.appendChild(el('p', 'tb-summary', p.summary));

    if (p.skills.length) {
      var chips = el('ul', 'tb-skills');
      p.skills.slice(0, 6).forEach(function (s) { chips.appendChild(el('li', null, s)); });
      if (p.skills.length > 6) {
        var more = el('li', 'tb-skills-more', '+' + (p.skills.length - 6));
        more.title = p.skills.slice(6).join(', ');
        chips.appendChild(more);
      }
      li.appendChild(chips);
    }

    var foot = el('div', 'tb-card-foot');
    var price = el('div', 'tb-price');
    var c = cost(p);
    price.appendChild(el('strong', null, money(c)));
    if (c !== null) price.appendChild(el('span', null, ' / month'));
    foot.appendChild(price);
    var actions = el('div', 'tb-card-actions');
    actions.appendChild(shortlistButton(p, true));
    actions.appendChild(requestButton(p));
    foot.appendChild(actions);
    li.appendChild(foot);
    return li;
  }

  function row(p) {
    var col = colours(p.vertical);
    var tr = el('tr');
    tr.style.setProperty('--tb-c', col[0]);
    tr.style.setProperty('--tb-bg', col[1]);
    var td = function (child, cls) { var c = el('td', cls); if (typeof child === 'string') c.textContent = child; else if (child) c.appendChild(child); tr.appendChild(c); return c; };
    td(shortlistButton(p, true));
    var idCell = td(el('span', 'tb-id', p.id));
    idCell.appendChild(el('span', 'tb-tag', p.vertical));
    var roleCell = td(el('strong', null, p.role));
    roleCell.appendChild(el('span', 'tb-row-skills', [p.tech].concat(p.skills.filter(function (s) { return s.toLowerCase() !== p.tech.toLowerCase(); }).slice(0, 5)).join(', ')));
    td(yrs(p) || '–', 'tb-nowrap');
    td(el('span', 'tb-avail tb-avail-' + p.k.avail, availLabel(p)));
    td([p.location, p.workMode.join('/')].filter(Boolean).join(' · ') || '–');
    td(money(cost(p)), 'tb-nowrap');
    td(requestButton(p, 'tb-req tb-req-sm'));
    return tr;
  }

  function renderResults() {
    var list = all.filter(function (p) { return matches(p); });
    list.sort(SORTS[state.sort] || SORTS.relevance);

    var grid = $('tb-grid');
    var tbody = $('tb-tbody');
    grid.textContent = '';
    tbody.textContent = '';
    grid.setAttribute('aria-busy', 'false');
    var page = list.slice(0, shown);
    if (state.view === 'grid') page.forEach(function (p) { grid.appendChild(card(p)); });
    else page.forEach(function (p) { tbody.appendChild(row(p)); });

    grid.hidden = state.view !== 'grid' || !list.length;
    $('tb-table-wrap').hidden = state.view !== 'table' || !list.length;
    $('tb-empty').hidden = !!list.length;
    $('tb-load-more').hidden = list.length <= shown;
    $('tb-load-more').textContent = 'Show more profiles (' + (list.length - shown) + ' more)';
    $('tb-count').textContent = list.length === all.length
      ? all.length + ' profile' + (all.length === 1 ? '' : 's') + ' on the bench'
      : list.length + ' of ' + all.length + ' profiles match';
    $('tb-apply-filters').textContent = 'Show ' + list.length + ' result' + (list.length === 1 ? '' : 's');
  }

  function renderTray() {
    var tray = $('tb-tray');
    tray.hidden = !shortlist.length;
    document.body.classList.toggle('tb-has-tray', !!shortlist.length);
    $('tb-tray-count').textContent = shortlist.length + ' profile' + (shortlist.length === 1 ? '' : 's');
    $('tb-tray-ids').textContent = shortlist.join(', ');
  }

  function renderStats() {
    $('tb-stat-profiles').textContent = String(all.length);
    $('tb-stat-tech').textContent = String(Object.keys(facets.tech).length);
    $('tb-stat-now').textContent = String(all.filter(function (p) { return p.k.avail === 'now'; }).length);
  }

  function syncControls() {
    document.querySelectorAll('[data-cur]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-cur') === state.cur)); });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view)); });
    $('tb-sort').value = SORTS[state.sort] ? state.sort : 'relevance';
    if ($('tb-q').value !== state.q) $('tb-q').value = state.q;
  }

  function update(keepPage) {
    if (!keepPage) shown = PAGE;
    renderFilters();
    renderActive();
    renderResults();
    renderTray();
    syncControls();
    writeUrl();
  }

  function toggle(key, k) {
    if (state[key][k]) delete state[key][k]; else state[key][k] = true;
    update();
  }

  // ---------------------------------------------------------------- shortlist and request

  function toggleShortlist(id) {
    var i = shortlist.indexOf(id);
    if (i >= 0) shortlist.splice(i, 1);
    else if (shortlist.length < 25) shortlist.push(id);
    saveShortlist();
    update(true);
  }

  function request(ids, trigger) {
    var picked = all.filter(function (p) { return ids.indexOf(p.id) >= 0; });
    var roles = [];
    picked.forEach(function (p) { if (roles.indexOf(p.role) < 0) roles.push(p.role); });
    var prefill = {
      profiles: ids.join(', '),
      roles: roles.join(', ').slice(0, 500),
      positions: String(ids.length),
      message: 'I would like detailed profiles for: ' + ids.join(', ') + '.'
    };
    if (window.TalnxtEnquiry) {
      window.TalnxtEnquiry.open('staffing', trigger, prefill);
      return;
    }
    window.location.href = 'mailto:info@talnxt.com?subject=' + encodeURIComponent('Talent Bench request – ' + ids.join(', ')) +
      '&body=' + encodeURIComponent(prefill.message + '\n\nRoles: ' + prefill.roles);
  }

  // ---------------------------------------------------------------- mobile filter drawer

  var filtersPanel = $('tb-filters');
  var backdrop = $('tb-backdrop');
  var openBtn = $('tb-open-filters');
  function drawer(open) {
    filtersPanel.classList.toggle('open', open);
    backdrop.hidden = !open;
    document.body.classList.toggle('tb-drawer-open', open);
    openBtn.setAttribute('aria-expanded', String(open));
    if (open) $('tb-close-filters').focus(); else openBtn.focus();
  }

  // ---------------------------------------------------------------- events

  function bind() {
    var qTimer;
    $('tb-q').addEventListener('input', function (e) {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.q = e.target.value.trim().slice(0, 80); update(); }, 180);
    });
    $('tb-sort').addEventListener('change', function (e) { state.sort = e.target.value; update(); });
    document.querySelectorAll('[data-cur]').forEach(function (b) {
      b.addEventListener('click', function () { state.cur = b.getAttribute('data-cur'); state.max = null; update(true); });
    });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); update(true); });
    });
    $('tb-tech-q').addEventListener('input', function () { renderFilters(); });
    $('tb-tech-more').addEventListener('click', function () { techExpanded = !techExpanded; renderFilters(); });

    var budget = $('tb-budget');
    budget.addEventListener('input', function () {
      var v = Number(budget.value);
      $('tb-budget-val').textContent = v >= budgetMax ? 'Any' : 'Up to ' + money(v);
    });
    budget.addEventListener('change', function () {
      var v = Number(budget.value);
      state.max = v >= budgetMax ? null : v;
      update();
    });
    $('tb-budget-reset').addEventListener('click', function () { state.max = null; update(); });

    var clearAll = function () {
      SETS.forEach(function (k) { state[k] = {}; });
      state.q = ''; state.max = null;
      $('tb-tech-q').value = '';
      update();
    };
    $('tb-clear').addEventListener('click', clearAll);
    $('tb-empty-clear').addEventListener('click', clearAll);
    $('tb-load-more').addEventListener('click', function () { shown += PAGE; renderResults(); });

    $('tb-tray-clear').addEventListener('click', function () { shortlist = []; saveShortlist(); update(true); });
    $('tb-tray-request').addEventListener('click', function (e) { request(shortlist.slice(), e.currentTarget); });

    openBtn.addEventListener('click', function () { drawer(true); });
    $('tb-close-filters').addEventListener('click', function () { drawer(false); });
    $('tb-apply-filters').addEventListener('click', function () { drawer(false); $('tb-results').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    backdrop.addEventListener('click', function () { drawer(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && filtersPanel.classList.contains('open')) drawer(false); });

    $('tb-retry').addEventListener('click', load);
  }

  // ---------------------------------------------------------------- load

  function getJson(url, timeoutMs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    return fetch(url, { mode: 'cors', credentials: 'omit', headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function load() {
    $('tb-error').hidden = true;
    $('tb-count').textContent = 'Loading profiles…';
    if (!API) { fail(); return; }
    getJson(API, 10000)
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.profiles)) throw new Error('bad payload');
        facets = { vertical: {}, tech: {}, mode: {}, loc: {} };
        all = prepare(data.profiles);
        // Drop shortlisted profiles that are no longer on the bench
        shortlist = shortlist.filter(function (id) { return all.some(function (p) { return p.id === id; }); });
        saveShortlist();
        renderStats();
        update();
      })
      .catch(fail);
  }

  function fail() {
    $('tb-grid').hidden = true;
    $('tb-table-wrap').hidden = true;
    $('tb-load-more').hidden = true;
    $('tb-empty').hidden = true;
    $('tb-error').hidden = false;
    $('tb-count').textContent = '';
  }

  readUrl();
  syncControls();
  bind();
  load();
})();
