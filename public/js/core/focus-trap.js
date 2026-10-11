// Keeps keyboard focus inside dialogs and drawers while they are open.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container, { onEscape } = {}) {
  const previous = document.activeElement;
  const handler = (e) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler);
  requestAnimationFrame(() => {
    const autofocus = container.querySelector('[autofocus]') || container.querySelector(FOCUSABLE);
    autofocus?.focus();
  });
  return () => {
    document.removeEventListener('keydown', handler);
    if (previous && typeof previous.focus === 'function') previous.focus();
  };
}
