// Create / edit an investment product. Texts are entered in all three
// languages; activation is refused (by the server and a database constraint)
// until legal status is approved, a legal reference exists and every text is
// complete. Changing terms creates a new terms version — open positions keep
// the version they accepted.
import { adminApi } from '../../api/admin-endpoints.js';
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { checkbox, formField, input, select, textarea } from '../forms/form-field.js';
import { setBusy, showServerErrors } from '../forms/form-validation.js';
import { openModal } from '../modals/modal.js';
import { toast } from '../notifications/toast.js';

const LANGS = ['en', 'ru', 'ar'];

function localizedFields(name, label, { multiline = false, value = {} } = {}) {
  const fields = Object.fromEntries(LANGS.map((l) => {
    const control = multiline
      ? textarea({ rows: 3, dir: l === 'ar' ? 'rtl' : 'ltr', lang: l, value: value[l] || '' })
      : input({ dir: l === 'ar' ? 'rtl' : 'ltr', lang: l, value: value[l] || '' });
    return [l, formField({ label: `${label} (${l.toUpperCase()})`, control, id: `pf-${name}-${l}` })];
  }));
  return {
    el: h('fieldset', { class: 'localized-fields' }, h('legend', { class: 'field__label' }, label), LANGS.map((l) => fields[l].el)),
    value: () => Object.fromEntries(LANGS.map((l) => [l, fields[l].control.value.trim()])),
    setError: (m) => fields.en.setError(m),
    control: fields.en.control,
  };
}

export function openProductForm(assets, product = null, { onSaved } = {}) {
  const p = product || {};
  const slug = formField({ label: t('admin:products.slug'), control: input({ value: p.slug || '', dir: 'ltr', pattern: '[a-z0-9-]{3,60}', disabled: Boolean(product) }), hint: t('admin:products.slugHint'), id: 'pf-slug' });
  const name = localizedFields('name', t('admin:products.name'), { value: p.name });
  const summary = localizedFields('summary', t('admin:products.summary'), { multiline: true, value: p.summary });
  const risk = localizedFields('risk', t('admin:products.riskDisclosure'), { multiline: true, value: p.riskDisclosure });
  const revenueModel = formField({ label: t('investments:product.revenueModel'), control: select(['trading', 'staking', 'lending', 'market_making', 'other'].map((v) => ({ value: v, label: t(`investments:revenueModels.${v}`) })), { value: p.revenueModel }), id: 'pf-rm' });
  const revenueText = localizedFields('rmd', t('admin:products.revenueDescription'), { multiline: true, value: p.revenueModelDescription });
  const term = formField({ label: t('admin:products.termDays'), control: input({ type: 'number', min: 1, max: 3650, value: p.termDays ?? 28 }), id: 'pf-term' });
  const min = formField({ label: t('admin:products.min'), control: input({ inputmode: 'decimal', dir: 'ltr', value: p.minAmount || '' }), id: 'pf-min' });
  const max = formField({ label: t('admin:products.max'), control: input({ inputmode: 'decimal', dir: 'ltr', value: p.maxAmount || '' }), hint: t('admin:optionalBlank'), id: 'pf-max' });
  const capacity = formField({ label: t('investments:product.capacity'), control: input({ inputmode: 'decimal', dir: 'ltr', value: p.capacity || '' }), hint: t('admin:optionalBlank'), id: 'pf-cap' });
  const perf = formField({ label: t('admin:products.performanceFeeRate'), control: input({ dir: 'ltr', value: p.performanceFeeRate ?? '0' }), hint: t('admin:products.rateHint'), id: 'pf-perf' });
  const early = checkbox({ label: t('admin:products.earlyExitAllowed'), checked: Boolean(p.earlyExitAllowed) });
  const earlyFee = formField({ label: t('admin:products.earlyExitFeeRate'), control: input({ dir: 'ltr', value: p.earlyExitFeeRate ?? '0' }), hint: t('admin:products.rateHint'), id: 'pf-early' });
  const riskLevel = formField({ label: t('investments:product.risk'), control: select(['low', 'medium', 'high'].map((v) => ({ value: v, label: t(`investments:risk.${v}`) })), { value: p.riskLevel || 'high' }), id: 'pf-risk' });
  const legalStatus = formField({ label: t('admin:products.legalStatus'), control: select(['draft', 'under_review', 'approved', 'suspended'].map((v) => ({ value: v, label: t(`admin:products.legal.${v}`) })), { value: p.legalStatus || 'draft' }), id: 'pf-legal' });
  const legalRef = formField({ label: t('admin:products.legalReference'), control: input({ value: p.legalReference || '' }), hint: t('admin:products.legalReferenceHint'), id: 'pf-legalref' });
  const assetBoxes = assets.map((a) => checkbox({ label: a.code, name: 'assets', checked: (p.assets || []).includes(a.code) }));
  const assetsField = h('fieldset', { class: 'field' }, h('legend', { class: 'field__label' }, t('investments:product.assets')), h('div', { class: 'cluster' }, assetBoxes.map((b, i) => { b.input.value = assets[i].code; return b.el; })));

  const save = h('button', { class: 'btn btn--primary', type: 'submit', form: 'product-form' }, t('common:actions.save'));
  const form = h('form', { class: 'form', id: 'product-form', novalidate: true },
    slug.el, name.el, summary.el,
    h('div', { class: 'form-row' }, revenueModel.el, riskLevel.el), revenueText.el, risk.el,
    h('div', { class: 'form-row' }, term.el, perf.el), h('div', { class: 'form-row' }, min.el, max.el, capacity.el),
    early.el, earlyFee.el, assetsField,
    h('div', { class: 'form-row' }, legalStatus.el, legalRef.el));
  const modal = openModal({ title: product ? t('admin:products.edit') : t('admin:products.create'), body: form, footer: [save], wide: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: name.value(), summary: summary.value(), riskDisclosure: risk.value(),
      revenueModel: revenueModel.control.value, revenueModelDescription: revenueText.value(),
      termDays: Number(term.control.value), minAmount: min.control.value.trim(),
      maxAmount: max.control.value.trim() || null, capacity: capacity.control.value.trim() || null,
      performanceFeeRate: perf.control.value.trim(), earlyExitAllowed: early.input.checked, earlyExitFeeRate: earlyFee.control.value.trim(),
      riskLevel: riskLevel.control.value, legalStatus: legalStatus.control.value, legalReference: legalRef.control.value.trim() || null,
      assets: assetBoxes.filter((b) => b.input.checked).map((b) => b.input.value),
    };
    setBusy(save, true);
    try {
      const saved = product ? await adminApi.updateProduct(product.id, body) : await adminApi.createProduct({ slug: slug.control.value.trim(), ...body });
      modal.close();
      toast(t('admin:products.saved'));
      onSaved?.(saved);
    } catch (err) {
      showServerErrors(err, { slug, name, summary, riskDisclosure: risk, revenueModel, revenueModelDescription: revenueText, termDays: term, minAmount: min, maxAmount: max, capacity, performanceFeeRate: perf, earlyExitFeeRate: earlyFee, riskLevel, legalStatus, legalReference: legalRef });
    } finally {
      setBusy(save, false);
    }
  });
}
