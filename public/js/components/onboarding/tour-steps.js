// First-login guided tour. Targets are elements with data-tour attributes;
// when a target is not visible (e.g. sidebar on a phone) the step is shown
// as a centered card.
export const TOUR_STEPS = [
  { id: 'welcome', target: null },
  { id: 'balances', target: '[data-tour="balances"]' },
  { id: 'deposit', target: '[data-tour="deposit"]' },
  { id: 'transactions', target: '[data-tour="transactions"]' },
  { id: 'investments', target: '[data-tour="investments"]' },
  { id: 'withdrawals', target: '[data-tour="withdrawals"]' },
  { id: 'referrals', target: '[data-tour="referrals"]' },
  { id: 'security', target: '[data-tour="security"]' },
  { id: 'help', target: '[data-tour="help"]' },
];
