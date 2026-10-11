// localStorage is used ONLY for visual preferences (theme, language, dismissed
// hints). Never for tokens, balances or any financial data.
const PREFIX = 'll.';
const ALLOWED = new Set(['theme', 'locale', 'sidebarCollapsed', 'dismissedHints', 'lastAsset', 'depositAsset', 'depositNetwork']);

export function getPref(key, fallback = null) {
  if (!ALLOWED.has(key)) throw new Error(`Preference ${key} is not allowed in storage`);
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  if (!ALLOWED.has(key)) throw new Error(`Preference ${key} is not allowed in storage`);
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, String(value));
  } catch {
    /* private mode or storage disabled: preferences are simply not remembered */
  }
}
