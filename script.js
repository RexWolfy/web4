// Web4 — everything here runs in the browser. Nothing is sent or stored.

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

  // Sign-up form (home page only): validate locally, show a confirmation, keep nothing
  const form = document.getElementById('signup-form');
  if (!form) return;

  const input = document.getElementById('email');
  const msg = document.getElementById('email-msg');
  const done = document.getElementById('signup-done');
  const doneEmail = document.getElementById('signup-done-email');
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
