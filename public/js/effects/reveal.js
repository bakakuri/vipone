// Scroll reveal for public pages: blocks rise, sharpen and fade in as they
// enter the viewport, staggered among siblings. Content added later (for
// example products loaded from the API) is picked up automatically.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const TARGETS = [
  '.section__header', '.flow__step', '.rules__column', '.product-card', '.risk-callout', '.home-stats',
  '.faq__item', '.sitemap__group', '.help-section', '.feature-card', '.prose > h2', '.prose > p',
  '.risk-list > li', '.legal__toc', '.public-footer__inner > *', '.marquee', '.cta-band',
].join(', ');

let observer;

function tag(el) {
  if (el.dataset.reveal !== undefined && el.dataset.revealBound) return;
  if (el.dataset.reveal === undefined) el.dataset.reveal = '';
  el.dataset.revealBound = '1';
  const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.matches(TARGETS) || c.dataset.reveal !== undefined) : [el];
  el.style.setProperty('--reveal-i', String(Math.max(0, siblings.indexOf(el)) % 6));
  observer.observe(el);
}

function scan(root) {
  if (root.matches?.(TARGETS) || root.dataset?.reveal !== undefined) tag(root);
  root.querySelectorAll?.(`${TARGETS}, [data-reveal]`).forEach(tag);
}

export function initReveal(root = document.body) {
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('fx');
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
  }).observe(root, { childList: true, subtree: true });
}
