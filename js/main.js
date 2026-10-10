document.addEventListener('DOMContentLoaded', function () {
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });
  }

  // Tap-to-open dropdown on touch/mobile (hover has no effect there)
  document.querySelectorAll('.nav-links > li.has-dropdown > a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (window.innerWidth <= 1180) {
        e.preventDefault();
        a.parentElement.classList.toggle('open');
      }
    });
  });

  // Current Opportunities: client-side filtering of the roles already on the page
  // (search box, location/experience/job-type selects, and the sidebar checkboxes
  // all narrow the same #opp-grid — there is no backend/job database behind this).
  var oppGrid = document.getElementById('opp-grid');
  if (oppGrid) {
    var oppCards = Array.prototype.slice.call(oppGrid.querySelectorAll('.job-card'));
    var oppCount = document.getElementById('opp-count');
    var oppEmpty = document.getElementById('opp-empty');
    var oppSearchInput = document.getElementById('opp-search-input');
    var oppLocSelect = document.getElementById('opp-loc-select');
    var oppExpSelect = document.getElementById('opp-exp-select');
    var oppTypeSelect = document.getElementById('opp-type-select');
    var oppSearchBtn = document.getElementById('opp-search-btn');
    var oppClearBtn = document.getElementById('opp-clear-all');
    var oppChecks = Array.prototype.slice.call(document.querySelectorAll('.filter-check input[type="checkbox"]'));
    var oppExpBuckets = { '0-2': [0, 2], '3-5': [3, 5], '6-10': [6, 10], '10+': [11, 99] };

    var oppSelectedValues = function (group) {
      return oppChecks
        .filter(function (c) { return c.dataset.group === group && c.checked; })
        .map(function (c) { return c.value; });
    };

    var oppApplyFilters = function () {
      var term = (oppSearchInput && oppSearchInput.value || '').trim().toLowerCase();
      var locVals = oppSelectedValues('loc');
      if (oppLocSelect && oppLocSelect.value) locVals = locVals.concat([oppLocSelect.value]);
      var funcVals = oppSelectedValues('func');
      var typeVals = oppSelectedValues('type');
      if (oppTypeSelect && oppTypeSelect.value) typeVals = typeVals.concat([oppTypeSelect.value]);
      var expVals = oppSelectedValues('exp');
      if (oppExpSelect && oppExpSelect.value) expVals = expVals.concat([oppExpSelect.value]);

      var visible = 0;
      oppCards.forEach(function (card) {
        var searchOk = !term || (card.dataset.search || '').indexOf(term) !== -1;
        var loc = card.dataset.loc || '';
        var locOk = locVals.length === 0 || locVals.some(function (v) { return loc.indexOf(v) !== -1; });
        var funcOk = funcVals.length === 0 || funcVals.indexOf(card.dataset.func) !== -1;
        var typeOk = typeVals.length === 0 || typeVals.indexOf(card.dataset.type) !== -1;
        var min = parseInt(card.dataset.expmin, 10);
        var max = parseInt(card.dataset.expmax, 10);
        var expOk = expVals.length === 0 || expVals.some(function (k) {
          var b = oppExpBuckets[k];
          return b && min <= b[1] && max >= b[0];
        });
        var show = searchOk && locOk && funcOk && typeOk && expOk;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      if (oppCount) oppCount.textContent = visible + (visible === 1 ? ' opportunity' : ' opportunities');
      if (oppEmpty) oppEmpty.style.display = visible === 0 ? '' : 'none';
    };

    oppChecks.forEach(function (c) { c.addEventListener('change', oppApplyFilters); });
    [oppLocSelect, oppExpSelect, oppTypeSelect].forEach(function (s) {
      if (s) s.addEventListener('change', oppApplyFilters);
    });
    if (oppSearchInput) {
      oppSearchInput.addEventListener('input', oppApplyFilters);
      oppSearchInput.addEventListener('keyup', function (e) { if (e.key === 'Enter') oppApplyFilters(); });
    }
    if (oppSearchBtn) oppSearchBtn.addEventListener('click', oppApplyFilters);
    if (oppClearBtn) {
      oppClearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        oppChecks.forEach(function (c) { c.checked = false; });
        if (oppSearchInput) oppSearchInput.value = '';
        [oppLocSelect, oppExpSelect, oppTypeSelect].forEach(function (s) { if (s) s.value = ''; });
        oppApplyFilters();
      });
    }
  }

  // Insights library: topic sidebar (single-select), content-type/industry
  // checkboxes, keyword search, grid/list toggle and client-side pagination —
  // all narrowing the same #insight-grid (no backend/CMS behind this).
  var insightGrid = document.getElementById('insight-grid');
  if (insightGrid) {
    var insCards = Array.prototype.slice.call(insightGrid.querySelectorAll('.insight-card'));
    var insCountEl = document.getElementById('ins-count');
    var insEmptyEl = document.getElementById('ins-empty');
    var insSearchInput = document.getElementById('ins-search-input');
    var insTopicSelect = document.getElementById('ins-topic-select');
    var insTypeSelect = document.getElementById('ins-type-select');
    var insIndustrySelect = document.getElementById('ins-industry-select');
    var insTopicRows = Array.prototype.slice.call(document.querySelectorAll('.topic-row'));
    var insTypeAll = document.getElementById('ins-type-all');
    var insTypeChecks = Array.prototype.slice.call(document.querySelectorAll('.filter-check input[data-group="ins-type"]'));
    var insIndustryChecks = Array.prototype.slice.call(document.querySelectorAll('.filter-check input[data-group="ins-industry"]'));
    var insPagination = document.getElementById('ins-pagination');
    var insViewGridBtn = document.getElementById('ins-view-grid');
    var insViewListBtn = document.getElementById('ins-view-list');
    var INS_PAGE_SIZE = 6;
    var insState = { topic: '', page: 1 };

    var insSelectedTypes = function () {
      var vals = insTypeChecks.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (insTypeSelect && insTypeSelect.value) vals = vals.concat([insTypeSelect.value]);
      return vals;
    };
    var insSelectedIndustries = function () {
      var vals = insIndustryChecks.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (insIndustrySelect && insIndustrySelect.value) vals = vals.concat([insIndustrySelect.value]);
      return vals;
    };

    var insGetFiltered = function () {
      var term = (insSearchInput && insSearchInput.value || '').trim().toLowerCase();
      var typeVals = insSelectedTypes();
      var industryVals = insSelectedIndustries();
      var topic = insState.topic;
      return insCards.filter(function (card) {
        var searchOk = !term || (card.dataset.search || '').indexOf(term) !== -1;
        var topicOk = !topic || card.dataset.topic === topic;
        var typeOk = typeVals.length === 0 || typeVals.indexOf(card.dataset.type) !== -1;
        var industryOk = industryVals.length === 0 || industryVals.indexOf(card.dataset.industry) !== -1;
        return searchOk && topicOk && typeOk && industryOk;
      });
    };

    var insRenderPagination = function (totalPages) {
      if (!insPagination) return;
      insPagination.innerHTML = '';
      if (totalPages <= 1) return;
      var mkBtn = function (label, page, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (opts.active) b.className = 'active';
        if (opts.disabled) b.disabled = true;
        b.addEventListener('click', function () {
          insState.page = page;
          insRender();
          window.scrollTo({ top: insightGrid.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
        });
        insPagination.appendChild(b);
      };
      mkBtn('‹', Math.max(1, insState.page - 1), { disabled: insState.page === 1 });
      for (var p = 1; p <= totalPages; p++) mkBtn(String(p), p, { active: p === insState.page });
      mkBtn('›', Math.min(totalPages, insState.page + 1), { disabled: insState.page === totalPages });
    };

    var insRender = function () {
      var filtered = insGetFiltered();
      var totalPages = Math.max(1, Math.ceil(filtered.length / INS_PAGE_SIZE));
      if (insState.page > totalPages) insState.page = totalPages;
      var start = (insState.page - 1) * INS_PAGE_SIZE;
      var pageSet = filtered.slice(start, start + INS_PAGE_SIZE);
      insCards.forEach(function (card) {
        card.style.display = pageSet.indexOf(card) !== -1 ? '' : 'none';
      });
      if (insCountEl) insCountEl.textContent = filtered.length + (filtered.length === 1 ? ' insight' : ' insights');
      if (insEmptyEl) insEmptyEl.style.display = filtered.length === 0 ? '' : 'none';
      insRenderPagination(totalPages);
    };

    insTopicRows.forEach(function (row) {
      row.addEventListener('click', function () {
        insState.topic = row.dataset.topicRow || '';
        insState.page = 1;
        insTopicRows.forEach(function (r) { r.classList.toggle('active', r === row); });
        if (insTopicSelect) insTopicSelect.value = insState.topic;
        insRender();
      });
    });
    if (insTopicSelect) {
      insTopicSelect.addEventListener('change', function () {
        insState.topic = insTopicSelect.value;
        insState.page = 1;
        insTopicRows.forEach(function (r) { r.classList.toggle('active', (r.dataset.topicRow || '') === insState.topic); });
        insRender();
      });
    }

    var insSyncTypeAll = function () {
      var anyChecked = insTypeChecks.some(function (c) { return c.checked; });
      if (insTypeAll) insTypeAll.checked = !anyChecked;
    };
    if (insTypeAll) {
      insTypeAll.addEventListener('change', function () {
        if (insTypeAll.checked) insTypeChecks.forEach(function (c) { c.checked = false; });
        insState.page = 1;
        insRender();
      });
    }
    insTypeChecks.forEach(function (c) {
      c.addEventListener('change', function () {
        insSyncTypeAll();
        insState.page = 1;
        insRender();
      });
    });
    insIndustryChecks.forEach(function (c) {
      c.addEventListener('change', function () { insState.page = 1; insRender(); });
    });
    [insTypeSelect, insIndustrySelect].forEach(function (s) {
      if (s) s.addEventListener('change', function () { insState.page = 1; insRender(); });
    });
    if (insSearchInput) insSearchInput.addEventListener('input', function () { insState.page = 1; insRender(); });

    if (insViewGridBtn && insViewListBtn) {
      insViewGridBtn.addEventListener('click', function () {
        insightGrid.classList.remove('list-view');
        insViewGridBtn.classList.add('active');
        insViewListBtn.classList.remove('active');
      });
      insViewListBtn.addEventListener('click', function () {
        insightGrid.classList.add('list-view');
        insViewListBtn.classList.add('active');
        insViewGridBtn.classList.remove('active');
      });
    }

    insRender();
  }

  // Shared lead-capture modal: "Download" on an insight opens this, collects
  // name + email, then routes the request to TalNXT by email (this is a
  // static site with no backend/CRM, so there is no automated PDF delivery —
  // submitting opens a pre-filled email to the team instead).
  var dlModal = document.getElementById('download-modal');
  if (dlModal) {
    var dlTitleEl = document.getElementById('dl-modal-title');
    var dlFormWrap = document.getElementById('dl-modal-form-wrap');
    var dlForm = document.getElementById('dl-modal-form');
    var dlThanks = document.getElementById('dl-modal-thanks');
    var dlThanksTitle = document.getElementById('dl-thanks-title');
    var dlCloseBtn = document.getElementById('dl-modal-close');
    var dlCurrentTitle = '';

    var dlOpen = function (title) {
      dlCurrentTitle = title;
      if (dlTitleEl) dlTitleEl.textContent = title;
      if (dlFormWrap) dlFormWrap.style.display = '';
      if (dlThanks) dlThanks.style.display = 'none';
      if (dlForm) dlForm.reset();
      dlModal.classList.add('open');
    };
    var dlClose = function () { dlModal.classList.remove('open'); };

    document.querySelectorAll('.js-download-link').forEach(function (a) {
      a.addEventListener('click', function () { dlOpen(a.dataset.title || 'this insight'); });
    });

    if (dlCloseBtn) dlCloseBtn.addEventListener('click', dlClose);
    dlModal.addEventListener('click', function (e) { if (e.target === dlModal) dlClose(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dlClose(); });

    if (dlForm) {
      dlForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = document.getElementById('dl-name').value.trim();
        var email = document.getElementById('dl-email').value.trim();
        if (!name || !email) return;
        var subject = 'Insight download: ' + dlCurrentTitle;
        var body = 'Name: ' + name + '\nEmail: ' + email + '\nRequested insight: ' + dlCurrentTitle;
        var mailto = 'mailto:info@talnxt.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        window.location.href = mailto;
        if (dlThanksTitle) dlThanksTitle.textContent = dlCurrentTitle;
        if (dlFormWrap) dlFormWrap.style.display = 'none';
        if (dlThanks) dlThanks.style.display = '';
      });
    }
  }
});
