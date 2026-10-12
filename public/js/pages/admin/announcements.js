// Announcements: written in one or more languages (an empty language shows
// the first text written), delivered to every active account as an in-app
// notification. Published announcements can be corrected or deleted.
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
import { errorMessage } from '../../components/feedback/error-message.js';

const LANGS = ['ka', 'en', 'ru', 'ar'];

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
    let editing = null; // announcement being corrected, or null for a new one
    const publish = h('button', { class: 'btn btn--primary', type: 'submit' }, t('admin:announcements.publish'));
    const cancelEdit = h('button', { class: 'btn btn--ghost', type: 'button', hidden: true }, t('common:actions.cancel'));
    const form = h('form', { class: 'form', novalidate: true },
      alertBox({ tone: 'info', text: t('admin:announcements.rules') }),
      LANGS.map((l) => h('fieldset', { class: 'localized-fields' }, h('legend', { class: 'field__label' }, l.toUpperCase()), titles[l].el, bodies[l].el)),
      h('div', { class: 'cluster' }, publish, cancelEdit));

    function startEdit(a) {
      editing = a;
      LANGS.forEach((l) => {
        titles[l].control.value = a.title?.[l] || '';
        bodies[l].control.value = a.body?.[l] || '';
      });
      publish.textContent = t('admin:announcements.save');
      cancelEdit.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function stopEdit() {
      editing = null;
      form.reset();
      publish.textContent = t('admin:announcements.publish');
      cancelEdit.hidden = true;
    }
    cancelEdit.addEventListener('click', stopEdit);

    async function remove(a) {
      if (!(await confirmDialog({ title: t('admin:announcements.delete'), text: t('admin:announcements.deleteText'), confirmLabel: t('admin:announcements.delete'), tone: 'danger' }))) return;
      try {
        await adminApi.deleteAnnouncement(a.id);
        toast(t('admin:announcements.deleted'));
        if (editing?.id === a.id) stopEdit();
        load();
      } catch (err) {
        toast(errorMessage(err), { tone: 'error' });
      }
    }

    async function load() {
      const rows = await adminApi.announcements();
      replace(list, rows.length ? rows.map((a) => h('article', { class: 'card card--sunken' },
        h('div', { class: 'card__header' }, h('h3', { class: 'card__title' }, localized(a.title)), h('span', { class: 'text-xs text-subtle' }, formatDateTime(a.publishedAt))),
        h('p', { class: 'text-small' }, localized(a.body)),
        h('div', { class: 'cluster' },
          h('span', { class: 'text-xs text-subtle' }, a.publishedByEmail),
          h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => startEdit(a) } }, t('admin:announcements.edit')),
          h('button', { class: 'btn btn--sm btn--danger', type: 'button', on: { click: () => remove(a) } }, t('admin:announcements.delete')))))
        : emptyState({ iconName: 'megaphone', title: t('admin:announcements.none') }));
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (fields) => Object.fromEntries(LANGS.map((l) => [l, fields[l].control.value.trim()]));
      const hasTitle = LANGS.some((l) => titles[l].control.value.trim());
      const hasBody = LANGS.some((l) => bodies[l].control.value.trim());
      titles[LANGS[0]].setError(hasTitle ? '' : t('errors:validation.required'));
      bodies[LANGS[0]].setError(hasBody ? '' : t('errors:validation.required'));
      if (!hasTitle || !hasBody) return;
      if (!editing && !(await confirmDialog({ title: t('admin:announcements.publish'), text: t('admin:announcements.confirm') }))) return;
      setBusy(publish, true);
      try {
        if (editing) {
          await adminApi.updateAnnouncement(editing.id, { title: value(titles), body: value(bodies) });
          toast(t('admin:announcements.saved'));
          stopEdit();
        } else {
          const res = await adminApi.announce({ title: value(titles), body: value(bodies) });
          toast(t('admin:announcements.sent', { count: res.recipients }));
          form.reset();
        }
        load();
      } catch (err) {
        showServerErrors(err, { title: titles[LANGS[0]], body: bodies[LANGS[0]] });
      } finally {
        setBusy(publish, false);
      }
    });

    replace(page, pageHeader({ title: t('admin:announcements.title'), subtitle: t('admin:announcements.subtitle') }),
      h('div', { class: 'grid grid--2' }, section(t('admin:announcements.new'), form), section(t('admin:announcements.published'), list)));
    await load();
  },
});
