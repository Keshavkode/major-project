const authForm = document.querySelector('#auth-form');
const authTabs = [...document.querySelectorAll('.auth-tab')];
const authTitle = document.querySelector('#auth-title');
const authSubmit = document.querySelector('#auth-submit');
const password = document.querySelector('#password');
const passwordHint = document.querySelector('#password-hint');
const confirmWrap = document.querySelector('#confirm-wrap');
const confirmPassword = document.querySelector('#confirm-password');
const notice = document.querySelector('#auth-notice');
const language = window.AgriSenseLanguage;

let mode = new URLSearchParams(window.location.search).get('mode') === 'register'
  ? 'register'
  : 'login';

function setMode(nextMode) {
  mode = nextMode;
  const isRegister = mode === 'register';

  authTitle.textContent = language.translate(isRegister ? 'startGrowing' : 'welcome');
  authSubmit.querySelector('[data-i18n]').textContent = language.translate(isRegister ? 'register' : 'signIn');
  password.autocomplete = isRegister ? 'new-password' : 'current-password';
  passwordHint.hidden = !isRegister;
  confirmWrap.hidden = !isRegister;
  confirmPassword.required = isRegister;
  notice.hidden = true;
  notice.textContent = '';

  for (const tab of authTabs) {
    const isActive = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  }
}

for (const tab of authTabs) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!authForm.reportValidity()) return;

  if (mode === 'register' && password.value !== confirmPassword.value) {
    notice.hidden = false;
    notice.dataset.translationKey = 'mismatchedPasswords';
    notice.textContent = language.translate('mismatchedPasswords');
    notice.classList.add('is-error');
    confirmPassword.focus();
    return;
  }

  submitAuth();
});

async function submitAuth() {
  notice.hidden = false;
  notice.classList.remove('is-error');
  notice.dataset.translationKey = mode === 'register' ? 'creatingAccount' : 'signingIn';
  notice.textContent = language.translate(notice.dataset.translationKey);
  authSubmit.disabled = true;

  try {
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: authForm.elements.email.value,
        password: password.value,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      notice.dataset.translationKey = 'requestFailed';
      notice.textContent = language.translateServerError(result.error, 'requestFailed');
      notice.classList.add('is-error');
      return;
    }
    authForm.reset();
    window.location.assign('index.html');
  } catch {
    notice.dataset.translationKey = 'serverUnavailable';
    notice.textContent = language.translate('serverUnavailable');
    notice.classList.add('is-error');
  } finally {
    authSubmit.disabled = false;
  }
}

setMode(mode);

document.addEventListener('languagechange', () => {
  const noticeKey = notice.dataset.translationKey;
  const showNotice = !notice.hidden;
  setMode(mode);
  if (showNotice && noticeKey) {
    notice.hidden = false;
    notice.dataset.translationKey = noticeKey;
    notice.textContent = language.translate(noticeKey);
  }
});
