// Number transition between two REAL values received from the server. It
// never runs on a timer and never invents intermediate balances: only the
// visual transition is animated; the final text is exactly the server value.
import { prefersReducedMotion } from './motion.js';

export function countUp(el, fromValue, toValue, render, { duration = 600 } = {}) {
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || prefersReducedMotion()) {
    el.textContent = render(toValue);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    if (p < 1) {
      el.textContent = render(String(from + (to - from) * eased));
      requestAnimationFrame(step);
    } else {
      el.textContent = render(toValue);
    }
  };
  requestAnimationFrame(step);
}
