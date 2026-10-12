#!/usr/bin/env node
// Demo data for a DEMO deployment (APP_MODE=demo). Refuses to run in live
// mode. Everything it creates goes through the same code paths as real
// activity and is labelled as demo data:
//   - deposit address pools generated for the active networks
//   - one product named "[DEMO] …" (legal reference DEMO-ONLY)
//   - with AUTH_PROVIDER=local: a demo customer and two staff accounts
//     (finance, compliance) with random passwords printed once
//   - a demo deposit for the customer, ingested through the blockchain
//     event pipeline (confirmations -> credit -> 7-day hold)
//
//   npm run db:seed:demo
// With Supabase Auth, register through the site and grant staff roles with
// `npm run admin:grant -- <email> <role>` instead.

import crypto from 'node:crypto';
import { getConfig } from '../server/config/env.js';
import { closeDb, getSql, withTransaction } from '../server/db/client.js';
import { getAuthProvider } from '../server/integrations/auth/index.js';
import { verifyEmail } from '../server/modules/auth/auth.service.js';
import { ingestChainEvents } from '../server/modules/deposits/deposits.service.js';
import { encodeBase58Check } from '../server/utils/address-checksum.js';

const config = getConfig();
if (config.isLive || config.mode !== 'demo') {
  console.error('Refusing to seed: demo data can only be created with APP_MODE=demo.');
  process.exit(1);
}
const sql = getSql();
const ctx = { ipHash: 'seed', userAgent: 'seed-demo script' };

function randomPassword() {
  return `${crypto.randomBytes(9).toString('base64url')}-Aa9!`;
}

const ADDRESS = {
  tron: () => encodeBase58Check(0x41, crypto.randomBytes(20)),
  evm: () => `0x${crypto.randomBytes(20).toString('hex')}`,
  bitcoin: () => encodeBase58Check(0x00, crypto.randomBytes(20)),
};

async function seedAddressPools() {
  const networks = await sql`select code, family from app.networks where is_active and not memo_required`;
  for (const n of networks) {
    const make = ADDRESS[n.family];
    if (!make) continue;
    const [{ count }] = await sql`select count(*)::int from app.deposit_address_pool where network_code = ${n.code} and status = 'available'`;
    for (let i = count; i < 25; i += 1) {
      await sql`insert into app.deposit_address_pool (network_code, address, imported_by) values (${n.code}, ${make()}, null) on conflict do nothing`;
    }
    console.log(`address pool ${n.code}: ready`);
  }
}

async function seedProduct() {
  const [existing] = await sql`select id from app.investment_products where slug = 'demo-market-neutral'`;
  if (existing) return existing.id;
  const text = (en, ru, ar) => sql.json({ en, ru, ar });
  const [p] = await sql`
    insert into app.investment_products (slug, name, summary, risk_disclosure, revenue_model, revenue_model_description,
      term_days, min_amount, max_amount, capacity, performance_fee_rate, early_exit_allowed, early_exit_fee_rate,
      risk_level, legal_status, legal_reference, status)
    values ('demo-market-neutral',
      ${text('[DEMO] Market-neutral strategy', '[ДЕМО] Рыночно-нейтральная стратегия', '[تجريبي] استراتيجية محايدة للسوق')},
      ${text('Demo product for testing the platform. Not an offer; balances have no value.',
             'Демо-продукт для тестирования платформы. Не является предложением; балансы не имеют ценности.',
             'منتج تجريبي لاختبار المنصة. ليس عرضًا؛ والأرصدة لا قيمة لها.')},
      ${text('Demo only. In a real product this section describes the strategy risks: market, counterparty, liquidity and operational risk.',
             'Только демо. В реальном продукте здесь описываются риски стратегии: рыночный, контрагента, ликвидности и операционный.',
             'تجريبي فقط. في المنتج الحقيقي يصف هذا القسم مخاطر الاستراتيجية: السوق والطرف المقابل والسيولة والتشغيل.')},
      'trading',
      ${text('Demo only. A real product explains here exactly how returns are generated and where the funds are held.',
             'Только демо. Реальный продукт объясняет здесь, как именно формируется доход и где хранятся средства.',
             'تجريبي فقط. يشرح المنتج الحقيقي هنا كيف يتحقق العائد بالضبط وأين تُحفظ الأموال.')},
      28, 50, 100000, 1000000, 0.2, true, 0.02, 'high', 'approved', 'DEMO-ONLY — not an offer', 'active')
    returning id`;
  await sql`insert into app.investment_product_assets (product_id, asset_code) values (${p.id}, 'USDT'), (${p.id}, 'USDC') on conflict do nothing`;
  console.log('product: [DEMO] Market-neutral strategy');
  return p.id;
}

async function createUser(email, roles = []) {
  const [existing] = await sql`select id from app.profiles where lower(email) = lower(${email})`;
  if (existing) return { id: existing.id, created: false };
  const password = randomPassword();
  const result = await getAuthProvider().signUp({ email, password, metadata: { locale: 'en', country_code: 'GE' } });
  const { profile } = await verifyEmail({ tokenHash: result.emailToken, type: 'signup' }, ctx);
  for (const role of roles) await sql`insert into app.user_roles (user_id, role) values (${profile.id}, ${role}) on conflict do nothing`;
  console.log(`user ${email}${roles.length ? ` (${roles.join(', ')})` : ''} — password: ${password}`);
  return { id: profile.id, created: true };
}

async function demoDeposit(userId) {
  const [already] = await sql`select 1 from app.deposits where user_id = ${userId} limit 1`;
  if (already) return;
  const address = await withTransaction(async (tx) => (await tx`select * from app.assign_deposit_address(${userId}, 'TRON')`)[0]);
  const hash = crypto.randomBytes(32).toString('hex');
  const [result] = await ingestChainEvents('demo', [{
    providerEventId: `demo:${hash}:0:25`, network: 'TRON', txHash: hash, logIndex: 0,
    toAddress: address.address, memo: address.memo, fromAddress: ADDRESS.tron(), asset: 'USDT',
    amount: '1000', confirmations: 25, raw: { demo: true },
  }]);
  console.log(`demo deposit: 1000 USDT, status ${result.status}`);
}

try {
  await seedAddressPools();
  await seedProduct();
  if (config.auth.provider === 'local') {
    const customer = await createUser('demo.customer@ledgerline.test');
    await createUser('demo.finance@ledgerline.test', ['finance']);
    await createUser('demo.compliance@ledgerline.test', ['compliance', 'super_admin']);
    if (customer.created) await demoDeposit(customer.id);
    console.log('Passwords are shown only once. Accounts already present were left unchanged.');
  } else {
    console.log('Supabase Auth: register through the site, then grant roles with npm run admin:grant.');
  }
} finally {
  await closeDb();
}
