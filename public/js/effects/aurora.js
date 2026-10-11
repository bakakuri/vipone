// Aurora background. The light layers are static markup in every page (so
// they are there on first paint); this module adds the particle network: a
// slow constellation of points that link to their neighbours and to the
// pointer. It pauses in background tabs and is skipped for reduced motion
// or data-saver connections.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function particleColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--particle-rgb').trim() || '190, 205, 255';
}

function startParticles(canvas, { density = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let width = 0;
  let height = 0;
  let points = [];
  let raf = 0;
  let rgb = particleColor();
  const pointer = { x: -9999, y: -9999 };
  const LINK = 130;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, (width * height) / 15000) * density);
    points = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.5 + 0.4,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    for (const p of points) {
      // Gentle attraction to the pointer, then drift.
      const dx = pointer.x - p.x;
      const dy = pointer.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 220 * 220) {
        p.vx += dx * 0.00002;
        p.vy += dy * 0.00002;
      }
      p.vx = Math.max(-0.4, Math.min(0.4, p.vx));
      p.vy = Math.max(-0.4, Math.min(0.4, p.vy));
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;
      p.phase += 0.015;
      ctx.fillStyle = `rgba(${rgb}, ${0.35 + Math.sin(p.phase) * 0.25})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 0.6;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j += 1) {
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < LINK) {
          ctx.strokeStyle = `rgba(${rgb}, ${(1 - d / LINK) * 0.14})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const pd = Math.hypot(a.x - pointer.x, a.y - pointer.y);
      if (pd < LINK * 1.4) {
        ctx.strokeStyle = `rgba(${rgb}, ${(1 - pd / (LINK * 1.4)) * 0.3})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.stroke();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  start();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 200);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.x = -9999;
    pointer.y = -9999;
  });
  // Re-read the colour when the theme changes.
  new MutationObserver(() => {
    rgb = particleColor();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? stop() : start()));
}

export function mountAurora({ density = 1 } = {}) {
  let root = document.querySelector('.aurora');
  if (!root) {
    // Pages created before the static layer existed.
    root = document.createElement('div');
    root.className = 'aurora';
    root.setAttribute('aria-hidden', 'true');
    for (const cls of ['aurora__blob aurora__blob--1', 'aurora__blob aurora__blob--2', 'aurora__blob aurora__blob--3', 'aurora__grid', 'aurora__grain']) {
      const span = document.createElement('span');
      span.className = cls;
      root.append(span);
    }
    const c = document.createElement('canvas');
    c.className = 'aurora__particles';
    root.append(c);
    document.body.prepend(root);
  }
  const canvas = root.querySelector('.aurora__particles');
  if (!canvas || canvas.dataset.running) return;
  if (reduceMotion.matches || navigator.connection?.saveData) return;
  canvas.dataset.running = 'true';
  startParticles(canvas, { density });
}
