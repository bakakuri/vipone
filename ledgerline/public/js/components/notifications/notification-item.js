// Renders one notification in the user's current language from its type and
// parameters (amounts formatted locally).
import { h, icon } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatRelative } from '../../formatting/format-date.js';
import { localized, t } from '../../i18n/i18n.js';

const TONE = {
  deposit_credited: 'positive', withdrawal_completed: 'positive', referral_reward_credited: 'positive', investment_result_posted: 'positive',
  deposit_rejected: 'negative', withdrawal_rejected: 'negative', withdrawal_failed: 'negative', security_alert: 'negative',
  deposit_under_review: 'pending', withdrawal_created: 'pending', referral_reward_pending: 'pending', investment_awaiting_settlement: 'pending',
};
const ICON = {
  deposit: 'deposit', withdrawal: 'withdraw', investment: 'layers', referral: 'referrals', security: 'shield', wallet: 'wallet',
  kyc: 'user', announcement: 'megaphone', support: 'support', registration: 'check-circle',
};

export function notificationParams(n) {
  const p = { ...(n.params || {}) };
  if (p.amount && p.asset) p.amount = formatAmount(p.amount, p.asset, { withAsset: false });
  if (p.kind) p.kind = t(`notifications:securityKinds.${p.kind}`);
  if (p.status) p.status = t(`common:status.${p.status}`);
  return p;
}

export function notificationText(n) {
  if (n.type === 'announcement') return { title: localized(n.params?.title), body: localized(n.params?.body) };
  const params = notificationParams(n);
  return { title: t(`notifications:types.${n.type}.title`, params), body: t(`notifications:types.${n.type}.body`, params) };
}

export function notificationItem(n, { tag = 'a' } = {}) {
  const { title, body } = notificationText(n);
  const prefix = n.type.split('_')[0];
  return h(tag, { class: `notification-item notification-item--${TONE[n.type] || 'neutral'} ${n.readAt ? '' : 'is-unread'}`, href: tag === 'a' ? n.link || '/notifications' : undefined, dataset: { id: n.id } },
    h('span', { class: 'notification-item__icon' }, icon(ICON[prefix] || 'bell', { size: 'sm' })),
    h('span', { class: 'notification-item__body' },
      h('span', { class: 'notification-item__title' }, title),
      body ? h('span', { class: 'notification-item__text' }, body) : null,
      h('span', { class: 'notification-item__time' }, formatRelative(n.createdAt))),
  );
}
