/* TalNXT cookie consent + Google Analytics loader.
   Google Analytics (G-0LQ99HRMGH) is NOT loaded until the visitor accepts.
   Choice is remembered in localStorage ("talnxt_cookie_consent": "granted" | "denied").
   Any element with [data-cookie-settings] re-opens the banner. */
(function () {
  var GA_ID = 'G-0LQ99HRMGH';
  var KEY = 'talnxt_cookie_consent';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // Everything denied by default (Google Consent Mode).
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function readChoice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function saveChoice(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var gaLoaded = false;
  function enableAnalytics() {
    window['ga-disable-' + GA_ID] = false;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function disableAnalytics() {
    window['ga-disable-' + GA_ID] = true;
    gtag('consent', 'update', { analytics_storage: 'denied' });
    // Best-effort removal of any existing Google Analytics cookies.
    var host = location.hostname.split('.');
    var domains = ['', location.hostname, '.' + location.hostname];
    if (host.length > 2) domains.push('.' + host.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0 || name === '_gid' || name === '_gat') {
        domains.forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      }
    });
  }

  var choice = readChoice();
  if (choice === 'granted') enableAnalytics();
  else if (choice === 'denied') disableAnalytics();

  var CSS = '' +
    '#tn-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;max-width:760px;margin:0 auto;' +
    'background:#fff;color:var(--ink,#14203a);border:1px solid var(--line,#dbe1ea);border-radius:12px;' +
    'box-shadow:0 10px 40px rgba(10,18,36,.22);padding:16px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;' +
    'font-family:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:13.5px;line-height:1.5}' +
    '#tn-cookie[hidden]{display:none}' +
    '#tn-cookie p{margin:0;flex:1 1 320px}' +
    '#tn-cookie strong{display:block;font-size:14.5px;margin-bottom:2px}' +
    '#tn-cookie .tn-btns{display:flex;gap:10px;flex:0 0 auto}' +
    '#tn-cookie button{font:inherit;font-weight:700;border-radius:6px;padding:10px 18px;cursor:pointer;border:1.5px solid var(--accent,var(--primary,#1b5fc4))}' +
    '#tn-cookie .tn-accept{background:var(--accent,var(--primary,#1b5fc4));color:#fff}' +
    '#tn-cookie .tn-decline{background:#fff;color:var(--accent,var(--primary,#1b5fc4))}' +
    '#tn-cookie button:focus-visible{outline:3px solid #9bbcf0;outline-offset:2px}' +
    '.tn-cookie-link{background:none;border:none;padding:0;margin-left:10px;font:inherit;color:inherit;text-decoration:underline;cursor:pointer}' +
    '@media(max-width:520px){#tn-cookie .tn-btns{width:100%}#tn-cookie button{flex:1}}';

  var banner;
  function buildBanner() {
    if (banner) return banner;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    banner = document.createElement('div');
    banner.id = 'tn-cookie';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.hidden = true;
    banner.innerHTML =
      '<p><strong>Cookies &amp; analytics</strong>We use Google Analytics cookies to understand how visitors use this site and improve it. ' +
      'Analytics only runs if you accept. We do not use advertising cookies.</p>' +
      '<div class="tn-btns">' +
      '<button type="button" class="tn-decline">Decline</button>' +
      '<button type="button" class="tn-accept">Accept analytics</button></div>';
    document.body.appendChild(banner);
    banner.querySelector('.tn-accept').addEventListener('click', function () {
      saveChoice('granted'); enableAnalytics(); banner.hidden = true;
    });
    banner.querySelector('.tn-decline').addEventListener('click', function () {
      saveChoice('denied'); disableAnalytics(); banner.hidden = true;
    });
    return banner;
  }
  function showBanner() { buildBanner().hidden = false; }

  document.addEventListener('DOMContentLoaded', function () {
    if (!readChoice()) showBanner();

    // "Cookie settings" link next to the copyright line in the footer.
    var year = document.getElementById('year');
    if (year && year.parentNode && !document.querySelector('[data-cookie-settings]')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tn-cookie-link';
      b.setAttribute('data-cookie-settings', '');
      b.textContent = 'Cookie settings';
      year.parentNode.appendChild(b);
      buildBanner();
    }
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (t) showBanner();
    });
  });
})();
