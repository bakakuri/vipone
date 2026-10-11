// Page bootstrap shared by every page:
// theme -> translations -> config + session -> access guard -> layout ->
// page render -> live updates -> onboarding. Pages only describe themselves:
//
//   definePage({ id: 'deposit', area: 'app', auth: 'user', namespaces: ['deposit'],
//                title: 'deposit:title', async render(ctx) { ... } });

import { profileApi, publicApi } from '../api/endpoints.js';
import { currentUser, getSession, loadSession, redirectAfterLogin, redirectToLogin } from '../auth/session.js';
import { mountAppShell } from '../components/layout/app-shell.js';
import { mountAuthShell } from '../components/layout/auth-shell.js';
import { mountPublicShell } from '../components/layout/public-shell.js';
import { errorState } from '../components/feedback/error-state.js';
import { alertBox } from '../components/feedback/alert.js';
import { mfaDialog } from '../components/modals/mfa-dialog.js';
import { applyTranslations } from '../i18n/apply-translations.js';
import { initI18n, setLocale, t } from '../i18n/i18n.js';
import { startLive } from '../services/live-connection.js';
import { initTheme } from '../themes/theme.js';
import { initEffects } from '../effects/index.js';
import { h, replace } from './dom.js';
import { installErrorReporter } from './error-reporter.js';
import { listen } from './events.js';
import { getPref } from './storage.js';

// Namespaces used by static markup (data-i18n="ns:key"), loaded automatically.
function markupNamespaces() {
  const found = new Set();
  const add = (key) => key && key.includes(':') && found.add(key.slice(0, key.indexOf(':')));
  document.querySelectorAll('[data-i18n]').forEach((el) => add(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split('|').forEach((pair) => add(pair.slice(pair.indexOf(':') + 1))));
  add(document.documentElement.dataset.titleKey);
  return [...found];
}

let configPromise;
export function loadConfig() {
  if (!configPromise) {
    configPromise = publicApi.config().catch(() => ({ appName: 'Ledgerline', mode: 'demo', languages: ['en', 'ru', 'ar'], live: { enabled: false } }));
  }
  return configPromise;
}

function forbidden(page) {
  replace(page, errorState({ code: 'forbidden' }));
}

function mfaBanner() {
  const btn = h('button', { class: 'btn btn--sm', type: 'button' }, t('auth:mfa.verifyNow'));
  btn.addEventListener('click', async () => {
    if (await mfaDialog()) location.reload();
  });
  return alertBox({ tone: 'warning', title: t('auth:mfa.pendingTitle'), text: t('auth:mfa.pendingText'), action: btn });
}

export async function definePage(spec) {
  const { id, area = 'app', auth = area === 'public' ? 'none' : 'user', namespaces = [], title, permission } = spec;
  installErrorReporter();
  initTheme();
  if (title) document.documentElement.dataset.titleKey = title;

  const extra = area === 'admin' ? ['admin', 'notifications'] : area === 'app' ? ['notifications', 'onboarding', 'help'] : area === 'auth' ? ['auth'] : [];
  await initI18n([...namespaces, ...extra, 'help', ...markupNamespaces()]);

  const [config] = await Promise.all([loadConfig(), loadSession()]);
  const session = getSession();
  const user = currentUser();

  // Access guards (the API enforces the same rules; these are for navigation).
  if ((auth === 'user' || auth === 'admin') && !user) return redirectToLogin();
  if (auth === 'guest' && user && !session.mfaRequired) return redirectAfterLogin();
  if (auth === 'admin' && !user.roles?.length) return location.replace('/dashboard');

  // A signed-in user's saved language follows them across devices.
  if (user?.locale && !getPref('locale') && !/^\/(ru|ar)(\/|$)/.test(location.pathname) && user.locale !== document.documentElement.lang) {
    await setLocale(user.locale);
  }

  if (area === 'app' || area === 'admin') mountAppShell({ area: area === 'admin' ? 'admin' : 'user', config, title: title ? t(title) : '' });
  else if (area === 'auth') mountAuthShell({ config });
  else mountPublicShell({ config });

  const page = document.getElementById('page');
  applyTranslations(document);

  if (permission && !spec.allow?.(user) && !user?.permissions?.includes(permission)) {
    forbidden(page);
    return;
  }

  const ctx = { id, config, session, user, page, area };
  let instance = {};
  try {
    instance = (await spec.render(ctx)) || {};
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err);
    replace(page, errorState(err, { onRetry: () => location.reload() }));
  }
  if ((area === 'app' || area === 'admin') && session.mfaRequired) page.prepend(mfaBanner());
  page.classList.add('page-enter');
  // The entrance cascade plays once; later re-renders (live updates) do not replay it.
  setTimeout(() => page.classList.remove('page-enter'), 1800);
  initEffects({ area });

  // Switching language re-renders the whole page in the new language. Signed-in
  // users' choice is saved to the profile (emails use it too). Public pages
  // that have pre-rendered /ru and /ar versions navigate to that URL.
  listen('locale:changed', async ({ locale }) => {
    if (user) await profileApi.update({ locale }).catch(() => {});
    if (document.documentElement.dataset.localized === 'true') {
      const path = location.pathname.replace(/^\/(ru|ar)(?=\/|$)/, '') || '/';
      const target = locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`;
      location.assign(target + location.search + location.hash);
    } else {
      location.reload();
    }
  });
  // The theme follows a signed-in user to other devices.
  if (user) {
    let savedTheme = user.theme;
    listen('theme:changed', ({ preference }) => {
      if (preference === savedTheme) return;
      savedTheme = preference;
      profileApi.update({ theme: preference }).catch(() => {});
    });
  }
  listen('auth:required', () => {
    if (auth === 'user' || auth === 'admin') redirectToLogin();
  });

  if (area === 'app' || area === 'admin') startLive();
  return instance;
}
