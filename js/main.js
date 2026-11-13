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

  // Client enquiry popup (index.html): any .js-enquiry link opens #enq-modal in
  // "staffing" or "hr" mode (data-enquiry); any other value opens it with no mode
  // chosen, so the visitor picks one first. Fields for modes not chosen are hidden
  // and disabled so they are neither validated nor submitted. With data-endpoint
  // set on the form the enquiry is POSTed there; otherwise a pre-filled email opens.
  var enqModal = document.getElementById('enq-modal');
  if (enqModal) {
    var enqForm = document.getElementById('enq-form');
    var enqFormWrap = document.getElementById('enq-form-wrap');
    var enqThanks = document.getElementById('enq-thanks');
    var enqThanksMsg = document.getElementById('enq-thanks-msg');
    var enqError = document.getElementById('enq-error');
    var enqType = document.getElementById('enq-f-type');
    var enqSubmit = enqForm.querySelector('.cr-submit');
    var enqLastTrigger = null;
    var enqCopy = {
      staffing: { eyebrow: 'Submit your staffing requirement', title: 'Tell us about the talent you need', msg: 'Job description, key skills, budget or anything else' },
      hr: { eyebrow: 'Discuss your HR needs', title: 'Tell us about your HR priorities', msg: 'Current challenges, team setup or what you’d like to achieve' },
      any: { eyebrow: 'Build your team with us', title: 'Tell us what you need', msg: 'Roles, HR priorities, timelines or anything else' }
    };

    var enqSetMode = function (mode) {
      enqType.value = mode;
      var copy = enqCopy[mode] || enqCopy.any;
      document.getElementById('enq-eyebrow').textContent = copy.eyebrow;
      document.getElementById('enq-title').textContent = copy.title;
      document.getElementById('enq-f-msg').placeholder = copy.msg;
      enqForm.querySelectorAll('[data-enq]').forEach(function (group) {
        var on = group.getAttribute('data-enq') === mode;
        group.hidden = !on;
        group.querySelectorAll('input, select, textarea').forEach(function (el) { el.disabled = !on; });
      });
    };

    var enqOpen = function (mode, trigger) {
      enqForm.reset();
      var chosen = mode === 'hr' || mode === 'staffing';
      enqSetMode(chosen ? mode : '');
      enqError.textContent = '';
      enqForm.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
      enqSubmit.disabled = false;
      enqFormWrap.hidden = false;
      enqThanks.hidden = true;
      enqLastTrigger = trigger;
      enqModal.classList.add('open');
      document.body.classList.add('cr-modal-open');
      (chosen ? document.getElementById('enq-f-name') : enqType).focus();
    };

    var enqClose = function () {
      if (!enqModal.classList.contains('open')) return;
      enqModal.classList.remove('open');
      document.body.classList.remove('cr-modal-open');
      if (enqLastTrigger) enqLastTrigger.focus();
    };

    document.querySelectorAll('.js-enquiry').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        enqOpen(link.getAttribute('data-enquiry'), link);
      });
    });
    enqType.addEventListener('change', function () { enqSetMode(enqType.value); });

    document.getElementById('enq-close').addEventListener('click', enqClose);
    document.getElementById('enq-done').addEventListener('click', enqClose);
    enqModal.addEventListener('click', function (e) { if (e.target === enqModal) enqClose(); });
    document.addEventListener('keydown', function (e) {
      if (!enqModal.classList.contains('open')) return;
      if (e.key === 'Escape') { enqClose(); return; }
      // Keep Tab focus inside the popup
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(enqModal.querySelectorAll('button, input, select, textarea'), function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    var enqValidate = function () {
      var firstBad = null;
      enqForm.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (el.disabled || el.type === 'checkbox') return;
        var ok = el.checkValidity();
        if (ok) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
        if (!ok && !firstBad) firstBad = el;
      });
      var msg = '';
      if (firstBad) {
        msg = firstBad.type === 'email' && firstBad.value ? 'Please enter a valid email address.'
          : firstBad.type === 'number' ? 'Please enter the number of positions as a whole number.'
          : 'Please fill in all required fields marked *.';
      } else if (!document.getElementById('enq-f-consent').checked) {
        msg = 'Please tick the consent box to continue.';
        firstBad = document.getElementById('enq-f-consent');
      }
      enqError.textContent = msg;
      if (firstBad) firstBad.focus();
      return !msg;
    };

    var enqShowThanks = function (message) {
      enqThanksMsg.textContent = message;
      enqFormWrap.hidden = true;
      enqThanks.hidden = false;
      document.getElementById('enq-done').focus();
    };

    enqForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!enqValidate()) return;
      var data = new FormData(enqForm);
      var isHr = data.get('enquiry_type') === 'hr';
      var endpoint = enqForm.getAttribute('data-endpoint');

      if (endpoint) {
        enqSubmit.disabled = true;
        fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
          .then(function (res) {
            if (!res.ok) throw new Error(res.status);
            enqShowThanks('We’ve received your ' + (isHr ? 'HR enquiry' : 'staffing requirement') + '. Our team will get in touch within one business day.');
          })
          .catch(function () {
            enqSubmit.disabled = false;
            enqError.textContent = 'Something went wrong sending your enquiry. Please try again, or email us at info@talnxt.com.';
          });
        return;
      }

      var val = function (k) { return data.get(k) || '-'; };
      var lines = [
        'Name: ' + data.get('name'),
        'Company: ' + data.get('company'),
        'Email: ' + data.get('email'),
        'Phone: ' + data.get('phone'),
        ''
      ].concat(isHr ? [
        'Area of interest: ' + val('hr_area'),
        'Company size: ' + val('company_size'),
        'Timeline: ' + val('timeline')
      ] : [
        'Role(s) / skills: ' + val('roles'),
        'Number of positions: ' + val('positions'),
        'Engagement model: ' + val('engagement_model'),
        'Work location / mode: ' + val('location'),
        'Needed by: ' + val('start')
      ], ['', data.get('message') || '']);
      var subject = (isHr ? 'People & HR solutions enquiry' : 'Staffing requirement') + ' – ' + data.get('company');
      window.location.href = 'mailto:info@talnxt.com?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(lines.join('\n'));
      enqShowThanks('Your email app has opened with your details filled in. Please send the email to complete your enquiry, and our team will get in touch within one business day.');
    });
  }

  // Home coverage cards: each tag toggles its details in the card's panel and
  // swaps the corner illustration to match (Escape or the close button collapses it).
  document.querySelectorAll('.cov-card').forEach(function (card) {
    var panel = card.querySelector('.cov-panel');
    if (!panel) return;
    var tags = Array.prototype.slice.call(card.querySelectorAll('.cov-tag'));
    var details = Array.prototype.slice.call(panel.querySelectorAll('.cov-detail'));
    var arts = Array.prototype.slice.call(card.querySelectorAll('.cov-art [data-art]'));
    var closeBtn = panel.querySelector('.cov-close');

    function setArt(name) {
      if (!arts.some(function (g) { return g.getAttribute('data-art') === name; })) name = 'default';
      arts.forEach(function (g) { g.classList.toggle('on', g.getAttribute('data-art') === name); });
    }
    function collapse() {
      var active = card.querySelector('.cov-tag[aria-expanded="true"]');
      tags.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
      panel.classList.remove('open');
      setArt('default');
      return active;
    }

    tags.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-expanded') === 'true') { collapse(); return; }
        tags.forEach(function (b) { b.setAttribute('aria-expanded', String(b === btn)); });
        details.forEach(function (d) { d.hidden = d.id !== btn.getAttribute('aria-controls'); });
        panel.classList.add('open');
        setArt(btn.getAttribute('data-art'));
      });
    });
    if (closeBtn) closeBtn.addEventListener('click', function () {
      var active = collapse();
      if (active) active.focus();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !panel.classList.contains('open')) return;
      var active = collapse();
      if (active) active.focus();
    });
  });

  // Home testimonials carousel: cards per view comes from the CSS --per value
  // (3 / 2 / 1), so dots and the last stop are rebuilt on resize. Auto-advances
  // every 5.5s, pausing on hover, keyboard focus, touch and hidden tabs; it stays
  // manual-only for reduced-motion users. Arrows, dots, swipe and ←/→ keys navigate.
  var tst = document.querySelector('.tst-carousel');
  if (tst) {
    var tstTrack = tst.querySelector('.tst-track');
    var tstSlides = Array.prototype.slice.call(tstTrack.children);
    var tstDots = tst.querySelector('.tst-dots');
    var tstReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var tstIndex = 0, tstMax = -1, tstTimer = null, tstHover = false, tstFocus = false, tstTouchX = null, tstTouchY = 0;

    tstSlides.forEach(function (s, i) { s.setAttribute('aria-label', (i + 1) + ' of ' + tstSlides.length); });

    var tstRender = function () {
      tstTrack.style.transform = 'translateX(' + (-tstSlides[tstIndex].offsetLeft) + 'px)';
      Array.prototype.forEach.call(tstDots.children, function (d, i) { d.setAttribute('aria-current', String(i === tstIndex)); });
    };
    var tstBuild = function () {
      var per = parseInt(getComputedStyle(tstTrack).getPropertyValue('--per'), 10) || 1;
      var max = Math.max(0, tstSlides.length - per);
      if (max !== tstMax) {
        tstMax = max;
        tstIndex = Math.min(tstIndex, tstMax);
        tstDots.innerHTML = '';
        for (var i = 0; i <= tstMax; i++) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'tst-dot';
          dot.setAttribute('aria-label', 'Show testimonials from card ' + (i + 1));
          dot.addEventListener('click', tstGo.bind(null, i));
          tstDots.appendChild(dot);
        }
      }
      tstRender();
    };
    var tstStop = function () { clearInterval(tstTimer); tstTimer = null; };
    var tstStart = function () {
      tstStop();
      if (tstReduce.matches || tstHover || tstFocus || tstTouchX !== null || document.hidden || tstMax < 1) return;
      tstTimer = setInterval(function () { tstGo(tstIndex + 1); }, 5500);
    };
    function tstGo(i) {
      tstIndex = (i + tstMax + 1) % (tstMax + 1);
      tstRender();
      tstStart();
    }

    tst.querySelector('.tst-prev').addEventListener('click', function () { tstGo(tstIndex - 1); });
    tst.querySelector('.tst-next').addEventListener('click', function () { tstGo(tstIndex + 1); });
    tst.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); tstGo(tstIndex - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); tstGo(tstIndex + 1); }
    });
    tst.addEventListener('mouseenter', function () { tstHover = true; tstStop(); });
    tst.addEventListener('mouseleave', function () { tstHover = false; tstStart(); });
    tst.addEventListener('focusin', function () { tstFocus = true; tstStop(); });
    tst.addEventListener('focusout', function (e) {
      if (tst.contains(e.relatedTarget)) return;
      tstFocus = false; tstStart();
    });
    tst.addEventListener('touchstart', function (e) {
      tstTouchX = e.touches[0].clientX; tstTouchY = e.touches[0].clientY; tstStop();
    }, { passive: true });
    tst.addEventListener('touchend', function (e) {
      if (tstTouchX === null) return;
      var dx = e.changedTouches[0].clientX - tstTouchX, dy = e.changedTouches[0].clientY - tstTouchY;
      tstTouchX = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) tstGo(tstIndex + (dx < 0 ? 1 : -1));
      else tstStart();
    });
    tst.addEventListener('touchcancel', function () { tstTouchX = null; tstStart(); });
    document.addEventListener('visibilitychange', tstStart);
    if (tstReduce.addEventListener) tstReduce.addEventListener('change', tstStart);
    else if (tstReduce.addListener) tstReduce.addListener(tstStart);

    var tstResizeFrame = null;
    window.addEventListener('resize', function () {
      if (tstResizeFrame) cancelAnimationFrame(tstResizeFrame);
      tstResizeFrame = requestAnimationFrame(function () { tstBuild(); tstStart(); });
    });
    tstBuild();
    tstStart();
  }

  // Card marquees (People & HR — HR Tech capabilities, About — Why TalNXT): clone the
  // cards once (hidden from assistive tech) so the CSS animation loops seamlessly, and
  // add a pause button below the strip. Reduced-motion users keep the static, scrollable row.
  function initMarquee(trackSel, prefix, label) {
    var track = document.querySelector(trackSel);
    if (!track || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var marquee = track.parentNode;
    Array.prototype.slice.call(track.children).forEach(function (card) {
      var clone = card.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('inert', '');
      track.appendChild(clone);
    });
    marquee.classList.add('is-looping');

    var controls = document.createElement('div');
    controls.className = 'container ' + prefix + '-controls';
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = prefix + '-toggle';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', function () {
      toggle.setAttribute('aria-pressed', String(marquee.classList.toggle('is-paused')));
    });
    controls.appendChild(toggle);
    marquee.parentNode.insertBefore(controls, marquee.nextSibling);
  }
  initMarquee('.hta-track', 'hta', 'Pause moving capability cards');
  initMarquee('.ab-why-track', 'ab-why', 'Pause moving Why TalNXT cards');
});
