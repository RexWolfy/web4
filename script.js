// Web4 — everything here runs in the browser. Nothing is sent or stored.
// Loaded as script.js?v=N: after changing it, raise N on every page (see styles.css).

(() => {
  document.getElementById('year').textContent = new Date().getFullYear();

  // Fade blocks in as they scroll into view. Without IntersectionObserver
  // the class is never added, so everything simply stays visible.
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('can-reveal');
    const observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry, i) => {
        entry.target.style.transitionDelay = `${i * 80}ms`; // stagger blocks that appear together
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    reveals.forEach((el) => observer.observe(el));
  }

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Ledger (privacy page): every entry is editable, and the one node confirms whatever you write
  const ledger = document.getElementById('ledger');
  if (ledger) {
    const ledgerMsg = document.getElementById('ledger-msg');
    ledger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.target.blur();
    });
    ledger.addEventListener('change', (event) => {
      const entry = event.target.getAttribute('aria-label');
      ledgerMsg.textContent = event.target.value.trim()
        ? `${entry} rewritten. Confirmed by 1/1 nodes`
        : `${entry} deleted. It never happened`;
    });
  }

  // Contact form (contact page): validate locally, show a confirmation, keep nothing.
  // Links can preselect the topic, e.g. contact.html?topic=careers
  const contact = document.getElementById('contact-form');
  if (contact) {
    const topic = document.getElementById('contact-topic');
    const preset = new URLSearchParams(window.location.search).get('topic');
    if ([...topic.options].some((option) => option.value === preset)) topic.value = preset;

    // Required fields, each with a check that returns an error message ('' when fine)
    const fields = [
      ['contact-name', (value) => (value ? '' : 'ERR: name required')],
      ['contact-email', (value) => {
        if (!value) return 'ERR: email address required';
        return EMAIL.test(value) ? '' : 'ERR: that doesn’t look like an email address';
      }],
      ['contact-message', (value) => (value ? '' : 'ERR: message required')],
    ].map(([id, check]) => ({
      input: document.getElementById(id),
      msg: document.getElementById(`${id}-msg`),
      check,
    }));

    const validate = ({ input, msg, check }) => {
      const error = check(input.value.trim());
      msg.textContent = error;
      input.closest('.form__row').classList.toggle('is-invalid', Boolean(error));
      if (error) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      return !error;
    };

    contact.addEventListener('submit', (event) => {
      event.preventDefault();
      const invalid = fields.filter((field) => !validate(field));
      if (invalid.length) return invalid[0].input.focus();

      const done = document.getElementById('contact-done');
      document.getElementById('contact-done-email').textContent = fields[1].input.value.trim();
      contact.hidden = true;
      done.hidden = false;
      done.focus();
    });

    fields.forEach((field) => field.input.addEventListener('input', () => {
      if (field.input.hasAttribute('aria-invalid')) validate(field);
    }));
  }

  // Sign-up form (home page only): validate locally, show a confirmation, keep nothing
  const form = document.getElementById('signup-form');
  if (!form) return;

  const input = document.getElementById('email');
  const msg = document.getElementById('email-msg');
  const done = document.getElementById('signup-done');
  const doneEmail = document.getElementById('signup-done-email');

  const showError = (text) => {
    msg.textContent = text;
    form.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  const clearError = () => {
    msg.textContent = '';
    form.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!email) return showError('ERR: email address required');
    if (!EMAIL.test(email)) return showError('ERR: that doesn’t look like an email address');

    clearError();
    doneEmail.textContent = email;
    form.hidden = true;
    done.hidden = false;
    done.focus();
  });

  input.addEventListener('input', () => {
    if (form.classList.contains('is-invalid')) clearError();
  });
})();
