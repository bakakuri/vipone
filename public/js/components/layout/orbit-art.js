// Decorative orbit with floating coins (CSS in components/orbit-art.css).
import { h } from '../../core/dom.js';

export function orbitArt() {
  const coin = (cls, glyph) => h('span', { class: `coin ${cls}` }, h('span', { class: 'coin__face' }, glyph));
  return h('div', { class: 'orbit-art', 'aria-hidden': 'true' },
    h('span', { class: 'orbit-art__glow' }),
    h('span', { class: 'orbit-art__ring orbit-art__ring--1' }, h('span', { class: 'orbit-art__sat' })),
    h('span', { class: 'orbit-art__ring orbit-art__ring--2' }, h('span', { class: 'orbit-art__sat orbit-art__sat--violet' })),
    h('span', { class: 'orbit-art__ring orbit-art__ring--3' }),
    coin('coin--a', '₮'), coin('coin--b', '₿'), coin('coin--c', 'Ξ'));
}
