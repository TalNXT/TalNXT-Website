/* LinkedIn feed on the Thought Leadership page (thought-leadership.html, #perspectives).
   Content comes from data/linkedin-posts.json; edit that file to change the posts (instructions
   are inside it). No scraping or unofficial APIs: each post is either LinkedIn's official
   "Embed this post" iframe or a card built from the JSON.
   Shows pageSize posts at a time with a "Show more" button. If the JSON can't be loaded or has no
   usable posts, a short message with a link to the LinkedIn page is shown instead. */
(function () {
  var feed = document.getElementById('li-feed');
  var more = document.getElementById('li-more');
  var empty = document.getElementById('li-empty');
  if (!feed) return;

  var COMPANY = 'TalNXT Technologies';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LI_ICON = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

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

  function liIcon(cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', LI_ICON);
    svg.appendChild(path);
    return svg;
  }

  // Header row on every post: LinkedIn badge, date, and a link out. (The embed itself already
  // shows the company name and logo, so the header doesn't repeat them.)
  function postHead(p, url, label) {
    var head = el('div', 'li-post-head');
    head.appendChild(liIcon('li-post-badge'));
    var who = el('div', 'li-post-who');
    var date = formatDate(p.date);
    if (date) {
      var t = el('time', 'li-post-name', date);
      t.dateTime = p.date;
      who.appendChild(t);
    }
    who.appendChild(el('span', 'li-post-date', label));
    head.appendChild(who);
    if (url) {
      var a = el('a', 'li-post-open', 'View on LinkedIn');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', 'View this post on LinkedIn (opens in a new tab)');
      head.appendChild(a);
    }
    return head;
  }

  function embedPost(p, src, url) {
    var card = el('article', 'li-post');
    card.appendChild(postHead(p, url, 'Posted on LinkedIn'));
    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = str(p.title, 140) || 'TalNXT post on LinkedIn';
    frame.loading = 'lazy';
    frame.height = String(clamp(p.embedHeight, 560, 300, 1200));
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    card.appendChild(frame);
    return card;
  }

  function linkPost(p, url) {
    var card = el('article', 'li-post li-post-card');
    card.appendChild(postHead(p, '', COMPANY + ' on LinkedIn'));
    var link = el('a', 'li-post-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    var img = imageUrl(p.image);
    if (img) {
      var pic = el('img', 'li-post-img');
      pic.src = img;
      pic.alt = '';
      pic.loading = 'lazy';
      link.appendChild(pic);
    }
    var body = el('div', 'li-post-body');
    body.appendChild(el('h3', 'li-post-title', str(p.title, 140)));
    var excerpt = str(p.excerpt, 280);
    if (excerpt) body.appendChild(el('p', 'li-post-excerpt', excerpt));
    body.appendChild(el('span', 'li-post-more', 'Read on LinkedIn →'));
    link.appendChild(body);
    card.appendChild(link);
    return card;
  }

  function build(p) {
    if (!p || typeof p !== 'object') return null;
    var url = linkedinUrl(p.url);
    var src = embedUrl(p.embedUrl);
    if (src) return embedPost(p, src, url);
    if (url && str(p.title, 140)) return linkPost(p, url);
    return null;
  }

  function showEmpty() {
    if (empty) empty.hidden = false;
    if (more) more.hidden = true;
  }

  fetch('data/linkedin-posts.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) {
      var company = linkedinUrl(data.companyUrl);
      if (company) {
        Array.prototype.forEach.call(document.querySelectorAll('.li-follow'), function (a) { a.href = company; });
      }
      var cards = (Array.isArray(data.posts) ? data.posts : []).map(build).filter(Boolean);
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
    })
    .catch(showEmpty);
})();
