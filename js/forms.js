/* TalNXT website forms: backend settings and shared helpers.
   Used by the enquiry popup (js/main.js) and the job application popup (js/careers.js).
   Load this file BEFORE main.js and careers.js.

   SETUP (see docs/SETUP.md):
     apiBase           The Cloudflare Worker URL, no trailing slash,
                       e.g. 'https://talnxt-forms.your-subdomain.workers.dev'
     turnstileSiteKey  The Turnstile widget's SITE key. It is public, so it is safe to commit.
                       Cloudflare's test key '1x00000000000000000000AA' always passes (local testing only).
   While either value is empty, the forms fall back to opening a pre-filled email to info@talnxt.com. */
window.TALNXT_FORMS_CONFIG = window.TALNXT_FORMS_CONFIG || {
  apiBase: '',
  turnstileSiteKey: ''
};

window.TalnxtForms = (function () {
  var cfg = window.TALNXT_FORMS_CONFIG;
  var loading = null;

  function enabled() {
    return !!(cfg.apiBase && cfg.turnstileSiteKey);
  }

  // Turnstile's script loads only when a form is first opened, so other pages don't pay for it.
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      window.talnxtTurnstileReady = function () { resolve(window.turnstile); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=talnxtTurnstileReady';
      s.async = true;
      s.onerror = function () { loading = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* One Turnstile widget per form, rendered into the form's .cf-turnstile-slot. It stays
     invisible unless Cloudflare needs the visitor to click (appearance: interaction-only). */
  function guard(form) {
    var slot = form.querySelector('.cf-turnstile-slot');
    var id = null;
    var failed = false;
    return {
      // Call when the popup opens: renders on first use, otherwise refreshes the token.
      mount: function () {
        if (!enabled() || !slot) return;
        if (id !== null) { window.turnstile.reset(id); return; }
        loadTurnstile().then(function (ts) {
          if (id !== null) return;
          failed = false;
          id = ts.render(slot, {
            sitekey: cfg.turnstileSiteKey,
            action: form.getAttribute('data-form') || 'form',
            size: 'flexible',
            appearance: 'interaction-only',
            'refresh-expired': 'auto'
          });
        }).catch(function () { failed = true; });
      },
      reset: function () { if (id !== null && window.turnstile) window.turnstile.reset(id); },
      token: function () { return id !== null && window.turnstile ? window.turnstile.getResponse(id) || '' : ''; },
      failed: function () { return failed; }
    };
  }

  /* POSTs FormData to the Worker. Resolves with {ok, id}; rejects with an Error carrying
     .userMessage (safe to show), .code and .fields (field name -> message) when the server sent them. */
  function submit(path, data) {
    data.set('page', window.location.pathname);
    return fetch(cfg.apiBase.replace(/\/+$/, '') + path, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' }
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (res.ok && body && body.ok) return body;
        var err = new Error('submit_failed');
        var e = (body && body.error) || {};
        err.code = e.code || 'http_' + res.status;
        err.userMessage = e.message || '';
        err.fields = e.fields || null;
        throw err;
      });
    });
  }

  // Disables the button and shows a "Sending…" label while a request is in flight.
  function setBusy(btn, busy, label) {
    if (btn._idleHtml === undefined) btn._idleHtml = btn.innerHTML;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) btn.textContent = label || 'Sending…';
    else btn.innerHTML = btn._idleHtml;
  }

  // Marks the fields the server rejected and returns the first one (to focus).
  function markInvalid(form, fields) {
    var first = null;
    Object.keys(fields || {}).forEach(function (name) {
      var el = form.elements[name];
      if (!el || !el.setAttribute) return;
      el.setAttribute('aria-invalid', 'true');
      if (!first) first = el;
    });
    return first;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return {
    enabled: enabled,
    guard: guard,
    submit: submit,
    setBusy: setBusy,
    markInvalid: markInvalid,
    formatBytes: formatBytes
  };
})();
