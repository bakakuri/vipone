# Business logic

This is the rulebook. Every rule here is enforced on the server — most of them inside the SQL functions in `supabase/migrations/` — and covered by tests. The browser only explains the rules and shows previews; it never decides an amount.

Default values below come from `supabase/migrations/20261011001200_reference_data.sql` and can be changed in **Admin → Settings** (changes that relax a safeguard need a second approver).

## Balances

Each user has, per asset:

| Balance | Meaning |
| --- | --- |
| **Available** | credited funds that are not invested and not reserved by a withdrawal |
| of which **deposit hold** | the part of available funds still inside the 7-day hold of a recent deposit |
| **Withdrawable** | available − active deposit holds |
| **Withdrawal hold** | reserved by open withdrawal requests |
| **Invested** | principal plus realised (posted) results of open positions |
| **Total** | available + withdrawal hold + invested |

The dashboard's ledger strip shows exactly these four parts. All of them are computed from ledger entries; nothing is stored as a free-standing "balance" field that code could overwrite.

## Deposits

1. The user picks an asset and a network (for example USDT on TRON). The server assigns a deposit address from the **address pool** — addresses are generated offline or by a custody provider and imported by finance staff; the server never holds private keys or seed phrases. For memo networks a shared address is combined with a unique memo.
2. A deposit request lives for 24 hours (`deposits.request_ttl_hours`); the address stays assigned to the user.
3. A deposit is **detected** only from a signed blockchain event (Alchemy webhook or a generic HMAC-signed source). A transaction hash typed by the user never credits anything.
4. Confirmations are counted from the chain tip (job every 5 minutes, plus webhook updates). Required confirmations per network: Bitcoin 3, Ethereum 12, TRON 20.
5. Wallet screening runs on the sender. A hit sends the deposit to **under review** and raises a high-severity risk flag.
6. On enough confirmations and a clean screening the deposit is **credited**: `custody → user available`, in one transaction with the referral reward (if any), a notification and a live event.
7. Amounts below the network minimum, an asset the network does not support, or a deposit to a frozen account go to **under review**. Compliance decides; funds that cannot be credited are booked to `suspense` and can only be returned by finance staff, with the return recorded.
8. A chain reorganisation before crediting marks the deposit **failed** (nothing was credited). A reorganisation after crediting raises a high-severity risk flag and alerts staff — the credit is never silently reversed; any correction is an approved adjustment.

Minimum deposits: USDT-TRC20 10, USDT/USDC-ERC20 20, BTC 0.0005, ETH 0.005.

### The 7-day rule

Every credited deposit creates a **deposit hold** for 7 days (`funds.deposit_hold_days`). Held funds **can be invested** but **cannot be withdrawn** until the hold ends; the dashboard shows when each hold ends. The hold ends on its own — there is no button to skip it. This protects against fraudulent funding and abuse of the referral reward.

## Withdrawals

### Addresses

- Users save external addresses (never private keys). The address format is validated per network (Base58Check for TRON/Bitcoin legacy, bech32 for Bitcoin, EIP-55 checksum for Ethereum when mixed case).
- A new address is confirmed with a 6-digit code sent by email, then waits a **24-hour cooldown** (`withdrawal.new_address_cooldown_hours`) before it can receive funds. Every change is kept in the address history and appears in the user's notifications and security log.
- Adding an address requires two-factor sign-in (while `withdrawal.require_mfa` is on).

### Fee quote

```
platform fee = max(amount × 3%, minimum fee)      rounded half-up to the asset's precision
network fee  = current estimate for the network    (USDT-TRC20 1.5, ERC-20 6, BTC 0.00015, ETH 0.0015)
you receive  = amount − platform fee − network fee  (must be > 0)
```

Example: withdraw **100 USDT** on TRON → platform fee **3.00**, network fee **1.50**, you receive **95.50 USDT**.

The browser asks the server for a **quote**; the confirm screen shows the server's numbers, and the request must reference that quote. A quote is valid for 5 minutes and can be used once. The 3% rate is a versioned fee rule; the rule in force is stored on each request, so the fee of every past withdrawal remains provable after a rate change.

### Request checks (all in `app.create_withdrawal`)

- account active (not restricted/frozen), KYC approved (live mode), two-factor sign-in
- withdrawals enabled and the asset not paused (a reconciliation mismatch pauses an asset automatically)
- the address is confirmed and out of cooldown
- amount ≥ network minimum (USDT-TRC20 20, ERC-20 50, BTC 0.001, ETH 0.01) and within the rolling 24-hour limit (default 50,000 USDT/USDC, 1 BTC, 15 ETH)
- amount ≤ **withdrawable** balance (held deposit funds and invested funds do not count)
- the quote is valid, unused and matches

Creating the request moves the gross amount `available → withdrawal_hold` in the same transaction, so the same funds can never be requested twice — even by two simultaneous requests (row lock on the balance) or a double-clicked button (idempotency key).

### Processing

```
pending ──► under_review ──► approved ──► processing ──► completed
   │              │              │             └──────► failed  (funds back to available)
   └─► cancelled  └──► rejected ◄┘                       (by user, only while pending)
```

- Finance staff review and approve. At or above the dual-approval threshold (10,000 USDT/USDC, 0.2 BTC, 3 ETH) **two different staff members** must approve, and nobody can approve a request they created or reviewed alone.
- Processing records the on-chain transaction hash. The request becomes **completed** only when a signed chain event confirms that hash, or a second staff member independently verifies it.
- Completion books `withdrawal_hold → custody (net) + fee_revenue (3%) + network_fee_recovery`; the network fee actually paid is booked separately so differences are visible.
- Rejected, cancelled and failed requests release the hold back to available.

## Investments

### Products

A product has: name and summary in all three languages, a written **revenue model** (how returns are actually generated and where funds are held), a **risk disclosure** in every language, term in days (the demo product uses **28 days**), minimum and maximum per position, total capacity, performance fee rate, whether early exit is allowed and its fee, risk level, legal status and legal reference.

A product **cannot be activated** unless its legal status is `approved` and all texts exist in every language. Every change to the terms creates a new immutable **product version**; a position always keeps the terms it was opened under. If terms changed while the user was looking at the old ones, opening fails with `terms_changed` and the new terms are shown.

### Opening a position

Checks: product active, asset supported, amount within min/max, capacity not exceeded, account active, KYC (live mode), sufficient available balance (held deposit funds may be used). Posting: `user available → user invested` and `custody → strategy`.

### Returns are realised, never promised

There is no "daily percentage". A position earns or loses **only** when:

1. finance staff record a **realised result** for a product, asset and period (e.g. +1.8% for 1–28 October), with evidence (statement reference, note);
2. the system shows a preview of the allocation;
3. a **different** staff member approves it;
4. it is posted.

Allocation to each position open during the period:

```
share  = overlap(position life, period) / period length
gross  = value before the result × period rate × share      (truncated)
fee    = gross × performance fee rate, only when gross > 0   (rounded half-up)
net    = gross − fee                                         (losses carry no fee)
```

Periods of the same product and asset cannot overlap, and a period cannot end in the future. Losses reduce the invested balance exactly like gains increase it.

### Maturity and early exit

- At maturity (job every 5 minutes) the position's value — principal plus all posted results — returns to available. If the final period has no posted result yet, the position waits in **awaiting settlement**: nothing estimated is ever credited.
- Early exit (only if the product allows it) returns the current value minus the early-exit fee (demo product: 2%).

The calculator on the products page is a **scenario tool**: the user types a hypothetical rate and sees what it would mean. It is labelled as such and never shows a promised return.

## Referrals

- Every user has a referral code and link. The relationship is fixed at registration; self-referral is rejected; a shared sign-up IP with the referrer raises a risk flag.
- **5% of each credited deposit** of a referred user (`referral.deposit_rate`, scope `all_deposits` or `first_deposit`).
- **2% of each referred user's net realised profit** when a result is posted (`referral.profit_rate`). Losses and fees produce no reward.
- Rewards are paid **by the platform** (`referral_expense`), never taken from the referred user's deposit or profit.
- A reward starts as **pending** for 7 days (`referral.hold_days`), then is credited by the job — only if the platform's own equity in that asset (fee revenue + contributed capital) covers it (`referral.require_full_coverage`), so user balances stay fully backed. Otherwise it stays pending (`deferred_coverage`) and staff get a live alert to add capital.
- Compliance can put a reward **under review** or cancel it (e.g. the deposit turned out to be fraudulent).
- Amounts are truncated to the asset's precision; one reward per source per referred user.

## Treasury and reconciliation

- Finance staff record the balances actually observed in platform wallets and strategy venues. A reconciliation run compares them with the ledger (`custody`, `strategy`) per asset; a difference beyond tolerance (default 1 USDT/USDC, 0.0001 BTC, 0.001 ETH) **pauses withdrawals of that asset** and alerts staff.
- Moving funds between custody and strategy is a treasury transfer (recorded, idempotent).
- The operator's own money (e.g. a referral budget) enters as a capital contribution.
- Manual corrections are **adjustments**: they need a reason and a second approver, and they are ordinary balanced ledger transactions — balances are never edited.
- `GET /admin/treasury/integrity` runs `app.verify_ledger_integrity()`: cache vs entries, every transaction balanced, trial balance per asset, solvency (platform assets vs. what is owed to users).

## Accounts and compliance

- Registration needs email confirmation and acceptance of the terms, privacy policy and risk disclosure (versions recorded). Countries in `compliance.blocked_countries` cannot register.
- Passwords: 12–128 characters with lower and upper case, a digit and a symbol; not the email name; common passwords refused. Supabase Auth stores the hash.
- Two-factor authentication (TOTP) is required for withdrawals and new addresses by default.
- KYC: manual review or Sumsub. In live mode, deposit addresses, withdrawals and investments require approved KYC.
- Account statuses: **active**; **restricted** and **frozen** (the user can sign in and see everything but cannot deposit, withdraw or invest; incoming deposits to a frozen account wait for compliance review); **closed** (cannot sign in). Reinstating an account needs a second approver.

## Demo mode

`APP_MODE=demo` (default): a banner on every page, product names start with `[DEMO]`, balances have no value. Staff with the `demo.tools` permission can simulate a deposit, advance confirmations and confirm a withdrawal — all through the **same code paths** as real events (signed events, state machines, ledger), so the demo exercises the real system. Demo tools cannot be enabled in live mode.

## What the platform never does

- show a profit that has not been realised, recorded and approved
- animate or estimate a balance between server updates
- pay a referral reward out of another user's funds
- credit a deposit from a user-supplied transaction hash
- complete a withdrawal without an on-chain transaction
- edit or delete a ledger entry
