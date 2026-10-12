// Admin → Deposits → Deposit methods. Staff publish where users send funds:
// asset + network, address, memo, a QR image (uploaded, or generated from the
// address), minimum and instructions in every language, plus a notice shown
// at the top of the deposit page. When at least one method is active the
// deposit page shows these methods instead of personal addresses.
import { adminApi } from '../../api/admin-endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { can } from '../../auth/session.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { emptyState } from '../feedback/empty-state.js';
import { errorMessage } from '../feedback/error-message.js';
import { skeletonRows } from '../feedback/skeleton.js';
import { checkbox, formField, input, select, textarea } from '../forms/form-field.js';
import { setBusy, showServerErrors } from '../forms/form-validation.js';
import { qrCode } from '../misc/qr-code.js';
import { confirmDialog } from '../modals/confirm-dialog.js';
import { withMfa } from '../modals/mfa-dialog.js';
import { openModal } from '../modals/modal.js';
import { toast } from '../notifications/toast.js';
import { section } from './admin-ui.js';

const LANGS = ['en', 'ru', 'ar', 'ka'];
const MAX_DATA_URL = 690000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

// Re-encodes the chosen picture in the browser (longest side ≤ 1000 px) and
// returns a data URL small enough for the server limit. PNG keeps QR modules
// sharp; photos and screenshots fall back to WebP/JPEG.
export async function imageToDataUrl(file) {
  const { img, release } = await loadImage(file);
  try {
    let scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of [['image/png'], ['image/webp', 0.92], ['image/jpeg', 0.9], ['image/jpeg', 0.75]]) {
        const url = canvas.toDataURL(type, quality);
        if (url.startsWith(`data:${type}`) && url.length <= MAX_DATA_URL) return url;
      }
      scale *= 0.75;
    }
    throw new Error('too_large');
  } finally {
    release();
  }
}

function qrPreview(method) {
  if (method.qrImage) return h('img', { src: method.qrImage, alt: '' });
  return method.address ? qrCode(method.address, { label: method.address }) : icon('qr');
}

export function openMethodEditor({ assets, method = null, onSaved }) {
  const m = method || {};
  const assetField = formField({ label: t('common:fields.asset'), control: select(assets.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })), { value: m.asset || assets[0]?.code }), id: 'dm-asset' });
  const networkField = formField({ label: t('common:fields.network'), control: select([]), id: 'dm-network' });
  function syncNetworks(selected) {
    const asset = assets.find((a) => a.code === assetField.control.value);
    const nets = (asset?.networks || []).filter((n) => n.depositEnabled || n.code === selected);
    replace(networkField.control, nets.map((n) => h('option', { value: n.code, selected: n.code === selected }, n.name === n.code ? n.name : `${n.name} (${n.code})`)));
  }
  syncNetworks(m.network);
  assetField.control.addEventListener('change', () => syncNetworks());

  const label = formField({ label: t('admin:methods.label'), control: input({ value: m.label || '', maxlength: 80 }), hint: t('admin:methods.labelHint'), aside: t('common:optional'), id: 'dm-label' });
  const address = formField({ label: t('admin:methods.address'), control: input({ value: m.address || '', dir: 'ltr', class: 'input input--mono', spellcheck: false, autocomplete: 'off', maxlength: 200 }), id: 'dm-address' });
  const memo = formField({ label: t('admin:methods.memo'), control: input({ value: m.memo || '', dir: 'ltr', class: 'input input--mono', maxlength: 100 }), hint: t('admin:methods.memoHint'), aside: t('common:optional'), id: 'dm-memo' });
  const minAmount = formField({ label: t('admin:methods.minAmount'), control: input({ value: m.minAmount || '', dir: 'ltr', inputmode: 'decimal' }), hint: t('admin:optionalBlank'), id: 'dm-min' });
  const sortOrder = formField({ label: t('admin:methods.sortOrder'), control: input({ type: 'number', min: 0, max: 1000, value: m.sortOrder ?? 0 }), id: 'dm-sort' });
  const active = checkbox({ label: t('admin:methods.active'), checked: m.isActive ?? true });

  // QR image: keep (undefined), replace (data URL) or remove (null).
  let qrImage;
  const preview = h('div', { class: 'qr-upload__preview' });
  const showPreview = () => replace(preview, qrPreview({ qrImage: qrImage === undefined ? m.qrImage : qrImage, address: address.control.value.trim() }));
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'qr-upload__file', id: 'dm-qr-file' });
  const uploadBtn = h('label', { class: 'btn btn--sm', for: 'dm-qr-file' }, icon('qr', { size: 'sm' }), t('admin:methods.uploadQr'));
  const removeBtn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, icon('trash', { size: 'sm' }), t('admin:methods.removeQr'));
  const qrError = h('div', { class: 'field__error', role: 'alert' });
  const syncRemove = () => { removeBtn.hidden = !(qrImage === undefined ? m.qrImage : qrImage); };
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    qrError.textContent = '';
    if (!chosen) return;
    try {
      qrImage = await imageToDataUrl(chosen);
      showPreview();
      syncRemove();
    } catch {
      qrError.textContent = t('admin:methods.imageError');
    } finally {
      file.value = '';
    }
  });
  removeBtn.addEventListener('click', () => { qrImage = null; showPreview(); syncRemove(); });
  address.control.addEventListener('input', () => { if (!(qrImage === undefined ? m.qrImage : qrImage)) showPreview(); });
  showPreview();
  syncRemove();
  const qrField = h('div', { class: 'field' },
    h('span', { class: 'field__label' }, t('admin:methods.qr')),
    h('div', { class: 'qr-upload' }, preview,
      h('div', { class: 'stack stack--sm' },
        h('p', { class: 'text-small text-muted' }, t('admin:methods.qrHint')),
        h('div', { class: 'cluster' }, file, uploadBtn, removeBtn))),
    qrError);

  const instructions = Object.fromEntries(LANGS.map((l) => [l, formField({
    label: `${t('admin:methods.instructions')} (${l.toUpperCase()})`,
    control: textarea({ rows: 4, dir: l === 'ar' ? 'rtl' : 'ltr', lang: l, value: m.instructions?.[l] || '', maxlength: 4000 }),
    id: `dm-ins-${l}`,
  })]));
  const instructionsField = h('fieldset', { class: 'localized-fields' },
    h('legend', { class: 'field__label' }, t('admin:methods.instructions')),
    h('p', { class: 'text-xs text-subtle' }, t('admin:methods.instructionsHint')),
    LANGS.map((l) => instructions[l].el));

  const save = h('button', { class: 'btn btn--primary', type: 'submit', form: 'method-form' }, t('common:actions.save'));
  const form = h('form', { class: 'form', id: 'method-form', novalidate: true },
    h('div', { class: 'form-row' }, assetField.el, networkField.el),
    label.el, address.el, memo.el, qrField,
    h('div', { class: 'form-row' }, minAmount.el, sortOrder.el),
    instructionsField, active.el);
  const modal = openModal({ title: method ? t('admin:methods.edit') : t('admin:methods.add'), body: form, footer: [save], wide: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      asset: assetField.control.value,
      network: networkField.control.value,
      label: label.control.value.trim() || null,
      address: address.control.value.trim(),
      memo: memo.control.value.trim() || null,
      minAmount: minAmount.control.value.trim() || null,
      sortOrder: Number(sortOrder.control.value) || 0,
      isActive: active.input.checked,
      instructions: Object.fromEntries(LANGS.map((l) => [l, instructions[l].control.value.trim() || null])),
    };
    if (qrImage !== undefined || !method) body.qrImage = qrImage ?? null;
    setBusy(save, true);
    try {
      const saved = await withMfa(() => (method ? adminApi.updateDepositMethod(method.id, body) : adminApi.createDepositMethod(body)));
      modal.close();
      toast(t('admin:methods.saved'));
      onSaved?.(saved);
    } catch (err) {
      if (err.details?.reason === 'method_exists') networkField.setError(t('admin:methods.exists'));
      else showServerErrors(err, { asset: assetField, network: networkField, label, address, memo, minAmount, sortOrder, qrImage: { setError: (msg) => { qrError.textContent = msg; }, control: file }, instructions: instructions.en });
    } finally {
      setBusy(save, false);
    }
  });
}

function methodCard(m, { assets, onChanged, manage }) {
  const actions = [];
  if (manage) {
    const edit = h('button', { class: 'btn btn--sm', type: 'button' }, t('common:actions.edit'));
    edit.addEventListener('click', () => openMethodEditor({ assets, method: m, onSaved: onChanged }));
    const remove = h('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, icon('trash', { size: 'sm' }), t('admin:methods.remove'));
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: t('admin:methods.remove'), text: t('admin:methods.removeText'), confirmLabel: t('admin:methods.remove'), tone: 'danger' }))) return;
      try {
        const res = await withMfa(() => adminApi.removeDepositMethod(m.id));
        toast(res.deactivated ? t('admin:methods.deactivated') : t('admin:methods.removed'));
        onChanged?.();
      } catch (err) {
        toast(errorMessage(err), { tone: 'error' });
      }
    });
    actions.push(edit, remove);
  }
  return h('article', { class: 'card method-card' },
    h('div', { class: 'method-card__qr' }, qrPreview(m)),
    h('div', { class: 'method-card__body' },
      h('div', { class: 'method-card__title' },
        h('strong', {}, `${m.asset} · ${m.networkName}`),
        h('span', { class: `badge ${m.isActive ? 'badge--positive' : 'badge--plain'}` }, m.isActive ? t('admin:methods.isActive') : t('admin:methods.isHidden'))),
      m.label ? h('span', { class: 'text-small' }, m.label) : null,
      h('bdi', { class: 'method-card__address', dir: 'ltr' }, m.address),
      m.memo ? h('span', { class: 'text-xs text-muted' }, `${m.memoLabel || t('deposit:memo')}: `, h('bdi', { dir: 'ltr' }, m.memo)) : null,
      m.minAmount ? h('span', { class: 'text-xs text-muted' }, t('deposit:manual.minimum', { amount: formatAmount(m.minAmount, m.asset) })) : null,
      h('span', { class: 'text-xs text-subtle' }, t('admin:methods.updated', { date: formatDateTime(m.updatedAt) })),
      actions.length ? h('div', { class: 'cluster' }, actions) : null));
}

// Notice at the top of the deposit page, in every language (a setting).
function noticeEditor() {
  const fields = Object.fromEntries(LANGS.map((l) => [l, formField({
    label: `${t('admin:methods.notice')} (${l.toUpperCase()})`,
    control: textarea({ rows: 3, dir: l === 'ar' ? 'rtl' : 'ltr', lang: l, maxlength: 2000 }),
    id: `dn-${l}`,
  })]));
  const save = h('button', { class: 'btn btn--sm btn--primary', type: 'submit' }, t('common:actions.save'));
  const form = h('form', { class: 'form', novalidate: true },
    h('p', { class: 'text-xs text-subtle' }, t('admin:methods.noticeHint')),
    LANGS.map((l) => fields[l].el), h('div', {}, save));
  let current = {};
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = Object.fromEntries(LANGS.map((l) => [l, fields[l].control.value.trim()]).filter(([, v]) => v));
    setBusy(save, true);
    try {
      const res = await withMfa(() => adminApi.changeSetting('deposits.page_notice', value, t('admin:methods.noticeReason')));
      if (res?.applied === false) toast(t('admin:approvalCreated'), { tone: 'info' });
      else toast(t('admin:methods.noticeSaved'));
      current = value;
    } catch (err) {
      if (err.code === 'no_change') toast(t('admin:methods.noticeSaved'));
      else toast(errorMessage(err), { tone: 'error' });
    } finally {
      setBusy(save, false);
    }
  });
  return {
    el: form,
    set(value) {
      current = value && typeof value === 'object' ? value : {};
      LANGS.forEach((l) => { fields[l].control.value = current[l] || ''; });
    },
  };
}

export function depositMethodsPanel({ assets }) {
  const manage = can('deposit_methods.manage');
  const listSlot = h('div', { class: 'method-list' }, skeletonRows(2));
  const addBtn = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('plus', { size: 'sm' }), t('admin:methods.add'));
  addBtn.hidden = !manage;
  const notice = can('settings.request') ? noticeEditor() : null;

  async function load() {
    const [methods, settings] = await Promise.all([
      adminApi.depositMethods(),
      notice ? adminApi.settings().catch(() => []) : Promise.resolve([]),
    ]);
    if (notice) notice.set(settings.find((s) => s.key === 'deposits.page_notice')?.value);
    replace(listSlot, methods.length
      ? methods.map((m) => methodCard(m, { assets, onChanged: load, manage }))
      : emptyState({ iconName: 'qr', title: t('admin:methods.emptyTitle'), text: t('admin:methods.emptyText') }));
  }
  addBtn.addEventListener('click', () => openMethodEditor({ assets, onSaved: load }));

  const el = h('div', { class: 'stack' },
    h('div', { class: 'alert alert--info', role: 'status' }, icon('info'),
      h('div', { class: 'alert__body' }, h('div', { class: 'alert__title' }, t('admin:methods.title')), h('div', {}, t('admin:methods.intro'))),
      addBtn),
    listSlot,
    notice ? section(t('admin:methods.noticeTitle'), notice.el) : null);
  return { el, load };
}
