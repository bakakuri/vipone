// Referral programme: your code and link, the rules (reward rates, hold,
// abuse checks), figures, and every reward with its status. Rewards are paid
// by the platform from its own revenue — never from the invited person's
// deposit or profit.
import { publicApi, referralsApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatDateTime } from '../formatting/format-date.js';
import { formatPercent } from '../formatting/format-number.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { referralStats } from '../components/cards/referral-stats.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { copyButton } from '../components/misc/copy-button.js';
import { pageHeader } from '../components/misc/page-header.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { dataTable } from '../components/tables/data-table.js';
import { filterBar } from '../components/tables/filter-bar.js';
import { loadMore } from '../components/tables/load-more.js';

const STATUSES = ['pending', 'under_review', 'credited', 'cancelled'];

function shareCard(overview) {
  const share = navigator.share
    ? h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => navigator.share({ title: t('referrals:shareTitle'), url: overview.link }).catch(() => {}) } }, icon('external', { size: 'sm' }), t('referrals:share'))
    : null;
  return h('section', { class: 'card referral-share', dataset: { tour: 'referral-link' }, 'aria-labelledby': 'ref-share-title' },
    h('h2', { class: 'card__title', id: 'ref-share-title' }, t('referrals:yourLink')),
    h('div', { class: 'stack stack--sm' },
      h('div', { class: 'field__label' }, t('referrals:code')),
      h('div', { class: 'address' }, h('bdi', { class: 'address__value referral-code', dir: 'ltr' }, overview.code || '—'), overview.code ? copyButton(overview.code) : null)),
    h('div', { class: 'stack stack--sm' },
      h('div', { class: 'field__label' }, t('referrals:link')),
      h('div', { class: 'address' }, h('bdi', { class: 'address__value', dir: 'ltr' }, overview.link || '—'), overview.link ? copyButton(overview.link, { label: t('referrals:copyLink') }) : null)),
    share);
}

function rulesCard(programme) {
  const items = [
    t('referrals:rules.deposit', { rate: formatPercent(programme.depositRate), scope: t(`referrals:scope.${programme.depositScope}`) }),
    t('referrals:rules.profit', { rate: formatPercent(programme.profitRate) }),
    t('referrals:rules.paidByPlatform'),
    t('referrals:rules.hold'),
    t('referrals:rules.abuse'),
  ];
  return h('section', { class: 'card card--sunken', 'aria-labelledby': 'ref-rules-title' },
    h('h2', { class: 'card__title', id: 'ref-rules-title' }, t('referrals:rulesTitle')),
    h('ul', { class: 'deposit-rules' }, items.map((text) => h('li', {}, icon('check', { size: 'sm' }), text))));
}

definePage({
  id: 'referrals',
  area: 'app',
  namespaces: ['referrals', 'transactions'],
  title: 'referrals:title',
  async render({ page }) {
    registerAssets(await publicApi.assets());
    const statsSlot = h('div');
    const topSlot = h('div', { class: 'grid grid--2' });
    const depositsSlot = h('div');
    let filters = {};

    const table = dataTable({
      columns: [
        { key: 'source', label: t('referrals:source'), primary: true, render: (r) => h('span', {}, t(`referrals:sources.${r.sourceType}`), h('span', { class: 'text-xs text-subtle' }, ` · ${r.referredEmailMasked}`)) },
        { key: 'base', label: t('referrals:base'), align: 'end', render: (r) => h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(r.baseAmount, r.assetCode)) },
        { key: 'rate', label: t('referrals:rate'), align: 'end', render: (r) => formatPercent(r.rate) },
        { key: 'amount', label: t('referrals:reward'), align: 'end', render: (r) => h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(r.amount, r.assetCode)) },
        { key: 'status', label: t('transactions:status'), render: (r) => h('span', { class: 'stack stack--sm' }, statusBadge(r.status),
          r.status === 'pending' && r.releaseAt ? h('span', { class: 'text-xs text-subtle' }, t('referrals:releaseAt', { date: formatDateTime(r.releaseAt) })) : null) },
        { key: 'date', label: t('transactions:date'), render: (r) => formatDateTime(r.createdAt) },
      ],
      empty: emptyState({ iconName: 'referrals', title: t('referrals:emptyTitle'), text: t('referrals:emptyText') }),
      caption: t('referrals:rewardsTitle'),
    });
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await referralsApi.rewards({ ...filters, cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    const bar = filterBar({
      fields: [{ name: 'status', type: 'select', label: t('transactions:status'), options: STATUSES.map((s) => ({ value: s, label: t(`common:status.${s}`) })) }],
      onChange: (v) => {
        filters = v;
        loadRewards();
      },
    });
    filters = bar.values();

    async function loadRewards() {
      const res = await referralsApi.rewards(filters);
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }
    async function loadOverview() {
      const o = await referralsApi.overview();
      replace(topSlot, shareCard(o), rulesCard(o.programme));
      replace(statsSlot, o.programme.enabled ? null : alertBox({ tone: 'warning', text: t('referrals:paused') }), referralStats(o));
      replace(depositsSlot, o.confirmedDeposits.length
        ? h('p', { class: 'text-small text-muted' }, t('referrals:confirmedDeposits'), ' ', o.confirmedDeposits.map((d) => formatAmount(d.amount, d.asset)).join(', '))
        : null);
    }

    replace(page,
      pageHeader({ title: t('referrals:title'), subtitle: t('referrals:subtitle'), actions: helpButton('referrals') }),
      topSlot, statsSlot, depositsSlot,
      h('section', { class: 'stack', 'aria-labelledby': 'ref-rewards-title' }, h('h2', { class: 'section-title', id: 'ref-rewards-title' }, t('referrals:rewardsTitle')), bar.el, table.el, more.el));
    await Promise.all([loadOverview(), loadRewards()]);
    liveRefresh(['referral.updated'], () => Promise.all([loadOverview(), loadRewards()]).catch(() => {}));
  },
});
