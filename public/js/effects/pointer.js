// Pointer light: surfaces get a spotlight that follows the cursor (CSS
// variables --mx/--my), tiltable cards lean towards it, primary buttons are
// gently magnetic and public pages get a soft glow under the cursor.
// Mouse and trackpad only; nothing runs on touch screens or with reduced motion.

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const LIT = '.card, .stat-card, .product-card, .hero-ledger, .auth-card, .feature-card, .inflight-item, .ticket-row, .flow__step, .rules__column, .risk-callout, .notification-item, .dropdown__item, .nav-link';
const TILT = '.hero-ledger, .product-card, .stat-card, .feature-card, .flow__step, .rules__column, .position-card';
const MAGNETIC = '.btn--lg.btn--primary, .btn--magnetic';

export function initPointerEffects({ cursorGlow = false } = {}) {
  if (!finePointer.matches || reduceMotion.matches) return;
  let glow = null;
  if (cursorGlow) {
    glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.append(glow);
  }
  let last = null;
  let frame = 0;
  let lit = null;
  let tilted = null;
  let magnet = null;

  const resetTilt = (el) => {
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.classList.remove('is-tilting');
  };
  const resetMagnet = (el) => {
    if (!el) return;
    el.style.setProperty('--tx', '0px');
    el.style.setProperty('--ty', '0px');
  };

  function update() {
    frame = 0;
    const e = last;
    if (!e) return;
    if (glow) {
      glow.style.setProperty('--cx', `${e.clientX}px`);
      glow.style.setProperty('--cy', `${e.clientY}px`);
      glow.classList.add('is-active');
    }
    const target = e.target instanceof Element ? e.target : null;

    const surface = target?.closest(LIT) || null;
    if (surface) {
      const r = surface.getBoundingClientRect();
      surface.style.setProperty('--mx', `${e.clientX - r.left}px`);
      surface.style.setProperty('--my', `${e.clientY - r.top}px`);
    }
    lit = surface;

    const tilt = target?.closest(TILT) || null;
    if (tilt !== tilted) {
      resetTilt(tilted);
      tilted = tilt;
    }
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tilt.classList.add('is-tilting');
      tilt.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`);
      tilt.style.setProperty('--ry', `${(px * 9).toFixed(2)}deg`);
    }

    const m = target?.closest(MAGNETIC) || null;
    if (m !== magnet) {
      resetMagnet(magnet);
      magnet = m;
    }
    if (m) {
      const r = m.getBoundingClientRect();
      m.style.setProperty('--tx', `${((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1)}px`);
      m.style.setProperty('--ty', `${((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1)}px`);
    }
  }

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    last = e;
    if (!frame) frame = requestAnimationFrame(update);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => {
    glow?.classList.remove('is-active');
    resetTilt(tilted);
    resetMagnet(magnet);
    tilted = null;
    magnet = null;
    lit = null;
  });
}
