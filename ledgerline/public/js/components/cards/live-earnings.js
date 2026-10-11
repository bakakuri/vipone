// Realised results only. This card changes when — and only when — the server
// posts a new result or credits a reward (live event), never on a timer.
import { earningsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount, isZero } from '../../formatting/format-currency.js';
import { t } from '../../i18n/i18n.js';
import { onLive } from '../../services/live-connection.js';
import { pulseClass } from '../../animations/motion.js';
import { amount } from '../misc/amount-display.js';

export function liveEarnings() {
  const body = h('div', { class: 'stack stack--sm' });
  const el = h('section', { class: 'card', 'aria-labelledby': 'live-earnings-title' },
    h('div', { class: 'card__header' }, h('h2', { class: 'card__title', id: 'live-earnings-title' }, t('dashboard:earnings.title')), h('a', { href: '/earnings', class: 'text-small' }, t('common:actions.viewAll'))),
    body);

  async function load(highlight = false) {
    const summary = await earningsApi.summary();
    const rows = summary.perAsset.filter((a) => !isZero(a.realisedProfit) || !isZero(a.realisedLoss) || !isZero(a.referralCredited) || !isZero(a.referralPending));
    replace(body, rows.length
      ? rows.map((a) => h('dl', { class: 'kv' },
          h('dt', {}, t('dashboard:earnings.realised', { asset: a.asset })), h('dd', {}, amount(a.realisedNet, a.asset, { sign: true })),
          h('dt', {}, t('dashboard:earnings.referralCredited')), h('dd', {}, formatAmount(a.referralCredited, a.asset)),
          h('dt', {}, t('dashboard:earnings.referralPending')), h('dd', {}, formatAmount(a.referralPending, a.asset))))
      : [h('p', { class: 'text-small text-muted' }, t('dashboard:earnings.none'))],
      summary.awaitingSettlement ? h('p', { class: 'text-xs text-subtle' }, t('dashboard:earnings.awaitingSettlement', { count: summary.awaitingSettlement })) : null,
      h('p', { class: 'text-xs text-subtle' }, t('dashboard:earnings.note')));
    if (highlight) pulseClass(el, 'is-updated');
  }
  onLive(['position.updated', 'referral.updated', 'balance.changed'], () => load(true).catch(() => {}));
  return { el, load };
}
