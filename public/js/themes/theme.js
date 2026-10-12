// Light / dark / system theme. The choice is a visual preference stored in
// localStorage (and in the profile when signed in); the initial value is
// applied before paint by core/boot-theme.js.
import { emit } from '../core/events.js';
import { getPref, setPref } from '../core/storage.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference() {
  const pref = getPref('theme');
  return pref === 'light' || pref === 'dark' ? pref : 'system';
}

export function resolvedTheme(pref = getThemePreference()) {
  if (pref === 'light' || pref === 'dark') return pref;
  return media.matches ? 'dark' : 'light';
}

function apply() {
  document.documentElement.dataset.theme = resolvedTheme();
  emit('theme:changed', { theme: resolvedTheme(), preference: getThemePreference() });
}

export function setTheme(preference) {
  setPref('theme', preference === 'system' ? null : preference);
  apply();
}

export function initTheme() {
  apply();
  media.addEventListener('change', () => {
    if (getThemePreference() === 'system') apply();
  });
}
