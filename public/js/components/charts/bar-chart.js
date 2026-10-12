// Grouped SVG bar chart (admin activity per day).
import { h, svg } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function barChart({ categories, series, height = 220, formatX = String, label } = {}) {
  const width = 640;
  const pad = { top: 12, right: 8, bottom: 28, left: 36 };
  if (!categories?.length) return h('div', { class: 'chart__empty' }, t('common:chart.noData'));
  const max = Math.max(1, ...series.flatMap((s) => s.values.map(Number)));
  const groupW = (width - pad.left - pad.right) / categories.length;
  const barW = Math.max(2, (groupW - 6) / series.length);
  const y = (v) => pad.top + (1 - v / max) * (height - pad.top - pad.bottom);
  const labelEvery = Math.max(1, Math.ceil(categories.length / 7));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label || '' },
    svg('g', { class: 'chart__grid' }, [0, 0.5, 1].map((f) => svg('line', { x1: pad.left, x2: width - pad.right, y1: y(max * f), y2: y(max * f) }))),
    svg('g', { class: 'chart__axis' },
      [0, 0.5, 1].map((f) => svg('text', { x: pad.left - 6, y: y(max * f) + 4, 'text-anchor': 'end' }, String(Math.round(max * f)))),
      categories.map((c, i) => (i % labelEvery === 0 ? svg('text', { x: pad.left + groupW * i + groupW / 2, y: height - 8, 'text-anchor': 'middle' }, formatX(c)) : null)),
    ),
    categories.map((_, i) =>
      series.map((s, j) => {
        const v = Number(s.values[i]) || 0;
        const bar = svg('rect', { class: `chart__bar ${s.className || ''}`, x: pad.left + groupW * i + 3 + barW * j, y: y(v), width: barW - 1, height: Math.max(0, height - pad.bottom - y(v)), rx: Math.min(4, barW / 3) },
          svg('title', {}, `${s.name}: ${v}`));
        bar.style.setProperty('animation-delay', `${Math.min(i * 25, 600)}ms`);
        return bar;
      }),
    ),
  );
  const wrap = h('div', { class: 'chart', dir: 'ltr' }, chart,
    h('div', { class: 'chart__legend' }, series.map((s) => h('span', {}, h('i', { style: { background: s.swatch || 'var(--color-accent)', color: s.swatch || 'var(--color-accent)' } }), s.name))));
  requestAnimationFrame(() => wrap.classList.add('is-drawn'));
  return wrap;
}
