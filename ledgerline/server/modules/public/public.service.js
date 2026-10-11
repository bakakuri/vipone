// Public, unauthenticated information: configuration for the browser,
// supported assets and networks, products (with realised history only),
// legal documents and — when enabled in live mode — aggregate statistics.

import { getConfig } from '../../config/env.js';
import { getSql } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { listAssetNetworks } from '../assets/assets.repository.js';
import { getSettings } from '../settings/settings.service.js';

export async function getPublicConfig() {
  const config = getConfig();
  const settings = await getSettings(getSql(), ['languages.enabled', 'support.contact_email', 'live.enabled', 'funds.deposit_hold_days']);
  return {
    appName: config.appName,
    mode: config.mode,
    languages: settings['languages.enabled'] || ['en', 'ru', 'ar'],
    supportEmail: settings['support.contact_email'] || null,
    depositHoldDays: settings['funds.deposit_hold_days'] ?? 7,
    live: { enabled: settings['live.enabled'] !== false, transport: config.live.transport },
    demoTools: config.demoToolsEnabled,
  };
}

export async function getAssets() {
  return listAssetNetworks(getSql());
}

export async function getLegalDocuments() {
  const rows = await getSql()`
    select doc_type, version, locale, title, path, is_prevailing, published_at from app.legal_documents
    where is_current order by doc_type, locale`;
  return rows.map(camelize);
}

// Aggregate statistics are only published for real (live) operations and when
// enabled. Demo deployments never show statistics that could be mistaken for
// real activity.
export async function getStats() {
  const config = getConfig();
  const sql = getSql();
  const settings = await getSettings(sql, ['public_stats.enabled']);
  if (!config.isLive || settings['public_stats.enabled'] !== true) return { available: false };
  const [users] = await sql`select count(*)::int as count from app.profiles where status <> 'closed'`;
  const custody = await sql`
    select a.asset_code, sum(b.balance) as amount
    from app.ledger_accounts a join app.ledger_balances b on b.account_id = a.id
    where a.owner_type = 'system' and a.account_type in ('custody', 'strategy')
    group by a.asset_code order by a.asset_code`;
  const [lastRecon] = await sql`select max(created_at) as at from app.reconciliation_runs where status = 'ok'`;
  return {
    available: true,
    accounts: users.count,
    assetsUnderCustody: custody.map((r) => ({ asset: r.asset_code, amount: trimAmount(r.amount) })),
    lastReconciledAt: lastRecon?.at ?? null,
  };
}
