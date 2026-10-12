// Typed-ish wrappers for every API area. Pages import from here.
import { api } from './api-client.js';

export const publicApi = {
  config: () => api.get('/public/config'),
  assets: () => api.get('/public/assets'),
  products: () => api.get('/public/products'),
  product: (slug) => api.get(`/public/products/${encodeURIComponent(slug)}`),
  legal: () => api.get('/public/legal'),
  stats: () => api.get('/public/stats'),
};

export const authApi = {
  session: () => api.get('/auth/session'),
  register: (body) => api.post('/auth/register', body),
  login: (body) => api.post('/auth/login', body),
  logout: () => api.post('/auth/logout', {}),
  verifyEmail: (body) => api.post('/auth/verify-email', body),
  resendConfirmation: (email) => api.post('/auth/resend-confirmation', { email }),
  forgotPassword: (email) => api.post('/auth/password/forgot', { email }),
  resetPassword: (body) => api.post('/auth/password/reset', body),
  changePassword: (body) => api.post('/auth/password/change', body),
  mfaEnroll: () => api.post('/auth/mfa/enroll', {}),
  mfaVerify: (factorId, code) => api.post('/auth/mfa/verify', { factorId, code }),
  mfaChallenge: (code) => api.post('/auth/mfa/challenge', { code }),
  mfaDisable: (code) => api.post('/auth/mfa/disable', { code }),
};

export const profileApi = {
  get: () => api.get('/profile'),
  update: (body) => api.patch('/profile', body),
  onboarding: (body) => api.patch('/profile/onboarding', body),
  securityEvents: () => api.get('/profile/security-events'),
  startKyc: () => api.post('/profile/kyc/start', {}),
};

export const dashboardApi = {
  summary: () => api.get('/dashboard'),
  history: (asset, days = 30) => api.get('/dashboard/history', { asset, days }),
};

export const depositsApi = {
  list: (query) => api.get('/deposits', query),
  get: (id) => api.get(`/deposits/${id}`),
  address: (network) => api.get('/deposits/address', { network }),
  request: (body, idempotencyKey) => api.post('/deposits/requests', body, { idempotencyKey }),
  methods: () => api.get('/deposits/methods'),
  reportManual: (body, idempotencyKey) => api.post('/deposits/manual', body, { idempotencyKey }),
};

export const walletsApi = {
  list: () => api.get('/wallets'),
  history: () => api.get('/wallets/history'),
  add: (body) => api.post('/wallets', body),
  confirm: (id, code) => api.post(`/wallets/${id}/confirm`, { code }),
  resendCode: (id) => api.post(`/wallets/${id}/resend-code`, {}),
  setDefault: (id) => api.post(`/wallets/${id}/default`, {}),
  remove: (id) => api.del(`/wallets/${id}`),
};

export const withdrawalsApi = {
  list: (query) => api.get('/withdrawals', query),
  get: (id) => api.get(`/withdrawals/${id}`),
  quote: (body) => api.post('/withdrawals/quote', body),
  create: (quoteId, idempotencyKey) => api.post('/withdrawals', { quoteId }, { idempotencyKey }),
  cancel: (id) => api.post(`/withdrawals/${id}/cancel`, {}),
};

export const investmentsApi = {
  products: () => api.get('/investments/products'),
  positions: (status) => api.get('/investments/positions', { status }),
  position: (id) => api.get(`/investments/positions/${id}`),
  open: (body, idempotencyKey) => api.post('/investments/positions', body, { idempotencyKey }),
  closeEarly: (id, idempotencyKey) => api.post(`/investments/positions/${id}/close`, {}, { idempotencyKey }),
};

export const earningsApi = {
  list: (query) => api.get('/earnings', query),
  summary: () => api.get('/earnings/summary'),
};

export const transactionsApi = {
  list: (query) => api.get('/transactions', query),
  get: (id) => api.get(`/transactions/${id}`),
  exportCsv: (query) => api.download('/transactions/export.csv', query),
};

export const referralsApi = {
  overview: () => api.get('/referrals'),
  rewards: (query) => api.get('/referrals/rewards', query),
};

export const notificationsApi = {
  list: (query) => api.get('/notifications', query),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.post(`/notifications/${id}/read`, {}),
  markAllRead: () => api.post('/notifications/read-all', {}),
};

export const supportApi = {
  tickets: () => api.get('/support/tickets'),
  create: (body) => api.post('/support/tickets', body),
  ticket: (id) => api.get(`/support/tickets/${id}`),
  reply: (id, body) => api.post(`/support/tickets/${id}/messages`, { body }),
};

export const liveApi = {
  config: () => api.get('/live/config'),
  token: () => api.get('/live/token'),
};
