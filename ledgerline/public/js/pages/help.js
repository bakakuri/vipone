// Help centre: searchable guides (deposits, holds, investments, results,
// withdrawals and fees, referrals, security), a glossary, and a way to replay
// the onboarding tour.
import { profileApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { raw, t } from '../i18n/i18n.js';
import { accordion } from '../components/misc/accordion.js';
import { debounce } from '../utils/debounce.js';

definePage({
  id: 'help',
  area: 'public',
  namespaces: ['help', 'onboarding'],
  title: 'help:title',
  render({ page, user }) {
    const sections = raw('help:center.sections') || [];
    const glossary = raw('help:glossary.terms') || [];
    const results = h('div', { class: 'stack' });
    const search = h('input', { class: 'input', type: 'search', id: 'help-search', placeholder: t('help:searchPlaceholder'), autocomplete: 'off' });
    const status = h('p', { class: 'text-small text-muted', role: 'status' });

    function sectionEl(s, items) {
      return h('section', { class: 'help-section', id: s.id, 'aria-labelledby': `help-${s.id}` },
        h('h2', { id: `help-${s.id}` }, s.title),
        accordion(items.map((q) => ({ title: q.q, content: [].concat(q.a).map((p) => h('p', {}, p)) }))));
    }

    function render(term = '') {
      const needle = term.trim().toLowerCase();
      const matches = sections
        .map((s) => ({ s, items: s.items.filter((q) => !needle || `${q.q} ${[].concat(q.a).join(' ')}`.toLowerCase().includes(needle)) }))
        .filter((x) => x.items.length);
      replace(results, matches.map(({ s, items }) => sectionEl(s, items)));
      status.textContent = needle ? t('help:resultsCount', { count: matches.reduce((n, x) => n + x.items.length, 0) }) : '';
    }
    search.addEventListener('input', debounce(() => render(search.value), 150));

    const tour = user
      ? h('button', { class: 'btn', type: 'button', on: { click: async () => {
          await profileApi.onboarding({ completed: false, dismissed: false, step: 0 }).catch(() => {});
          location.assign('/dashboard');
        } } }, icon('map', { size: 'sm' }), t('help:replayTour'))
      : null;

    replace(page,
      h('section', { class: 'section section--tight' }, h('div', { class: 'section__inner section__inner--narrow stack' },
        h('header', { class: 'section__header' }, h('h1', {}, t('help:title')), h('p', {}, t('help:subtitle'))),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'help-search' }, t('help:search')), search),
        status,
        h('nav', { class: 'help-toc cluster', 'aria-label': t('help:contents') }, sections.map((s) => h('a', { href: `#${s.id}` }, s.title))),
        results,
        h('section', { class: 'help-section', id: 'glossary', 'aria-labelledby': 'help-glossary' },
          h('h2', { id: 'help-glossary' }, t('help:glossary.title')),
          h('dl', { class: 'glossary' }, glossary.flatMap((g) => [h('dt', {}, g.term), h('dd', {}, g.text)]))),
        h('div', { class: 'cluster' }, tour, h('a', { class: 'btn btn--ghost', href: user ? '/support' : '/contact' }, icon('support', { size: 'sm' }), t('help:stillNeed'))))));
    render();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  },
});
