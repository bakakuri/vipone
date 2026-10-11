// Minimal SVG line chart for balance history (real ledger data only).
import { h, svg } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

let chartSeq = 0;

export function lineChart({ points, formatY = String, formatX = String, height = 220, label } = {}) {
  const width = 640;
  const pad = { top: 16, right: 12, bottom: 28, left: 56 };
  if (!points?.length) return h('div', { class: 'chart__empty' }, t('common:chart.noData'));
  const ys = points.map((p) => Number(p.y));
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i) => pad.left + (i / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p.y)).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${height - pad.bottom}L${x(0).toFixed(1)},${height - pad.bottom}Z`;
  const ticks = [0, 0.5, 1].map((f) => min + (max - min) * f);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const rtl = document.documentElement.dir === 'rtl';

  // Gradient stroke and a fading area fill (colours from CSS stop classes).
  chartSeq += 1;
  const strokeId = `lc-stroke-${chartSeq}`;
  const fillId = `lc-fill-${chartSeq}`;
  const defs = svg('defs', {},
    svg('linearGradient', { id: strokeId, x1: '0', y1: '0', x2: '1', y2: '0' },
      svg('stop', { offset: '0%', class: 'chart__grad-a' }),
      svg('stop', { offset: '50%', class: 'chart__grad-b' }),
      svg('stop', { offset: '100%', class: 'chart__grad-c' })),
    svg('linearGradient', { id: fillId, x1: '0', y1: '0', x2: '0', y2: '1' },
      svg('stop', { offset: '0%', class: 'chart__grad-c', 'stop-opacity': '0.35' }),
      svg('stop', { offset: '55%', class: 'chart__grad-a', 'stop-opacity': '0.12' }),
      svg('stop', { offset: '100%', class: 'chart__grad-a', 'stop-opacity': '0' })));

  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label || '' },
    defs,
    svg('g', { class: 'chart__grid' }, ticks.map((v) => svg('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }))),
    svg('g', { class: 'chart__axis' },
      ticks.map((v) => svg('text', { x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, formatY(String(v)))),
      points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1 ? svg('text', { x: x(i), y: height - 8, 'text-anchor': 'middle' }, formatX(p.x)) : null)),
    ),
    svg('path', { class: 'chart__area', d: area, fill: `url(#${fillId})` }),
    svg('path', { class: 'chart__line', d: line, stroke: `url(#${strokeId})` }),
    svg('circle', { class: 'chart__point', cx: x(points.length - 1), cy: y(Number(points[points.length - 1].y)), r: 4 }),
  );
  if (rtl) chart.setAttribute('direction', 'ltr');
  const wrap = h('div', { class: 'chart', dir: 'ltr' }, chart);
  requestAnimationFrame(() => wrap.classList.add('is-drawn'));
  return wrap;
}
