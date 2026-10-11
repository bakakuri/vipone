// An investment product as it is: what generates the return, its term, fees,
// risk level, limits — and its realised history (posted results only). There
// is no projected or promised return anywhere on the card.
import { h, icon } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDate } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { localized, t } from '../../i18n/i18n.js';
import { statusBadge } from '../feedback/status-badge.js';
import { compareDecimal } from '../../validation/compare-decimal.js';

export function riskBadge(level) {
  const tone = { low: 'info', medium: 'pending', high: 'negative' }[level] || 'neutral';
  return h('span', { class: `badge badge--${tone}` }, t(`investments:risk.${level}`));
}

export function resultsHistory(results, { limit = 6 } = {}) {
  if (!results?.length) return h('p', { class: 'text-small text-muted' }, t('investments:product.noResults'));
  return h('table', { class: 'mini-table' },
    h('caption', { class: 'visually-hidden' }, t('investments:product.history')),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('investments:product.period')), h('th', { scope: 'col', class: 'col-num' }, t('investments:product.grossReturn')))),
    h('tbody', {}, results.slice(0, limit).map((r) => h('tr', {},
      h('td', {}, `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`),
      h('td', { class: `col-num ${compareDecimal(r.grossReturnRate, '0') < 0 ? 'amount--negative' : ''}`.trim() }, h('bdi', { dir: 'ltr' }, formatPercent(r.grossReturnRate, { max: 2, signDisplay: 'exceptZero' })))))));
}

export function productCard(product, { onInvest, onCalculate, publicView = false } = {}) {
  const unit = product.assets.length === 1 ? product.assets[0] : '';
  const fmt = (v) => formatAmount(v, unit || product.assets[0], { withAsset: Boolean(unit) });
  const limits = product.maxAmount
    ? t('investments:product.limitsRange', { min: fmt(product.minAmount), max: fmt(product.maxAmount) })
    : t('investments:product.limitsMin', { min: fmt(product.minAmount) });
  const facts = [
    [t('investments:product.term'), t('investments:product.termDays', { count: product.termDays })],
    [t('investments:product.assets'), product.assets.join(', ')],
    [t('investments:product.limits'), limits],
    [t('investments:product.performanceFee'), formatPercent(product.performanceFeeRate)],
    [t('investments:product.earlyExit'), product.earlyExitAllowed ? t('investments:product.earlyExitFee', { rate: formatPercent(product.earlyExitFeeRate) }) : t('investments:product.earlyExitNo')],
    [t('investments:product.revenueModel'), t(`investments:revenueModels.${product.revenueModel}`)],
  ];
  if (product.capacity) {
    facts.push([t('investments:product.capacity'), t('investments:product.capacityUsed', { used: fmt(product.allocated), total: fmt(product.capacity) })]);
  }
  const actions = [];
  if (onInvest && product.status === 'active') actions.push(h('button', { class: 'btn btn--primary btn--sm', type: 'button', on: { click: () => onInvest(product) } }, t('investments:product.invest')));
  if (onCalculate) actions.push(h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => onCalculate(product) } }, icon('scale', { size: 'sm' }), t('investments:product.calculate')));
  if (publicView) actions.push(h('a', { class: 'btn btn--primary btn--sm', href: '/register' }, t('investments:product.openAccount')));

  return h('article', { class: 'card product-card', dataset: { slug: product.slug }, 'aria-labelledby': `product-${product.slug}` },
    h('div', { class: 'card__header' },
      h('h3', { class: 'card__title', id: `product-${product.slug}` }, localized(product.name)),
      h('div', { class: 'cluster' }, riskBadge(product.riskLevel), product.status !== 'active' ? statusBadge(product.status) : null)),
    h('p', { class: 'text-muted' }, localized(product.summary)),
    h('dl', { class: 'kv' }, facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('details', { class: 'product-card__more' },
      h('summary', {}, t('investments:product.howItEarns')),
      h('p', { class: 'text-small' }, localized(product.revenueModelDescription)),
      h('h4', { class: 'section-title' }, t('investments:product.risks')),
      h('p', { class: 'text-small' }, localized(product.riskDisclosure))),
    h('section', { class: 'stack stack--sm' },
      h('h4', { class: 'section-title' }, t('investments:product.history')),
      resultsHistory(product.results),
      h('p', { class: 'text-xs text-subtle' }, t('investments:product.pastNotFuture'))),
    actions.length ? h('div', { class: 'cluster' }, actions) : null);
}
