// Current session state for the page. The browser never handles tokens; it
// only knows what /auth/session returns.
import { authApi } from '../api/endpoints.js';
import { safeRedirect } from '../core/url.js';

let session = null;

export function getSession() {
  return session;
}

export function currentUser() {
  return session?.authenticated ? session.user : null;
}

export function can(permission) {
  return Boolean(session?.user?.permissions?.includes(permission));
}

export async function loadSession() {
  try {
    session = await authApi.session();
  } catch {
    session = { authenticated: false };
  }
  return session;
}

export function setSession(next) {
  session = next;
}

export function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login?next=${next}`);
}

export function redirectAfterLogin() {
  const params = new URLSearchParams(location.search);
  const user = currentUser();
  const fallback = user?.roles?.length ? '/admin' : '/dashboard';
  location.replace(safeRedirect(params.get('next'), fallback));
}

export async function signOut() {
  try {
    await authApi.logout();
  } finally {
    session = { authenticated: false };
    location.replace('/login');
  }
}
