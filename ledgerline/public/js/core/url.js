// URL helpers.
export function query(name) {
  return new URL(location.href).searchParams.get(name);
}

export function setQuery(params, { replace = true } = {}) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

// Only same-site relative paths are accepted as post-login redirects.
export function safeRedirect(target, fallback = '/dashboard') {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return fallback;
  return target;
}

export function localePrefix() {
  const m = location.pathname.match(/^\/(ru|ar)(?=\/|$)/);
  return m ? m[1] : null;
}

export function pathWithoutLocale() {
  return location.pathname.replace(/^\/(ru|ar)(?=\/|$)/, '') || '/';
}
