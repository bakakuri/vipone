// Application-wide event bus (locale/theme changes, live updates, auth).
const target = new EventTarget();

export function emit(type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function listen(type, handler) {
  const fn = (e) => handler(e.detail);
  target.addEventListener(type, fn);
  return () => target.removeEventListener(type, fn);
}
