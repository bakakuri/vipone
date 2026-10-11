// Read access to the ledger. All writes go through the SQL posting functions
// (app.post_ledger_transaction and the domain functions that call it).

import { trimAmount } from '../../utils/camelize.js';

export async function getUserBalances(db, userId) {
  const rows = await db`select * from app.user_balances(${userId})`;
  return rows.map((r) => ({
    asset: r.asset_code,
    available: trimAmount(r.available),
    withdrawalHold: trimAmount(r.withdrawal_hold),
    invested: trimAmount(r.invested),
    depositHold: trimAmount(r.deposit_hold),
    withdrawable: trimAmount(r.withdrawable),
    total: trimAmount(r.total),
  }));
}

export async function getActiveHolds(db, userId) {
  return db`
    select asset_code, amount, unlock_at, reference_id from app.fund_holds
    where user_id = ${userId} and status = 'active' and unlock_at > now()
    order by unlock_at`;
}

export async function assetPosition(db, asset) {
  const [row] = await db`select * from app.asset_position(${asset})`;
  return row;
}

export async function verifyIntegrity(db) {
  return db`select * from app.verify_ledger_integrity()`;
}

// Daily closing balance (available + held + invested) for one user and asset,
// computed from ledger entries — never from a cached or estimated figure.
export async function userBalanceHistory(db, userId, asset, days) {
  return db`
    with accounts as (
      select id from app.ledger_accounts where user_id = ${userId} and asset_code = ${asset}
    ),
    days as (
      select generate_series((now() at time zone 'UTC')::date - (${days}::int - 1), (now() at time zone 'UTC')::date, interval '1 day')::date as day
    ),
    daily as (
      select (t.posted_at at time zone 'UTC')::date as day,
             sum(case when e.direction = 'credit' then e.amount else -e.amount end) as delta
      from app.ledger_entries e
      join app.ledger_transactions t on t.id = e.transaction_id
      where e.account_id in (select id from accounts)
      group by 1
    )
    select d.day,
           coalesce((select sum(delta) from daily where daily.day <= d.day), 0) as balance
    from days d
    order by d.day`;
}
