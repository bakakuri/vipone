// Translates static markup:
//   <h1 data-i18n="dashboard:title">Dashboard</h1>
//   <input data-i18n-attr="placeholder:auth:emailPlaceholder|aria-label:auth:email">
//   <p data-i18n="deposit:minimum" data-i18n-params='{"amount":"10"}'>
import { t } from './i18n.js';

export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    let params = {};
    if (el.dataset.i18nParams) {
      try {
        params = JSON.parse(el.dataset.i18nParams);
      } catch {
        params = {};
      }
    }
    el.textContent = t(el.dataset.i18n, params);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split('|')) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      el.setAttribute(pair.slice(0, idx), t(pair.slice(idx + 1)));
    }
  }
  const titleKey = document.documentElement.dataset.titleKey;
  if (titleKey && root === document) document.title = `${t(titleKey)} · ${t('common:brand')}`;
}
