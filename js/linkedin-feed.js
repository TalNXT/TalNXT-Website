/* "Latest from LinkedIn" section on the home page (#linkedin in index.html).
   Content comes from data/linkedin-posts.json; edit that file to change the posts (instructions
   are inside it). No scraping or unofficial APIs: each post is either a card built from the JSON
   or LinkedIn's official "Embed this post" iframe.
   The section stays hidden if the JSON can't be loaded, so a broken file never shows an empty block. */
(function () {
  var section = document.getElementById('linkedin');
  var grid = document.getElementById('li-grid');
  if (!section || !grid || !window.fetch) return;

  // Only LinkedIn links are accepted, so a typo in the JSON can't point visitors elsewhere.
  function linkedinUrl(u) { return typeof u === 'string' && /^https:\/\/(www\.)?linkedin\.com\//.test(u) ? u : ''; }
  function embedUrl(u) { return typeof u === 'string' && /^https:\/\/www\.linkedin\.com\/embed\//.test(u) ? u : ''; }
  function imageUrl(u) { return typeof u === 'string' && (/^https:\/\//.test(u) || /^[\w\-./]+$/.test(u)) && u.indexOf('..') === -1 ? u : ''; }
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return +m[3] + ' ' + months[+m[2] - 1] + ' ' + m[1];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function embedCard(p, src) {
    var card = el('div', 'li-card li-card-embed');
    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = str(p.title, 140) || 'TalNXT post on LinkedIn';
    frame.loading = 'lazy';
    frame.height = String(Math.min(Math.max(parseInt(p.embedHeight, 10) || 560, 300), 1200));
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    card.appendChild(frame);
    return card;
  }

  function linkCard(p, url) {
    var card = el('a', 'li-card li-card-link');
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener';
    var img = imageUrl(p.image);
    if (img) {
      var pic = el('img', 'li-card-img');
      pic.src = img;
      pic.alt = '';
      pic.loading = 'lazy';
      card.appendChild(pic);
    }
    var body = el('div', 'li-card-body');
    var date = formatDate(p.date);
    if (date) {
      var t = el('time', 'li-card-date', date);
      t.dateTime = p.date;
      body.appendChild(t);
    }
    body.appendChild(el('h3', 'li-card-title', str(p.title, 140)));
    var excerpt = str(p.excerpt, 240);
    if (excerpt) body.appendChild(el('p', 'li-card-excerpt', excerpt));
    body.appendChild(el('span', 'li-card-more', 'Read on LinkedIn →'));
    card.appendChild(body);
    return card;
  }

  fetch('data/linkedin-posts.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) {
      var follow = section.querySelector('.li-follow');
      var company = linkedinUrl(data.companyUrl);
      if (follow && company) follow.href = company;

      var max = Math.min(Math.max(parseInt(data.maxItems, 10) || 3, 1), 12);
      var shown = 0;
      (Array.isArray(data.posts) ? data.posts : []).forEach(function (p) {
        if (shown >= max || !p || typeof p !== 'object') return;
        var src = embedUrl(p.embedUrl);
        var url = linkedinUrl(p.url);
        var card = src ? embedCard(p, src) : url && str(p.title, 140) ? linkCard(p, url) : null;
        if (!card) return;
        grid.appendChild(card);
        shown++;
      });
      grid.hidden = shown === 0;
      section.hidden = false;
    })
    .catch(function () { /* leave the section hidden */ });
})();
