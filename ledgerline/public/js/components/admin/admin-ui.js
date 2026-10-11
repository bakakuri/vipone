// Small shared pieces for admin screens.
import { h } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { t } from '../../i18n/i18n.js';
import { compareDecimal } from '../../validation/compare-decimal.js';

export function userLink(id, email) {
  return h('a', { href: `/admin/user?id=${encodeURIComponent(id)}` }, h('bdi', { dir: 'ltr' }, email || id));
}

export function kpi(label, value, { tone, href, hint } = {}) {
  const inner = [h('div', { class: 'stat__label' }, label), h('div', { class: `stat__value ${tone ? `text-${tone}` : ''}`.trim() }, value), hint ? h('div', { class: 'stat__meta' }, hint) : null];
  return href ? h('a', { class: 'stat-card stat card--interactive', href }, inner) : h('div', { class: 'stat-card stat' }, inner);
}

// Coverage ratio = (custody + strategy) / user liabilities. Below 1 means user
// balances are not fully covered and must be investigated immediately.
export function coverageBadge(ratio) {
  if (ratio === null || ratio === undefined) return h('span', { class: 'badge badge--neutral' }, t('admin:treasury.noLiabilities'));
  const ok = compareDecimal(ratio, '1') >= 0;
  return h('span', { class: `badge badge--${ok ? 'positive' : 'negative'}` }, h('bdi', { dir: 'ltr' }, `${formatAmount(ratio, null, { withAsset: false })}×`));
}

export function jsonBlock(value) {
  return h('pre', { class: 'json-block', dir: 'ltr' }, JSON.stringify(value ?? null, null, 2));
}

export function section(title, ...children) {
  return h('section', { class: 'card' }, h('div', { class: 'card__header' }, h('h2', { class: 'card__title' }, title)), ...children);
}
