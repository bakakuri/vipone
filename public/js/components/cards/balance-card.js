// The ledger strip: for one asset, where the funds are right now —
// available, held after a deposit (7-day rule), reserved by withdrawal
// requests, invested. All four values come from the server's ledger.
import { h, replace } from '../../core/dom.js';
import { countUp } from '../../animations/count-up.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDate } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { segmented } from '../misc/tabs.js';
import { infoTip } from '../misc/tooltip.js';
import { getPref, setPref } from '../../core/storage.js';

const SEGMENTS = [
  { key: 'withdrawable', css: 'available', label: 'dashboard:balance.available', hint: 'dashboard:balance.availableHint' },
  { key: 'depositHold', css: 'deposit-hold', label: 'dashboard:balance.depositHold', hint: 'dashboard:balance.depositHoldHint' },
  { key: 'withdrawalHold', css: 'withdrawal-hold', label: 'dashboard:balance.withdrawalHold', hint: 'dashboard:balance.withdrawalHoldHint' },
  { key: 'invested', css: 'invested', label: 'dashboard:balance.invested', hint: 'dashboard:balance.investedHint' },
];

export function balanceCard({ onAssetChange } = {}) {
  const total = h('div', { class: 'stat__value num' }, '—');
  const totalLabel = h('div', { class: 'stat__label' }, t('dashboard:balance.total'));
  const switcherSlot = h('div', { class: 'balance-card__asset-switch' });
  const strip = h('div', { class: 'ledger-strip', role: 'img' });
  const legend = h('div', { class: 'ledger-legend' });
  const holdNote = h('p', { class: 'text-xs text-subtle', hidden: true });
  const el = h('section', { class: 'card balance-card', dataset: { tour: 'balances' }, 'aria-labelledby': 'balance-title' },
    h('div', { class: 'balance-card__head' },
      h('div', { class: 'balance-card__total' }, h('h2', { id: 'balance-title', class: 'visually-hidden' }, t('dashboard:balance.title')), totalLabel, total),
      switcherSlot),
    strip, legend, holdNote);

  let balances = [];
  let asset = getPref('lastAsset') || 'USDT';
  let lastTotal = null;
  const values = new Map();

  function render(holds = []) {
    const b = balances.find((x) => x.asset === asset) || { asset, total: '0', withdrawable: '0', depositHold: '0', withdrawalHold: '0', invested: '0' };
    if (lastTotal !== null && lastTotal !== b.total) countUp(total, lastTotal, b.total, (v) => formatAmount(v, asset));
    else total.textContent = formatAmount(b.total, asset);
    lastTotal = b.total;

    const sum = SEGMENTS.reduce((acc, s) => acc + Math.max(0, Number(b[s.key])), 0);
    replace(strip, SEGMENTS.map((s) => {
      const seg = h('div', { class: `ledger-strip__seg ledger-strip__seg--${s.css}` });
      seg.style.setProperty('flex-grow', String(sum > 0 ? Math.max(0, Number(b[s.key])) / sum : 0));
      seg.style.setProperty('flex-basis', '0');
      return seg;
    }));
    strip.setAttribute('aria-label', SEGMENTS.map((s) => `${t(s.label)}: ${formatAmount(b[s.key], asset)}`).join(', '));

    replace(legend, SEGMENTS.map((s) => {
      const value = h('div', { class: 'ledger-legend__value num' });
      const prev = values.get(`${asset}:${s.key}`);
      if (prev !== undefined && prev !== b[s.key]) countUp(value, prev, b[s.key], (v) => formatAmount(v, asset, { withAsset: false }));
      else value.textContent = formatAmount(b[s.key], asset, { withAsset: false });
      values.set(`${asset}:${s.key}`, b[s.key]);
      const sw = h('span', { class: `ledger-legend__swatch ledger-strip__seg--${s.css}` });
      return h('div', { class: 'ledger-legend__item' }, h('div', { class: 'ledger-legend__label' }, sw, t(s.label), infoTip(t(s.hint), t(s.label))), value);
    }));

    const next = holds.filter((x) => x.asset === asset).sort((x, y) => new Date(x.unlockAt) - new Date(y.unlockAt))[0];
    holdNote.hidden = !next;
    if (next) holdNote.textContent = t('dashboard:balance.nextUnlock', { amount: formatAmount(next.amount, asset), date: formatDate(next.unlockAt, { time: true }) });
  }

  let lastHolds = [];
  return {
    el,
    update(nextBalances, holds = []) {
      balances = nextBalances;
      lastHolds = holds;
      const nonZero = balances.filter((b) => b.total !== '0').map((b) => b.asset);
      const assets = [...new Set([...nonZero, ...(nonZero.length ? [] : ['USDT'])])];
      if (!assets.includes(asset)) asset = assets[0];
      replace(switcherSlot, assets.length > 1 ? segmented(assets.map((a) => ({ value: a, label: a })), {
        value: asset,
        label: t('dashboard:balance.asset'),
        onChange: (a) => {
          asset = a;
          setPref('lastAsset', a);
          lastTotal = null;
          render(lastHolds);
          onAssetChange?.(a);
        },
      }) : null);
      render(holds);
    },
  };
}
