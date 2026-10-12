// Runs synchronously in <head> before first paint (no inline scripts: CSP).
// Applies the saved or system theme and the page language/direction so there
// is no flash of the wrong theme or of a left-to-right Arabic layout.
(function () {
  var root = document.documentElement;
  var store = {};
  try {
    store.theme = localStorage.getItem('ll.theme');
    store.locale = localStorage.getItem('ll.locale');
  } catch (e) {
    /* storage unavailable: use defaults */
  }
  var theme = store.theme === 'light' || store.theme === 'dark' ? store.theme : null;
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);

  var supported = ['en', 'ru', 'ar'];
  var fromPath = (location.pathname.match(/^\/(ru|ar)(\/|$)/) || [])[1];
  var locale = fromPath || (supported.indexOf(store.locale) >= 0 ? store.locale : null);
  if (!locale) {
    var langs = navigator.languages || [navigator.language || 'en'];
    for (var i = 0; i < langs.length && !locale; i++) {
      var base = String(langs[i]).slice(0, 2).toLowerCase();
      if (supported.indexOf(base) >= 0) locale = base;
    }
  }
  locale = locale || 'en';
  root.setAttribute('lang', locale);
  root.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
})();
