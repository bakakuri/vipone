// Admin API wrappers.
import { api } from './api-client.js';

export const adminApi = {
  dashboard: () => api.get('/admin/dashboard'),
  health: () => api.get('/admin/system/health'),
  users: (query) => api.get('/admin/users', query),
  user: (id) => api.get(`/admin/users/${id}`),
  setUserStatus: (id, body) => api.post(`/admin/users/${id}/status`, body),
  decideKyc: (id, body) => api.post(`/admin/users/${id}/kyc`, body),
  requestRole: (id, body) => api.post(`/admin/users/${id}/roles`, body),
  riskFlags: (query) => api.get('/admin/users/risk-flags', query),
  resolveFlag: (id, body) => api.post(`/admin/users/risk-flags/${id}/resolve`, body),

  deposits: (query) => api.get('/admin/deposits', query),
  deposit: (id) => api.get(`/admin/deposits/${id}`),
  reviewDeposit: (id, body) => api.post(`/admin/deposits/${id}/review`, body),
  returnDeposit: (id, body) => api.post(`/admin/deposits/${id}/return`, body),
  approveManualDeposit: (id, body) => api.post(`/admin/deposits/${id}/approve-manual`, body),
  depositMethods: () => api.get('/admin/deposits/methods'),
  createDepositMethod: (body) => api.post('/admin/deposits/methods', body),
  updateDepositMethod: (id, body) => api.patch(`/admin/deposits/methods/${id}`, body),
  removeDepositMethod: (id) => api.del(`/admin/deposits/methods/${id}`),
  addressPool: () => api.get('/admin/deposits/address-pool'),
  importAddresses: (body) => api.post('/admin/deposits/address-pool/import', body),

  withdrawals: (query) => api.get('/admin/withdrawals', query),
  withdrawal: (id) => api.get(`/admin/withdrawals/${id}`),
  withdrawalAction: (id, action, body = {}) => api.post(`/admin/withdrawals/${id}/${action}`, body),

  products: () => api.get('/admin/investments/products'),
  createProduct: (body) => api.post('/admin/investments/products', body),
  updateProduct: (id, body) => api.patch(`/admin/investments/products/${id}`, body),
  productStatus: (id, status) => api.post(`/admin/investments/products/${id}/status`, { status }),
  results: (productId) => api.get('/admin/investments/results', { productId }),
  createResult: (body) => api.post('/admin/investments/results', body),
  previewResult: (id) => api.get(`/admin/investments/results/${id}/preview`),
  resultAction: (id, action, body = {}) => api.post(`/admin/investments/results/${id}/${action}`, body),

  referralRewards: (query) => api.get('/admin/referrals/rewards', query),
  referralRelationships: (query) => api.get('/admin/referrals/relationships', query),
  referralSuspicious: () => api.get('/admin/referrals/suspicious'),
  reviewReward: (id, body) => api.post(`/admin/referrals/rewards/${id}/review`, body),

  settings: () => api.get('/admin/settings'),
  settingHistory: (key) => api.get(`/admin/settings/${key}/history`),
  changeSetting: (key, value, reason) => api.post(`/admin/settings/${key}`, { value, reason }),
  feeRules: () => api.get('/admin/settings/fee-rules'),
  requestFeeRule: (body) => api.post('/admin/settings/fee-rules', body),
  requestAdjustment: (body) => api.post('/admin/settings/adjustments', body),

  approvals: (query) => api.get('/admin/approvals', query),
  approve: (id, note) => api.post(`/admin/approvals/${id}/approve`, { note }),
  reject: (id, note) => api.post(`/admin/approvals/${id}/reject`, { note }),

  treasury: () => api.get('/admin/treasury'),
  reconciliations: (asset) => api.get('/admin/treasury/reconciliations', { asset }),
  reconcile: (body) => api.post('/admin/treasury/reconcile', body),
  transfer: (body, idempotencyKey) => api.post('/admin/treasury/transfer', body, { idempotencyKey }),
  capital: (body, idempotencyKey) => api.post('/admin/treasury/capital', body, { idempotencyKey }),
  integrity: () => api.get('/admin/treasury/integrity'),

  audit: (query) => api.get('/admin/audit', query),
  tickets: (status) => api.get('/admin/support', { status }),
  ticket: (id) => api.get(`/admin/support/${id}`),
  replyTicket: (id, body) => api.post(`/admin/support/${id}/messages`, { body }),
  ticketStatus: (id, status) => api.post(`/admin/support/${id}/status`, { status }),
  announcements: () => api.get('/admin/announcements'),
  announce: (body) => api.post('/admin/announcements', body),

  simulateDeposit: (body) => api.post('/admin/demo/simulate-deposit', body),
  advanceConfirmations: (body) => api.post('/admin/demo/advance-confirmations', body),
  confirmWithdrawal: (body) => api.post('/admin/demo/confirm-withdrawal', body),
};
