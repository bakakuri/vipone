// Referral programme figures: invited, funded, rewards by status.
import { h } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatInteger } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';

export function referralStats(overview) {
  const sumBy = (status) => overview.rewards.filter((r) => (Array.isArray(status) ? status.includes(r.status) : r.status === status));
  const list = (rows) => (rows.length ? rows.map((r) => h('div', { class: 'num' }, formatAmount(r.amount, r.asset))) : [h('div', { class: 'num' }, '0')]);
  const cell = (label, content, hint) => h('div', { class: 'stat-card stat' }, h('div', { class: 'stat__label' }, label), h('div', { class: 'stat__value stat__value--sm' }, content), hint ? h('div', { class: 'stat__meta' }, hint) : null);
  return h('div', { class: 'grid grid--4' },
    cell(t('referrals:stats.invited'), formatInteger(overview.invited)),
    cell(t('referrals:stats.funded'), formatInteger(overview.fundedReferrals), t('referrals:stats.fundedHint')),
    cell(t('referrals:stats.pending'), list(sumBy(['pending', 'under_review'])), t('referrals:stats.pendingHint')),
    cell(t('referrals:stats.credited'), list(sumBy('credited'))),
  );
}
