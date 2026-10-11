// Headers condense into floating glass once the page scrolls, and a thin
// progress line shows how far down a long public page you are.

export function initScrollState() {
  const root = document.documentElement;
  let ticking = false;
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  if (document.body.classList.contains('area-public')) document.body.append(progress);

  function update() {
    ticking = false;
    const y = window.scrollY;
    root.classList.toggle('is-scrolled', y > 12);
    const max = root.scrollHeight - window.innerHeight;
    progress.style.setProperty('--progress', String(max > 0 ? Math.min(1, y / max) : 0));
  }
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}
