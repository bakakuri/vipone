// Small explanatory tooltip on an info icon (hover, focus or tap).
import { h, icon } from '../../core/dom.js';

let tip;

function show(target, text) {
  hide();
  tip = h('div', { class: 'tooltip', role: 'tooltip' }, text);
  document.body.append(tip);
  const r = target.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
  const top = r.top - tr.height - 8 < 8 ? r.bottom + 8 : r.top - tr.height - 8;
  tip.style.setProperty('left', `${left}px`);
  tip.style.setProperty('top', `${top}px`);
}

function hide() {
  tip?.remove();
  tip = null;
}

export function infoTip(text, label) {
  const btn = h('button', { class: 'tooltip-trigger', type: 'button', 'aria-label': label || text }, icon('info', { size: 'sm' }));
  btn.addEventListener('mouseenter', () => show(btn, text));
  btn.addEventListener('focus', () => show(btn, text));
  btn.addEventListener('click', () => (tip ? hide() : show(btn, text)));
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('blur', hide);
  return btn;
}
