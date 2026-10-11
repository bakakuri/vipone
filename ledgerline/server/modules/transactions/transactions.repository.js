// The user's transaction history, derived from the ledger itself, so every
// row is backed by posted debit/credit entries. Amounts are the change in the
// user's balances; "fee" rows are informational breakdowns already included
// in the withdrawal or early-exit row they reference.

export const TRANSACTION_TYPES = [
  'deposit', 'withdrawal', 'investment_allocation', 'investment_release', 'profit', 'loss',
  'referral_reward', 'fee', 'refund', 'adjustment',
];

export async function listActivity(db, userId, { type, asset, status, from, to, cursor, limit = 25 }) {
  return db`
    with my_accounts as (
      select id, account_type from app.ledger_accounts where user_id = ${userId}
    ),
    per_tx as (
      select t.id, t.tx_type, t.asset_code, t.reference_type, t.reference_id, t.posted_at, t.metadata,
             coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end) filter (where a.account_type = 'available'), 0) as d_available,
             coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end) filter (where a.account_type = 'invested'), 0) as d_invested
      from app.ledger_entries e
      join my_accounts a on a.id = e.account_id
      join app.ledger_transactions t on t.id = e.transaction_id
      where t.tx_type <> 'withdrawal_settlement'
      group by t.id
    ),
    activity as (
      select pt.id::text as id, pt.id as ledger_transaction_id,
             case pt.tx_type
               when 'deposit' then 'deposit'
               when 'withdrawal_hold' then 'withdrawal'
               when 'withdrawal_release' then 'refund'
               when 'investment_allocation' then 'investment_allocation'
               when 'investment_release' then 'investment_release'
               when 'investment_early_exit' then 'investment_release'
               when 'investment_result' then case when pt.d_invested >= 0 then 'profit' else 'loss' end
               when 'referral_reward' then 'referral_reward'
               else 'adjustment'
             end as type,
             pt.asset_code,
             case when pt.tx_type = 'investment_result' then pt.d_invested
                  when pt.tx_type = 'adjustment' then pt.d_available + pt.d_invested
                  else pt.d_available end as amount,
             case when pt.tx_type = 'withdrawal_hold' then w.status else 'completed' end as status,
             pt.posted_at,
             coalesce(d.reference, w.reference, pos.reference, pos2.reference) as reference,
             coalesce(d.tx_hash, w.tx_hash) as tx_hash,
             pt.reference_type, pt.reference_id,
             false as informational
      from per_tx pt
      left join app.deposits d on pt.reference_type = 'deposit' and d.id = pt.reference_id
      left join app.withdrawal_requests w on pt.reference_type = 'withdrawal_request' and w.id = pt.reference_id
      left join app.investment_positions pos on pt.reference_type = 'investment_position' and pos.id = pt.reference_id
      left join lateral (
        select p.reference from app.investment_events ev join app.investment_positions p on p.id = ev.position_id
        where pt.reference_type = 'investment_result' and ev.result_id = pt.reference_id and p.user_id = ${userId}
        limit 1
      ) pos2 on true
      union all
      select 'fee-w-' || w.id, w.settlement_transaction_id, 'fee', w.asset_code, -(w.platform_fee + w.network_fee), 'completed',
             w.completed_at, w.reference, w.tx_hash, 'withdrawal_request', w.id, true
      from app.withdrawal_requests w
      where w.user_id = ${userId} and w.status = 'completed' and (w.platform_fee + w.network_fee) > 0
      union all
      select 'fee-p-' || p.id, p.release_transaction_id, 'fee', p.asset_code, -p.early_exit_fee, 'completed',
             p.closed_at, p.reference, null, 'investment_position', p.id, true
      from app.investment_positions p
      where p.user_id = ${userId} and coalesce(p.early_exit_fee, 0) > 0
    )
    select * from activity
    where (${type ?? null}::text is null or type = ${type ?? null})
      and (${asset ?? null}::text is null or asset_code = ${asset ?? null})
      and (${status ?? null}::text is null or status = ${status ?? null})
      and (${from ?? null}::timestamptz is null or posted_at >= ${from ?? null}::timestamptz)
      and (${to ?? null}::timestamptz is null or posted_at < ${to ?? null}::timestamptz)
      and (${cursor?.t ?? null}::timestamptz is null or (posted_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::text))
    order by posted_at desc, id desc
    limit ${limit + 1}`;
}

export async function getTransactionForUser(db, userId, transactionId) {
  const [tx] = await db`
    select t.id, t.tx_type, t.asset_code, t.reference_type, t.reference_id, t.description, t.posted_at, t.source
    from app.ledger_transactions t
    where t.id = ${transactionId}
      and exists (select 1 from app.ledger_entries e join app.ledger_accounts a on a.id = e.account_id
                  where e.transaction_id = t.id and a.user_id = ${userId})`;
  if (!tx) return null;
  const entries = await db`
    select e.id, a.account_type, e.direction, e.amount, e.created_at
    from app.ledger_entries e join app.ledger_accounts a on a.id = e.account_id
    where e.transaction_id = ${transactionId} and a.user_id = ${userId}
    order by e.id`;
  return { tx, entries };
}
