// One user, everything staff need to decide: balances (from the ledger),
// deposits, withdrawals, positions, addresses, referral link, risk flags,
// verification and security history — plus the actions their role allows.
// Every action asks for a reason; relaxing actions become approval requests.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { query } from '../../core/url.js';
import { can, currentUser } from '../../auth/session.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { getLocale, t } from '../../i18n/i18n.js';
import { LOCALES } from '../../i18n/locales.js';
import { countryOptions } from '../../utils/countries.js';
import { openModal } from '../../components/modals/modal.js';
import { setBusy } from '../../components/forms/form-validation.js';
import { actionButton } from '../../components/admin/action-button.js';
import { jsonBlock, section, userLink } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { formField, input, select } from '../../components/forms/form-field.js';
import { inlineHash } from '../../components/misc/address-display.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { reasonDialog } from '../../components/modals/confirm-dialog.js';
import { withMfa } from '../../components/modals/mfa-dialog.js';
import { breadcrumbs } from '../../components/navigation/breadcrumbs.js';
import { toast } from '../../components/notifications/toast.js';
import { errorMessage } from '../../components/feedback/error-message.js';
import { dataTable } from '../../components/tables/data-table.js';
import { normalizeAmountInput, validateAmount } from '../../validation/validate-amount.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function table(columns, rows, emptyText) {
  const tbl = dataTable({ columns, rows, empty: h('p', { class: 'text-small text-muted' }, emptyText || t('admin:none')) });
  return tbl.el;
}

definePage({
  id: 'admin-user',
  area: 'admin',
  auth: 'admin',
  permission: 'users.read',
  namespaces: ['admin', 'transactions', 'security', 'wallets'],
  title: 'admin:user.title',
  async render({ page }) {
    const id = query('id');
    if (!id || !UUID.test(id)) {
      replace(page, alertBox({ tone: 'warning', text: t('admin:user.missingId') }));
      return;
    }
    const me = currentUser();

    // Name, country and language; email and password stay with the user.
    function editProfile(p) {
      const name = formField({ label: t('admin:user.displayName'), control: input({ value: p.displayName || '', maxLength: 80 }), id: 'edit-name' });
      const country = formField({ label: t('admin:users.country'), control: select([{ value: '', label: '—' }, ...countryOptions(getLocale())]), id: 'edit-country' });
      country.control.value = p.countryCode || '';
      const language = formField({ label: t('admin:user.locale'), control: select(Object.entries(LOCALES).map(([code, l]) => ({ value: code, label: l.name }))), id: 'edit-locale' });
      language.control.value = p.locale;
      const save = h('button', { class: 'btn btn--primary', type: 'submit', form: 'edit-user-form' }, t('common:actions.save'));
      const form = h('form', { class: 'form', id: 'edit-user-form', novalidate: true }, name.el, country.el, language.el);
      const modal = openModal({ title: t('admin:user.edit'), body: form, footer: save });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setBusy(save, true);
        try {
          await adminApi.updateUser(id, { displayName: name.control.value.trim(), ...(country.control.value ? { countryCode: country.control.value } : {}), locale: language.control.value });
          modal.close();
          toast(t('admin:done'));
          load();
        } catch (err) {
          toast(errorMessage(err), { tone: 'error' });
        } finally {
          setBusy(save, false);
        }
      });
    }

    async function load() {
      const d = await adminApi.user(id);
      const p = d.profile;
      const self = p.id === me.id;
      const reload = () => load();

      const actions = [];
      if (can('users.restrict') && !self) {
        if (p.status !== 'restricted') actions.push(actionButton(t('admin:user.restrict'), { tone: 'danger', reason: t('admin:user.restrictText'), run: (reason) => adminApi.setUserStatus(id, { status: 'restricted', reason }), onDone: reload }));
        if (p.status !== 'frozen') actions.push(actionButton(t('admin:user.freeze'), { tone: 'danger', reason: t('admin:user.freezeText'), run: (reason) => adminApi.setUserStatus(id, { status: 'frozen', reason }), onDone: reload }));
        if (p.status !== 'active') actions.push(actionButton(t('admin:user.reinstate'), { reason: t('admin:user.reinstateText'), run: (reason) => adminApi.setUserStatus(id, { status: 'active', reason }), onDone: reload }));
        if (p.status !== 'closed') actions.push(actionButton(t('admin:user.close'), { tone: 'danger', reason: t('admin:user.closeText'), run: (reason) => adminApi.setUserStatus(id, { status: 'closed', reason }), onDone: reload }));
      }
      if (can('users.restrict')) actions.push(h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => editProfile(p) } }, t('admin:user.edit')));
      if (can('users.restrict') && p.mfaEnabled && !self) actions.push(actionButton(t('admin:user.mfaReset'), { reason: t('admin:user.mfaResetText'), run: (reason) => adminApi.resetUserMfa(id, { reason }), onDone: reload }));
      if (can('kyc.review') && p.kycStatus !== 'approved') {
        actions.push(actionButton(t('admin:user.kycApprove'), { reason: t('admin:user.kycApproveText'), run: (reason) => adminApi.decideKyc(id, { status: 'approved', reason }), onDone: reload }));
      }
      if (can('kyc.review') && p.kycStatus === 'pending') {
        actions.push(actionButton(t('admin:user.kycReject'), { tone: 'danger', reason: true, run: (reason) => adminApi.decideKyc(id, { status: 'rejected', reason }), onDone: reload }));
      }

      const roleControls = can('users.roles.manage') && !self ? (() => {
        const role = select(['support', 'finance', 'compliance', 'super_admin'].map((r) => ({ value: r, label: t(`admin:roles.${r}`) })), { name: 'role' });
        const run = async (action) => {
          const reason = await reasonDialog({ title: t(`admin:user.role.${action}`), text: t('admin:user.role.text', { role: t(`admin:roles.${role.value}`) }) });
          if (!reason) return;
          try {
            const res = await withMfa(() => adminApi.requestRole(id, { role: role.value, action, reason }));
            if (res?.status === 'executed') { toast(t('admin:done')); reload(); } else toast(t('admin:approvalCreated'), { tone: 'info' });
          } catch (err) {
            toast(errorMessage(err), { tone: 'error' });
          }
        };
        return h('div', { class: 'cluster' }, formField({ label: t('admin:user.role.label'), control: role, id: 'role-select' }).el,
          h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => run('grant') } }, t('admin:user.role.grant')),
          h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => run('revoke') } }, t('admin:user.role.revoke')));
      })() : null;

      const adjustment = can('settings.request') ? (() => {
        const codes = [...new Set(['USDT', ...d.balances.map((b) => b.asset)])];
        const asset = select(codes.map((c) => ({ value: c, label: c })), { name: 'asset' });
        const direction = select([{ value: 'credit_user', label: t('admin:user.adjust.credit') }, { value: 'debit_user', label: t('admin:user.adjust.debit') }], { name: 'direction' });
        const amt = formField({ label: t('common:fields.amount'), control: input({ name: 'amount', inputmode: 'decimal', dir: 'ltr' }), id: 'adj-amount' });
        const btn = h('button', { class: 'btn btn--sm', type: 'button' }, t('admin:user.adjust.request'));
        btn.addEventListener('click', async () => {
          const value = normalizeAmountInput(amt.control.value);
          const problem = validateAmount(value);
          amt.setError(problem ? t(`errors:validation.${problem}`) : '');
          if (problem) return;
          const reason = await reasonDialog({ title: t('admin:user.adjust.title'), text: t('admin:user.adjust.text') });
          if (!reason) return;
          try {
            const res = await withMfa(() => adminApi.requestAdjustment({ userId: id, asset: asset.value, direction: direction.value, amount: value, reason }));
            amt.control.value = '';
            if (res?.status === 'executed') { toast(t('admin:user.adjust.done')); reload(); } else toast(t('admin:approvalCreated'), { tone: 'info' });
          } catch (err) {
            toast(errorMessage(err), { tone: 'error' });
          }
        });
        return h('div', { class: 'stack stack--sm' }, h('p', { class: 'text-xs text-subtle' }, t('admin:user.adjust.hint')),
          h('div', { class: 'form-row' }, formField({ label: t('common:fields.asset'), control: asset, id: 'adj-asset' }).el, formField({ label: t('admin:user.adjust.direction'), control: direction, id: 'adj-dir' }).el, amt.el), h('div', {}, btn));
      })() : null;

      // A payment received for this user: recorded as a deposit and credited.
      const addDeposit = can('deposits.review') ? (() => {
        const amt = formField({ label: t('common:fields.amount'), control: input({ inputmode: 'decimal', dir: 'ltr', placeholder: '0.00' }), id: 'add-dep-amount' });
        const hash = formField({ label: t('admin:user.addDeposit.hash'), control: input({ dir: 'ltr', class: 'input input--mono', spellcheck: false }), id: 'add-dep-hash' });
        const btn = h('button', { class: 'btn btn--sm btn--primary', type: 'button' }, t('admin:user.addDeposit.button'));
        btn.addEventListener('click', async () => {
          const value = normalizeAmountInput(amt.control.value);
          const problem = validateAmount(value);
          amt.setError(problem ? t(`errors:validation.${problem}`) : '');
          hash.setError(hash.control.value.trim() ? '' : t('errors:codes.tx_hash_required'));
          if (problem || !hash.control.value.trim()) return;
          const reason = await reasonDialog({ title: t('admin:user.addDeposit.title'), text: t('admin:user.addDeposit.text') });
          if (!reason) return;
          setBusy(btn, true);
          try {
            await adminApi.addDeposit({ userId: id, amount: value, txHash: hash.control.value.trim(), reason });
            toast(t('admin:user.addDeposit.done'));
            reload();
          } catch (err) {
            toast(errorMessage(err), { tone: 'error' });
          } finally {
            setBusy(btn, false);
          }
        });
        return h('div', { class: 'stack stack--sm' }, h('h3', { class: 'section-title' }, t('admin:user.addDeposit.title')),
          h('p', { class: 'text-xs text-subtle' }, t('admin:user.addDeposit.hint')),
          h('div', { class: 'form-row' }, amt.el, hash.el), h('div', {}, btn));
      })() : null;

      replace(page,
        pageHeader({
          breadcrumbs: breadcrumbs([{ href: '/admin/users', label: t('admin:users.title') }, { label: p.email }]),
          title: p.email,
          subtitle: t('admin:user.subtitle', { id: p.id }),
          actions,
        }),
        self ? alertBox({ tone: 'info', text: t('admin:user.selfNote') }) : null,
        h('div', { class: 'grid grid--2' },
          section(t('admin:user.profile'), h('dl', { class: 'kv' },
            h('dt', {}, t('admin:user.displayName')), h('dd', {}, p.displayName || '—'),
            h('dt', {}, t('admin:users.status')), h('dd', {}, statusBadge(p.status), p.statusReason ? h('span', { class: 'text-xs text-subtle' }, ` ${p.statusReason}`) : null),
            h('dt', {}, t('admin:users.kyc')), h('dd', {}, t(`admin:kyc.${p.kycStatus}`)),
            h('dt', {}, t('admin:users.mfa')), h('dd', {}, p.mfaEnabled ? t('admin:yes') : t('admin:no')),
            h('dt', {}, t('admin:users.country')), h('dd', {}, p.countryCode || '—'),
            h('dt', {}, t('admin:user.locale')), h('dd', {}, p.locale),
            h('dt', {}, t('admin:users.created')), h('dd', {}, formatDateTime(p.createdAt)),
            h('dt', {}, t('admin:users.lastLogin')), h('dd', {}, p.lastLoginAt ? formatDateTime(p.lastLoginAt) : '—'),
            h('dt', {}, t('admin:user.roles')), h('dd', {}, p.roles.length ? p.roles.map((r) => t(`admin:roles.${r}`)).join(', ') : '—'),
            h('dt', {}, t('admin:user.referralCode')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, p.referralCode || '—')),
            h('dt', {}, t('admin:user.referredBy')), h('dd', {}, d.referral.referrerId ? userLink(d.referral.referrerId, d.referral.referrerEmail) : '—'),
            h('dt', {}, t('admin:user.referredCount')), h('dd', {}, String(d.referral.referredCount))),
            roleControls),
          section(t('admin:user.balances'),
            table([
              { key: 'asset', label: t('common:fields.asset'), primary: true, render: (b) => h('strong', {}, b.asset) },
              { key: 'available', label: t('admin:user.available'), align: 'end', render: (b) => formatAmount(b.withdrawable, b.asset, { withAsset: false }) },
              { key: 'dh', label: t('admin:user.depositHold'), align: 'end', render: (b) => formatAmount(b.depositHold, b.asset, { withAsset: false }) },
              { key: 'wh', label: t('admin:user.withdrawalHold'), align: 'end', render: (b) => formatAmount(b.withdrawalHold, b.asset, { withAsset: false }) },
              { key: 'inv', label: t('admin:user.invested'), align: 'end', render: (b) => formatAmount(b.invested, b.asset, { withAsset: false }) },
              { key: 'total', label: t('admin:user.total'), align: 'end', render: (b) => h('strong', {}, formatAmount(b.total, b.asset, { withAsset: false })) },
            ], d.balances.map((b) => ({ ...b, id: b.asset }))),
            addDeposit,
            adjustment ? h('div', { class: 'stack stack--sm' }, h('h3', { class: 'section-title' }, t('admin:user.adjust.title')), adjustment) : null)),
        section(t('admin:user.riskFlags'), table([
          { key: 'type', label: t('admin:flags.type'), primary: true, render: (f) => t(`admin:flags.types.${f.flagType}`) },
          { key: 'severity', label: t('admin:flags.severity'), render: (f) => t(`admin:flags.severities.${f.severity}`) },
          { key: 'status', label: t('admin:users.status'), render: (f) => statusBadge(f.status === 'open' ? 'flagged' : f.status) },
          { key: 'details', label: t('admin:flags.details'), render: (f) => h('details', {}, h('summary', {}, t('admin:show')), jsonBlock(f.details)) },
          { key: 'created', label: t('admin:users.created'), render: (f) => formatDateTime(f.createdAt) },
        ], d.riskFlags)),
        h('div', { class: 'grid grid--2' },
          section(t('admin:nav.deposits'), table([
            { key: 'ref', label: t('admin:reference'), primary: true, render: (x) => h('a', { href: `/admin/deposits?search=${x.reference}` }, h('bdi', { class: 'mono', dir: 'ltr' }, x.reference)) },
            { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (x) => (x.amount ? formatAmount(x.amount, x.assetCode) : '—') },
            { key: 'status', label: t('admin:users.status'), render: (x) => statusBadge(x.status) },
            { key: 'date', label: t('admin:date'), render: (x) => formatDateTime(x.createdAt) },
          ], d.deposits)),
          section(t('admin:nav.withdrawals'), table([
            { key: 'ref', label: t('admin:reference'), primary: true, render: (x) => h('a', { href: `/admin/withdrawals?search=${x.reference}` }, h('bdi', { class: 'mono', dir: 'ltr' }, x.reference)) },
            { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (x) => formatAmount(x.amount, x.assetCode) },
            { key: 'status', label: t('admin:users.status'), render: (x) => statusBadge(x.status) },
            { key: 'date', label: t('admin:date'), render: (x) => formatDateTime(x.createdAt) },
          ], d.withdrawals))),
        h('div', { class: 'grid grid--2' },
          section(t('admin:nav.investments'), table([
            { key: 'ref', label: t('admin:reference'), primary: true, render: (x) => h('bdi', { class: 'mono', dir: 'ltr' }, x.reference) },
            { key: 'principal', label: t('admin:user.principal'), align: 'end', render: (x) => formatAmount(x.principal, x.assetCode) },
            { key: 'value', label: t('admin:user.value'), align: 'end', render: (x) => formatAmount(x.currentValue, x.assetCode) },
            { key: 'status', label: t('admin:users.status'), render: (x) => statusBadge(x.status) },
            { key: 'maturity', label: t('admin:user.maturity'), render: (x) => formatDateTime(x.maturityAt) },
          ], d.positions)),
          section(t('admin:user.wallets'), table([
            { key: 'label', label: t('wallets:label'), primary: true, render: (w) => w.label },
            { key: 'net', label: t('common:fields.network'), render: (w) => `${w.assetCode} · ${w.networkCode}` },
            { key: 'address', label: t('wallets:address'), render: (w) => inlineHash(w.address) },
            { key: 'status', label: t('admin:users.status'), render: (w) => statusBadge(w.status) },
          ], d.wallets))),
        h('div', { class: 'grid grid--2' },
          section(t('admin:user.kycHistory'), table([
            { key: 'provider', label: t('admin:user.provider'), primary: true, render: (k) => k.provider },
            { key: 'status', label: t('admin:users.status'), render: (k) => t(`admin:kyc.${k.status}`) },
            { key: 'reason', label: t('common:fields.reason'), render: (k) => k.reason || '—' },
            { key: 'date', label: t('admin:date'), render: (k) => formatDateTime(k.createdAt) },
          ], d.kyc)),
          section(t('admin:user.securityEvents'), table([
            { key: 'type', label: t('admin:user.event'), primary: true, render: (e) => t(`security:events.${e.eventType}`) },
            { key: 'ua', label: t('admin:user.device'), render: (e) => h('span', { class: 'text-xs' }, (e.userAgent || '—').slice(0, 60)) },
            { key: 'date', label: t('admin:date'), render: (e) => formatDateTime(e.createdAt) },
          ], d.securityEvents.map((e, i) => ({ ...e, id: i }))))));
    }
    await load();
  },
});
