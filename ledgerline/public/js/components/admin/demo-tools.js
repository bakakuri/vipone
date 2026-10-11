// Demo-only helpers (visible only when the server reports demo tools are
// enabled — never in live mode). They create blockchain events that go
// through the same ingestion, confirmation and crediting code as real ones.
import { adminApi } from '../../api/admin-endpoints.js';
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { errorMessage } from '../feedback/error-message.js';
import { formField, input, select } from '../forms/form-field.js';
import { setBusy } from '../forms/form-validation.js';
import { toast } from '../notifications/toast.js';

export function demoTxHash() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function simulateDepositForm(assets, { onDone } = {}) {
  const email = formField({ label: t('admin:demo.email'), control: input({ type: 'email', dir: 'ltr' }), id: 'demo-email' });
  const pairs = assets.flatMap((a) => a.networks.filter((n) => n.depositEnabled).map((n) => ({ value: `${a.code}|${n.code}`, label: `${a.code} · ${n.name}` })));
  const pair = formField({ label: t('common:fields.network'), control: select(pairs), id: 'demo-pair' });
  const amount = formField({ label: t('common:fields.amount'), control: input({ inputmode: 'decimal', dir: 'ltr' }), id: 'demo-amount' });
  const confirmations = formField({ label: t('admin:demo.confirmations'), control: input({ type: 'number', min: 0, max: 1000, value: 1 }), id: 'demo-conf' });
  const btn = h('button', { class: 'btn btn--sm', type: 'submit' }, t('admin:demo.simulate'));
  const form = h('form', { class: 'form demo-box', novalidate: true },
    h('p', { class: 'demo-box__label' }, t('admin:demo.label')),
    h('div', { class: 'form-row' }, email.el, pair.el), h('div', { class: 'form-row' }, amount.el, confirmations.el), h('div', {}, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [asset, network] = pair.control.value.split('|');
    setBusy(btn, true);
    try {
      const res = await adminApi.simulateDeposit({ email: email.control.value, asset, network, amount: amount.control.value, confirmations: Number(confirmations.control.value) });
      toast(t('admin:demo.simulated', { status: t(`common:status.${res.status || 'detected'}`) }));
      onDone?.(res);
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
    } finally {
      setBusy(btn, false);
    }
  });
  return form;
}
