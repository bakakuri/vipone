// Announcements: written in all three languages, delivered to every active
// account as an in-app notification.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { localized, t } from '../../i18n/i18n.js';
import { section } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { formField, input, textarea } from '../../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { confirmDialog } from '../../components/modals/confirm-dialog.js';
import { toast } from '../../components/notifications/toast.js';

const LANGS = ['en', 'ru', 'ar'];

definePage({
  id: 'admin-announcements',
  area: 'admin',
  auth: 'admin',
  permission: 'announcements.manage',
  namespaces: ['admin'],
  title: 'admin:announcements.title',
  async render({ page }) {
    const list = h('div', { class: 'stack' });
    const titles = Object.fromEntries(LANGS.map((l) => [l, formField({ label: t('admin:announcements.titleIn', { lang: l.toUpperCase() }), control: input({ maxLength: 140, lang: l, dir: l === 'ar' ? 'rtl' : 'ltr' }), id: `ann-title-${l}` })]));
    const bodies = Object.fromEntries(LANGS.map((l) => [l, formField({ label: t('admin:announcements.bodyIn', { lang: l.toUpperCase() }), control: textarea({ rows: 4, maxLength: 2000, lang: l, dir: l === 'ar' ? 'rtl' : 'ltr' }), id: `ann-body-${l}` })]));
    const publish = h('button', { class: 'btn btn--primary', type: 'submit' }, t('admin:announcements.publish'));
    const form = h('form', { class: 'form', novalidate: true },
      alertBox({ tone: 'warning', text: t('admin:announcements.rules') }),
      LANGS.map((l) => h('fieldset', { class: 'localized-fields' }, h('legend', { class: 'field__label' }, l.toUpperCase()), titles[l].el, bodies[l].el)),
      h('div', {}, publish));

    async function load() {
      const rows = await adminApi.announcements();
      replace(list, rows.length ? rows.map((a) => h('article', { class: 'card card--sunken' },
        h('div', { class: 'card__header' }, h('h3', { class: 'card__title' }, localized(a.title)), h('span', { class: 'text-xs text-subtle' }, formatDateTime(a.publishedAt))),
        h('p', { class: 'text-small' }, localized(a.body)),
        h('p', { class: 'text-xs text-subtle' }, a.publishedByEmail)))
        : emptyState({ iconName: 'megaphone', title: t('admin:announcements.none') }));
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (fields) => Object.fromEntries(LANGS.map((l) => [l, fields[l].control.value.trim()]));
      const missing = LANGS.filter((l) => !titles[l].control.value.trim() || !bodies[l].control.value.trim());
      LANGS.forEach((l) => {
        titles[l].setError(titles[l].control.value.trim() ? '' : t('errors:validation.required'));
        bodies[l].setError(bodies[l].control.value.trim() ? '' : t('errors:validation.required'));
      });
      if (missing.length) return;
      if (!(await confirmDialog({ title: t('admin:announcements.publish'), text: t('admin:announcements.confirm') }))) return;
      setBusy(publish, true);
      try {
        const res = await adminApi.announce({ title: value(titles), body: value(bodies) });
        toast(t('admin:announcements.sent', { count: res.recipients }));
        form.reset();
        load();
      } catch (err) {
        showServerErrors(err, { title: titles.en, body: bodies.en });
      } finally {
        setBusy(publish, false);
      }
    });

    replace(page, pageHeader({ title: t('admin:announcements.title'), subtitle: t('admin:announcements.subtitle') }),
      h('div', { class: 'grid grid--2' }, section(t('admin:announcements.new'), form), section(t('admin:announcements.published'), list)));
    await load();
  },
});
