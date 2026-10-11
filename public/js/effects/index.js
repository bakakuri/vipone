// Visual effects for every page, chosen by area. All of them are decoration:
// they never change content, and each one checks prefers-reduced-motion.
import { mountAurora } from './aurora.js';
import { initPointerEffects } from './pointer.js';
import { initReveal } from './reveal.js';
import { initScrollState } from './scroll.js';

let started = false;

export function initEffects({ area = 'public' } = {}) {
  if (started) return;
  started = true;
  const showcase = area === 'public' || area === 'auth';
  mountAurora({ density: showcase ? 1 : 0.45 });
  initPointerEffects({ cursorGlow: area === 'public' });
  initScrollState();
  if (area === 'public') initReveal(document.body);
}
