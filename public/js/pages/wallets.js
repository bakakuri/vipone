// Withdrawal addresses: add (email-code confirmation, then cooldown), set the
// default, remove, and see the history of changes.
import { publicApi, walletsApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { registerAssets } from '../formatting/format-currency.js';
import { formatDateTime, formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { confirmWalletDialog, walletForm } from '../components/forms/wallet-form.js';
import { inlineHash } from '../components/misc/address-display.js';
import { pageHeader } from '../components/misc/page-header.js';
import { confirmDialog } from '../components/modals/confirm-dialog.js';
import { withMfa } from '../components/modals/mfa-dialog.js';
import { toast } from '../components/notifications/toast.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { dataTable } from '../components/tables/data-table.js';

definePage({
  id: 'wallets',
  area: 'app',
  namespaces: ['wallets', 'withdrawal', 'transactions'],
  title: 'wallets:title',
  async render({ page }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    const historyList = h('ol', { class: 'timeline' });

    async function act(fn, done) {
      try {
        await fn();
        toast(done);
        await load();
      } catch (err) {
        toast(errorMessage(err), { tone: 'error' });
      }
    }

    function statusCell(w) {
      if (w.status === 'pending_confirmation') return statusBadge('pending_confirmation');
      if (w.usableFrom && new Date(w.usableFrom) > new Date()) {
        return h('span', { class: 'stack stack--sm' }, statusBadge('cooling_down', { label: t('wallets:coolingDown') }), h('span', { class: 'text-xs text-subtle' }, t('wallets:usableFrom', { date: formatDateTime(w.usableFrom) })));
      }
      return statusBadge('active', { label: t('wallets:ready') });
    }

    function actions(w) {
      const list = [];
      if (w.status === 'pending_confirmation') list.push(h('button', { class: 'btn btn--sm btn--primary', type: 'button', on: { click: () => confirmWalletDialog(w, { onConfirmed: load }) } }, t('wallets:enterCode')));
      if (w.status === 'active' && !w.isDefault) list.push(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => act(() => walletsApi.setDefault(w.id), t('wallets:defaultSet')) } }, t('wallets:makeDefault')));
      list.push(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'aria-label': t('wallets:removeLabel', { label: w.label }), on: { click: async () => {
        const ok = await confirmDialog({ title: t('wallets:removeTitle'), text: t('wallets:removeText', { label: w.label }), confirmLabel: t('wallets:remove'), tone: 'danger' });
        if (ok) act(() => withMfa(() => walletsApi.remove(w.id)), t('wallets:removed'));
      } } }, icon('trash', { size: 'sm' })));
      return h('div', { class: 'cluster' }, list);
    }

    const table = dataTable({
      columns: [
        { key: 'label', label: t('wallets:label'), primary: true, render: (w) => h('span', { class: 'cluster' }, h('strong', {}, w.label), w.isDefault ? h('span', { class: 'badge badge--info' }, icon('star', { size: 'sm' }), t('wallets:default')) : null) },
        { key: 'network', label: t('common:fields.network'), render: (w) => `${w.assetCode} · ${w.networkCode}` },
        { key: 'address', label: t('wallets:address'), render: (w) => inlineHash(w.address) },
        { key: 'status', label: t('transactions:status'), render: statusCell },
        { key: 'actions', label: '', actions: true, render: actions },
      ],
      empty: emptyState({ iconName: 'wallet', title: t('wallets:emptyTitle'), text: t('wallets:emptyText') }),
      caption: t('wallets:listTitle'),
    });

    async function load() {
      const [wallets, history] = await Promise.all([walletsApi.list(), walletsApi.history()]);
      table.update(wallets);
      replace(historyList, history.length
        ? history.slice(0, 20).map((e) => h('li', { class: 'timeline__item is-done' }, h('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
            h('div', {}, h('div', { class: 'timeline__title' }, t(`wallets:events.${e.event}`, { label: e.label, network: e.networkCode })),
              h('div', { class: 'timeline__meta' }, h('time', { datetime: e.createdAt, title: formatDateTime(e.createdAt) }, formatRelative(e.createdAt))))))
        : h('li', { class: 'text-small text-muted' }, t('wallets:noHistory')));
    }

    const form = walletForm({ assets, onAdded: () => load() });
    replace(page,
      pageHeader({ title: t('wallets:title'), subtitle: t('wallets:subtitle'), actions: helpButton('wallets') }),
      h('div', { class: 'grid grid--sidebar' },
        h('section', { class: 'stack', 'aria-labelledby': 'wallets-list-title' }, h('h2', { class: 'section-title', id: 'wallets-list-title' }, t('wallets:listTitle')), table.el),
        h('section', { class: 'card', 'aria-labelledby': 'wallet-add-title' }, h('h2', { class: 'card__title', id: 'wallet-add-title' }, t('wallets:addTitle')), form.el)),
      h('section', { class: 'card', 'aria-labelledby': 'wallet-history-title' }, h('h2', { class: 'card__title', id: 'wallet-history-title' }, t('wallets:historyTitle')), historyList));
    await load();
  },
});
