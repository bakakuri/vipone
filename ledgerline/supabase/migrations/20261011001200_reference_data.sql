-- Ledgerline — reference data and default settings
-- Limits and network fees below are starting points. Review them with your
-- finance team before going live; change them later through the admin panel.

insert into app.assets (code, name, decimals, display_decimals, sort_order) values
  ('USDT', 'Tether USD', 6, 2, 10),
  ('USDC', 'USD Coin', 6, 2, 20),
  ('BTC', 'Bitcoin', 8, 8, 30),
  ('ETH', 'Ether', 18, 6, 40)
on conflict (code) do nothing;

insert into app.networks (code, name, family, address_pattern, memo_required, memo_pattern, memo_label,
                          explorer_tx_url, explorer_address_url, required_confirmations, is_active) values
  ('BITCOIN', 'Bitcoin', 'bitcoin', '^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$', false, null, null,
   'https://mempool.space/tx/{tx}', 'https://mempool.space/address/{address}', 3, true),
  ('ETHEREUM', 'Ethereum', 'evm', '^0x[0-9a-fA-F]{40}$', false, null, null,
   'https://etherscan.io/tx/{tx}', 'https://etherscan.io/address/{address}', 12, true),
  ('TRON', 'TRON', 'tron', '^T[1-9A-HJ-NP-Za-km-z]{33}$', false, null, null,
   'https://tronscan.org/#/transaction/{tx}', 'https://tronscan.org/#/address/{address}', 20, true),
  ('TON', 'TON', 'ton', '^(EQ|UQ)[A-Za-z0-9_-]{46}$', true, '^[0-9]{6,20}$', 'comment',
   'https://tonviewer.com/transaction/{tx}', 'https://tonviewer.com/{address}', 1, false)
on conflict (code) do nothing;

insert into app.asset_networks (asset_code, network_code, token_standard, token_contract, min_deposit, min_withdrawal, withdrawal_network_fee) values
  ('BTC', 'BITCOIN', null, null, 0.0005, 0.001, 0.00015),
  ('ETH', 'ETHEREUM', null, null, 0.005, 0.01, 0.0015),
  ('USDT', 'TRON', 'TRC-20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 10, 20, 1.5),
  ('USDT', 'ETHEREUM', 'ERC-20', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 20, 50, 6),
  ('USDC', 'ETHEREUM', 'ERC-20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 20, 50, 6)
on conflict do nothing;

insert into app.fee_rules (fee_type, rate, min_fee, change_reason)
select 'withdrawal_platform', 0.03, 0, 'Initial platform withdrawal fee (3%)'
where not exists (select 1 from app.fee_rules);

insert into app.system_settings (key, value, description, approval_policy) values
  ('deposits.enabled', 'true', 'Accept new deposit requests and credit confirmed deposits.', 'when_relaxing'),
  ('withdrawals.enabled', 'true', 'Accept new withdrawal requests. Pausing is immediate; resuming needs a second approver.', 'when_relaxing'),
  ('withdrawals.paused_assets', '[]', 'Assets whose withdrawals are paused (set automatically on reconciliation mismatch).', 'when_relaxing'),
  ('funds.deposit_hold_days', '7', 'Days a newly credited deposit cannot be withdrawn (the 7-day rule). Held funds can still be invested.', 'always'),
  ('withdrawal.new_address_cooldown_hours', '24', 'Hours a newly confirmed withdrawal address must wait before use.', 'always'),
  ('withdrawal.dual_approval_threshold', '{"USDT": "10000", "USDC": "10000", "BTC": "0.2", "ETH": "3"}', 'Requests at or above this amount need two different approvers.', 'always'),
  ('withdrawal.daily_limit', '{"USDT": "50000", "USDC": "50000", "BTC": "1", "ETH": "15"}', 'Maximum gross withdrawals per user per rolling 24 hours.', 'always'),
  ('withdrawal.quote_ttl_seconds', '300', 'How long a fee quote stays valid.', 'none'),
  ('withdrawal.require_mfa', 'true', 'Require two-factor authentication to request withdrawals and add addresses.', 'when_relaxing'),
  ('deposits.request_ttl_hours', '24', 'How long a deposit request waits for payment before it expires.', 'none'),
  ('referral.enabled', 'true', 'Pay referral rewards.', 'always'),
  ('referral.deposit_rate', '"0.05"', 'Reward rate on a referred user''s credited deposit (paid by the platform).', 'always'),
  ('referral.deposit_scope', '"all_deposits"', 'all_deposits or first_deposit.', 'always'),
  ('referral.profit_rate', '"0.02"', 'Reward rate on a referred user''s realised, posted profit (paid by the platform).', 'always'),
  ('referral.hold_days', '7', 'Days a reward stays pending before it can be credited.', 'always'),
  ('referral.require_full_coverage', 'true', 'Pay rewards only while platform assets cover all user balances for the asset.', 'when_relaxing'),
  ('compliance.kyc_required_for', '["deposit_address", "withdrawal", "investment"]', 'Actions that require approved identity verification (live mode).', 'when_relaxing'),
  ('compliance.blocked_countries', '["KP", "IR", "SY", "CU"]', 'ISO country codes that cannot open accounts. Set with legal counsel.', 'when_relaxing'),
  ('reconciliation.tolerance', '{"USDT": "1", "USDC": "1", "BTC": "0.0001", "ETH": "0.001"}', 'Allowed difference between observed and ledger balances.', 'always'),
  ('live.enabled', 'true', 'Live Mode: push real-time update signals to dashboards.', 'none'),
  ('languages.enabled', '["en", "ru", "ar"]', 'Languages offered in the language switcher.', 'none'),
  ('public_stats.enabled', 'false', 'Show aggregate platform statistics on the home page (live mode only).', 'always'),
  ('support.contact_email', 'null', 'Support address shown to users (set it before launch; null hides it).', 'none')
on conflict (key) do nothing;

insert into app.legal_documents (doc_type, version, locale, title, path, is_current, is_prevailing)
select d.doc_type, '1.0', l.locale, d.title, d.path, true, l.locale = 'en'
from (values
  ('terms', 'Terms of Service', '/legal/terms'),
  ('privacy', 'Privacy Policy', '/legal/privacy'),
  ('cookies', 'Cookie Policy', '/legal/cookies'),
  ('risk', 'Risk Disclosure', '/risk-disclosure')
) as d (doc_type, title, path)
cross join (values ('en'), ('ru'), ('ar')) as l (locale)
on conflict do nothing;
