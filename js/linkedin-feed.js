/* LinkedIn feed on the Thought Leadership page (thought-leadership.html, #perspectives).
   Live posts come from the forms Worker (/api/linkedin-posts, synced from the TalNXT LinkedIn page
   through LinkedIn's official API). When that has nothing recent, the static posts in
   data/linkedin-posts.json are shown (edit that file to change them; instructions are inside it).
   No scraping or unofficial APIs. Each card links to the original post on LinkedIn.
   Each card is compact (topic, date, title, a short excerpt); "Read more" expands it in place.
   Shows pageSize cards at a time with a "Show more" button. If the JSON can't be loaded or has no
   usable posts, a short message with a link to the LinkedIn page is shown instead. */
(function () {
  var feed = document.getElementById('li-feed');
  var more = document.getElementById('li-more');
  var empty = document.getElementById('li-empty');
  if (!feed) return;

  var TONES = ['blue', 'teal', 'lav', 'gold'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var LI_ICON = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';
  var CHEVRON = 'm6 9 6 6 6-6';
  var BULLET = /^(•|🔹|-)\s*/;
  var uid = 0;

  // Only LinkedIn links are accepted, so a typo in the JSON can't point visitors elsewhere.
  function linkedinUrl(u) { return typeof u === 'string' && /^https:\/\/(www\.)?linkedin\.com\//.test(u) ? u : ''; }
  function embedUrl(u) { return typeof u === 'string' && /^https:\/\/www\.linkedin\.com\/embed\//.test(u) ? u : ''; }
  function imageUrl(u) { return typeof u === 'string' && (/^https:\/\//.test(u) || /^[\w\-./]+$/.test(u)) && u.indexOf('..') === -1 ? u : ''; }
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function clamp(v, def, lo, hi) { return Math.min(Math.max(parseInt(v, 10) || def, lo), hi); }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function icon(d, cls, stroke) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (stroke) {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    } else {
      path.setAttribute('fill', 'currentColor');
    }
    svg.appendChild(path);
    return svg;
  }

  // One body paragraph: plain lines become a <p>; lines starting with a bullet become a <ul>.
  function renderParagraph(text, into) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var p = null, ul = null;
    lines.forEach(function (line) {
      if (BULLET.test(line)) {
        if (!ul) { ul = el('ul'); into.appendChild(ul); p = null; }
        ul.appendChild(el('li', '', line.replace(BULLET, '')));
      } else {
        if (!p) { p = el('p'); into.appendChild(p); ul = null; }
        else p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(line));
      }
    });
  }

  function toggleButton(controls) {
    var btn = el('button', 'li-post-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', controls);
    var label = el('span', '', 'Read more');
    btn.appendChild(label);
    btn.appendChild(icon(CHEVRON, 'li-post-chev', true));
    return { btn: btn, label: label };
  }

  function linkOut(url) {
    var a = el('a', 'li-post-open');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'Open this post on LinkedIn (new tab)');
    a.appendChild(icon(LI_ICON, 'li-post-li'));
    a.appendChild(el('span', '', 'View post'));
    return a;
  }

  function wireToggle(card, t, onExpand) {
    t.btn.addEventListener('click', function () {
      var open = !card.classList.contains('is-open');
      card.classList.toggle('is-open', open);
      t.btn.setAttribute('aria-expanded', String(open));
      t.label.textContent = open ? 'Show less' : 'Read more';
      if (open && onExpand) onExpand();
      if (!open && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function cardShell(p, i) {
    var card = el('article', 'li-post tone-' + TONES[i % TONES.length]);
    var img = imageUrl(p.image);
    if (img) {
      var pic = el('img', 'li-post-img');
      pic.src = img;
      pic.alt = '';
      pic.loading = 'lazy';
      card.appendChild(pic);
    }
    var top = el('div', 'li-post-top');
    var topic = str(p.topic, 30);
    if (topic) top.appendChild(el('span', 'li-post-topic', topic));
    var date = formatDate(p.date);
    if (date) {
      var t = el('time', 'li-post-date', date);
      t.dateTime = p.date;
      top.appendChild(t);
    }
    card.appendChild(top);
    return card;
  }

  // Normal card: built from the text in the JSON.
  function textCard(p, i, url) {
    var card = cardShell(p, i);
    card.appendChild(el('h3', 'li-post-title', str(p.title, 200)));
    var excerpt = str(p.excerpt, 400);
    if (excerpt) card.appendChild(el('p', 'li-post-excerpt', excerpt));

    var body = (Array.isArray(p.body) ? p.body : []).map(function (b) { return str(b, 1500); }).filter(Boolean);
    var foot = el('div', 'li-post-foot');
    if (body.length) {
      var id = 'li-post-' + (++uid);
      var full = el('div', 'li-post-full');
      full.id = id;
      body.slice(0, 20).forEach(function (b) { renderParagraph(b, full); });
      card.appendChild(full);
      var t = toggleButton(id);
      wireToggle(card, t);
      foot.appendChild(t.btn);
    }
    foot.appendChild(linkOut(url));
    card.appendChild(foot);
    return card;
  }

  // Fallback for a post with no title: LinkedIn's own embed, shown clipped until "Read more".
  function embedCard(p, i, src, url) {
    var card = cardShell(p, i);
    card.classList.add('li-post-embed');
    var id = 'li-post-' + (++uid);
    var wrap = el('div', 'li-post-frame');
    wrap.id = id;
    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = 'TalNXT post on LinkedIn';
    frame.loading = 'lazy';
    frame.height = String(clamp(p.embedHeight, 560, 300, 1200));
    frame.setAttribute('frameborder', '0');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    wrap.appendChild(frame);
    card.appendChild(wrap);
    var foot = el('div', 'li-post-foot');
    var t = toggleButton(id);
    wireToggle(card, t);
    foot.appendChild(t.btn);
    if (url) foot.appendChild(linkOut(url));
    card.appendChild(foot);
    return card;
  }

  function build(p, i) {
    if (!p || typeof p !== 'object') return null;
    var url = linkedinUrl(p.url);
    if (url && str(p.title, 200)) return textCard(p, i, url);
    var src = embedUrl(p.embedUrl);
    if (src) return embedCard(p, i, src, url);
    return null;
  }

  function showEmpty() {
    if (empty) empty.hidden = false;
    if (more) more.hidden = true;
  }

  function getJson(url, opts, timeoutMs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts)
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (d) { if (timer) clearTimeout(timer); return d; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  // Live posts come from the forms Worker (data-live on #li-feed), which syncs the LinkedIn page
  // through LinkedIn's official API. If it has no recent feed (404), errors or is slow, the static
  // posts in data/linkedin-posts.json are shown instead. The static file also sets the page size
  // and the Follow link.
  var liveUrl = feed.getAttribute('data-live') || '';
  var live = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(liveUrl)
    ? getJson(liveUrl, { mode: 'cors', credentials: 'omit' }, 4000)
        .then(function (d) { return d && d.ok && Array.isArray(d.posts) && d.posts.length ? d.posts : null; })
        .catch(function () { return null; })
    : Promise.resolve(null);
  var stat = getJson('data/linkedin-posts.json', { cache: 'no-cache' }, 8000).catch(function () { return null; });

  Promise.all([live, stat]).then(function (r) {
    var livePosts = r[0], data = r[1] || {};
    var company = linkedinUrl(data.companyUrl);
    if (company) {
      Array.prototype.forEach.call(document.querySelectorAll('.li-follow'), function (a) { a.href = company; });
    }
    var posts = livePosts || (Array.isArray(data.posts) ? data.posts : []);
    feed.setAttribute('data-source', livePosts ? 'live' : 'static');
    var cards = posts.map(build).filter(Boolean);
    if (!cards.length) return showEmpty();

    var pageSize = clamp(data.pageSize, 6, 1, 24);
    var shown = 0;
    function next() {
      cards.slice(shown, shown + pageSize).forEach(function (c) { feed.appendChild(c); });
      shown = Math.min(shown + pageSize, cards.length);
      if (more) more.hidden = shown >= cards.length;
    }
    if (more) more.addEventListener('click', next);
    next();
  }).catch(showEmpty);
})();
