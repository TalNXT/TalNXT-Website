/* Careers page (careers.html): function filter for the open-role cards.
   To add a role, copy an <li class="cr-job …"> in careers.html and set its data-func
   (eng, cloud or data), then update the count in that filter button. */
(function () {
  var buttons = document.querySelectorAll('.cr-filter');
  var jobs = document.querySelectorAll('.cr-job');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      jobs.forEach(function (job) { job.hidden = f !== 'all' && job.getAttribute('data-func') !== f; });
    });
  });
})();

/* Application popup: "Apply Now" on a card opens #cr-apply-modal pre-filled with that role.
   With data-endpoint set on the form, the application (resume file included) is POSTed there;
   without one, submitting opens a pre-filled email to info@talnxt.com, since this static site
   has no backend and an email link cannot carry the file. */
(function () {
  var modal = document.getElementById('cr-apply-modal');
  if (!modal) return;
  var form = document.getElementById('cr-apply-form');
  var formWrap = document.getElementById('cr-apply-form-wrap');
  var thanks = document.getElementById('cr-apply-thanks');
  var thanksMsg = document.getElementById('cr-apply-thanks-msg');
  var errorEl = document.getElementById('cr-apply-error');
  var fileInput = document.getElementById('cr-f-resume');
  var fileLabel = modal.querySelector('.cr-file');
  var fileName = document.getElementById('cr-f-resume-name');
  var fileHint = fileName.textContent;
  var submitBtn = form.querySelector('.cr-submit');
  var MAX_BYTES = 5 * 1024 * 1024;
  var lastTrigger = null;
  var role = {};

  function text(el) { return el ? el.textContent.trim() : ''; }

  function resetFile() {
    fileName.textContent = fileHint;
    fileLabel.classList.remove('has-file', 'is-invalid');
  }

  function open(card, trigger) {
    var meta = card.querySelectorAll('.cr-meta li');
    role = {
      title: text(card.querySelector('.cr-job-title')),
      type: text(card.querySelector('.cr-type')),
      location: text(meta[0]),
      experience: text(meta[1])
    };
    document.getElementById('cr-apply-title').textContent = role.title;
    document.getElementById('cr-apply-type').textContent = role.type;
    document.getElementById('cr-apply-loc').textContent = role.location;
    document.getElementById('cr-apply-exp').textContent = role.experience;
    form.reset();
    document.getElementById('cr-f-role').value = role.title + ' (' + role.type + ', ' + role.location + ')';
    resetFile();
    errorEl.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    submitBtn.disabled = false;
    formWrap.hidden = false;
    thanks.hidden = true;
    lastTrigger = trigger;
    modal.classList.add('open');
    document.body.classList.add('cr-modal-open');
    document.getElementById('cr-f-name').focus();
  }

  function close() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    document.body.classList.remove('cr-modal-open');
    if (lastTrigger) lastTrigger.focus();
  }

  document.querySelectorAll('.cr-apply').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      open(link.closest('.cr-job'), link);
    });
  });

  document.getElementById('cr-apply-close').addEventListener('click', close);
  document.getElementById('cr-apply-done').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    // Keep Tab focus inside the popup
    if (e.key !== 'Tab') return;
    var items = Array.prototype.filter.call(modal.querySelectorAll('button, input, select, textarea'), function (el) {
      return !el.disabled && el.type !== 'hidden' && el.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  fileInput.addEventListener('change', function () {
    var f = fileInput.files[0];
    if (!f) { resetFile(); return; }
    fileName.textContent = f.name;
    fileLabel.classList.add('has-file');
    fileLabel.classList.remove('is-invalid');
  });

  function validate() {
    var msg = '';
    var firstBad = null;
    ['cr-f-name', 'cr-f-email', 'cr-f-phone', 'cr-f-exp', 'cr-f-linkedin'].forEach(function (id) {
      var el = document.getElementById(id);
      var ok = el.checkValidity();
      if (ok) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
      if (!ok && !firstBad) {
        firstBad = el;
        msg = id === 'cr-f-linkedin' ? 'Please enter your LinkedIn profile as a full link (https://…).'
          : id === 'cr-f-exp' ? 'Please enter your experience as a number of years.'
          : 'Please fill in your name, a valid email and your phone number.';
      }
    });
    var f = fileInput.files[0];
    var badFile = !f || !/\.(pdf|docx?)$/i.test(f.name) || f.size > MAX_BYTES;
    fileLabel.classList.toggle('is-invalid', badFile);
    if (badFile && !msg) {
      msg = !f ? 'Please upload your resume.' : f.size > MAX_BYTES ? 'Your resume must be 5 MB or smaller.' : 'Please upload a PDF, DOC or DOCX file.';
      firstBad = fileInput;
    }
    var consent = document.getElementById('cr-f-consent');
    if (!consent.checked && !msg) { msg = 'Please tick the consent box to continue.'; firstBad = consent; }
    errorEl.textContent = msg;
    if (firstBad) firstBad.focus();
    return !msg;
  }

  function showThanks(message) {
    thanksMsg.textContent = message;
    formWrap.hidden = true;
    thanks.hidden = false;
    document.getElementById('cr-apply-done').focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;
    var data = new FormData(form);
    var endpoint = form.getAttribute('data-endpoint');

    if (endpoint) {
      submitBtn.disabled = true;
      fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          showThanks('We’ve received your application for ' + role.title + '. Our team will review your resume and get in touch if your profile is a fit.');
        })
        .catch(function () {
          submitBtn.disabled = false;
          errorEl.textContent = 'Something went wrong sending your application. Please try again, or email your resume to info@talnxt.com.';
        });
      return;
    }

    var resume = fileInput.files[0].name;
    var lines = [
      'Role: ' + data.get('role'),
      'Name: ' + data.get('name'),
      'Email: ' + data.get('email'),
      'Phone: ' + data.get('phone'),
      'Current location: ' + (data.get('location') || '-'),
      'Total experience: ' + (data.get('experience') ? data.get('experience') + ' years' : '-'),
      'Notice period: ' + (data.get('notice') || '-'),
      'LinkedIn: ' + (data.get('linkedin') || '-'),
      '',
      data.get('message') || '',
      '',
      'Resume: ' + resume + ' (attached)'
    ];
    window.location.href = 'mailto:info@talnxt.com?subject=' +
      encodeURIComponent('Application: ' + role.title + ' – ' + data.get('name')) +
      '&body=' + encodeURIComponent(lines.join('\n'));
    showThanks('Your email app has opened with your details filled in. Please attach your resume (' + resume + ') and send the email to complete your application.');
  });
})();
