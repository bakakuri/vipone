// Profile: name, language and theme (saved to the account), identity
// verification, legal documents accepted, account status.
import { profileApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatDate, formatDateTime } from '../formatting/format-date.js';
import { setLocale, t } from '../i18n/i18n.js';
import { LOCALES } from '../i18n/locales.js';
import { getThemePreference, setTheme } from '../themes/theme.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { formField, input, select } from '../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../components/forms/form-validation.js';
import { pageHeader } from '../components/misc/page-header.js';
import { segmented } from '../components/misc/tabs.js';
import { toast } from '../components/notifications/toast.js';

definePage({
  id: 'profile',
  area: 'app',
  namespaces: ['profile', 'security', 'transactions'],
  title: 'profile:title',
  async render({ page }) {
    const profile = await profileApi.get();

    const name = formField({ label: t('profile:displayName'), control: input({ name: 'displayName', value: profile.displayName || '', maxLength: 80, autocomplete: 'nickname' }), hint: t('profile:displayNameHint'), id: 'profile-name' });
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, t('common:actions.save'));
    const form = h('form', { class: 'form', novalidate: true }, name.el, h('div', { class: 'cluster' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(save, true);
      try {
        await profileApi.update({ displayName: name.control.value.trim() || null });
        toast(t('profile:saved'));
      } catch (err) {
        showServerErrors(err, { displayName: name });
      } finally {
        setBusy(save, false);
      }
    });

    const language = formField({
      label: t('common:language'),
      control: select(Object.entries(LOCALES).map(([code, l]) => ({ value: code, label: l.name })), { name: 'locale', value: profile.locale }),
      hint: t('profile:languageHint'),
      id: 'profile-locale',
    });
    language.control.addEventListener('change', () => setLocale(language.control.value));
    const theme = segmented(['light', 'dark', 'system'].map((v) => ({ value: v, label: t(`common:theme.${v}`) })), {
      value: getThemePreference(),
      label: t('common:theme.label'),
      onChange: (v) => setTheme(v),
    });

    const kycSlot = h('div', { class: 'stack stack--sm' });
    function renderKyc(status = profile.kycStatus, note) {
      const start = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, t('profile:kyc.start'));
      start.addEventListener('click', async () => {
        setBusy(start, true);
        try {
          const res = await profileApi.startKyc();
          if (res.url) location.assign(res.url);
          else renderKyc('pending', t('profile:kyc.manualNote'));
        } catch (err) {
          toast(errorMessage(err), { tone: 'error' });
        } finally {
          setBusy(start, false);
        }
      });
      replace(kycSlot,
        h('div', { class: 'cluster' }, h('span', {}, t('profile:kyc.status')), statusBadge(status === 'approved' ? 'approved_kyc' : status, { label: t(`profile:kyc.statuses.${status}`) })),
        h('p', { class: 'text-small text-muted' }, t(`profile:kyc.explain.${status}`)),
        note ? alertBox({ tone: 'info', text: note }) : null,
        ['none', 'rejected'].includes(status) ? start : null);
    }
    renderKyc();

    replace(page,
      pageHeader({ title: t('profile:title'), subtitle: t('profile:subtitle') }),
      profile.status !== 'active' ? alertBox({ tone: 'danger', title: t(`profile:status.${profile.status}`), text: profile.statusReason || t('profile:statusContact') }) : null,
      h('div', { class: 'grid grid--2' },
        h('section', { class: 'card', 'aria-labelledby': 'profile-account' },
          h('h2', { class: 'card__title', id: 'profile-account' }, t('profile:account')),
          h('dl', { class: 'kv' },
            h('dt', {}, t('profile:email')), h('dd', {}, h('bdi', { dir: 'ltr' }, profile.email)),
            h('dt', {}, t('profile:country')), h('dd', {}, profile.countryCode ? new Intl.DisplayNames([document.documentElement.lang], { type: 'region' }).of(profile.countryCode) : '—'),
            h('dt', {}, t('profile:memberSince')), h('dd', {}, formatDate(profile.createdAt)),
            h('dt', {}, t('transactions:status')), h('dd', {}, statusBadge(profile.status))),
          form),
        h('section', { class: 'card', 'aria-labelledby': 'profile-prefs' },
          h('h2', { class: 'card__title', id: 'profile-prefs' }, t('profile:preferences')),
          language.el,
          h('div', { class: 'field' }, h('span', { class: 'field__label' }, t('common:theme.label')), theme))),
      h('section', { class: 'card', id: 'verification', 'aria-labelledby': 'profile-kyc' },
        h('h2', { class: 'card__title', id: 'profile-kyc' }, t('profile:kyc.title')), kycSlot),
      h('section', { class: 'card', 'aria-labelledby': 'profile-legal' },
        h('h2', { class: 'card__title', id: 'profile-legal' }, t('profile:legal')),
        profile.legalAcceptances.length
          ? h('ul', { class: 'plain-list' }, profile.legalAcceptances.map((a) => h('li', {},
              h('a', { href: a.path }, t(`profile:docs.${a.docType}`)), ' ', h('span', { class: 'text-xs text-subtle' }, t('profile:acceptedOn', { version: a.version, date: formatDateTime(a.acceptedAt) })))))
          : h('p', { class: 'text-small text-muted' }, '—')));
  },
});
