// Period progress for display (the 28-day term and similar). The authoritative
// maturity timestamp is set by the database when the position opens (UTC);
// this only derives elapsed/remaining time from the stored timestamps.

const DAY_MS = 86400000;

export function calculateInvestmentPeriod({ startedAt, maturityAt, now = new Date() }) {
  const start = new Date(startedAt).getTime();
  const end = new Date(maturityAt).getTime();
  const t = new Date(now).getTime();
  const total = Math.max(end - start, 1);
  const elapsed = Math.min(Math.max(t - start, 0), total);
  return {
    termDays: Math.round(total / DAY_MS),
    elapsedDays: Math.floor(elapsed / DAY_MS),
    remainingMs: Math.max(end - t, 0),
    progress: Math.round((elapsed / total) * 10000) / 10000,
    matured: t >= end,
  };
}
