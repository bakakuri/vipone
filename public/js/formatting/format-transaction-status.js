// Status -> translated label + visual tone. Tones carry meaning together with
// the text label (never colour alone).
import { t } from '../i18n/i18n.js';

const TONES = {
  positive: ['credited', 'completed', 'confirmed', 'matured', 'clear', 'executed', 'ok', 'posted', 'active', 'approved_kyc', 'resolved', 'enabled'],
  pending: ['pending', 'awaiting_payment', 'detected', 'confirming', 'under_review', 'processing', 'awaiting_settlement', 'created', 'pending_confirmation', 'open', 'awaiting_user', 'draft', 'running', 'queued'],
  negative: ['failed', 'rejected', 'cancelled', 'expired', 'frozen', 'mismatch', 'restricted', 'closed', 'flagged', 'disabled'],
  info: ['approved', 'closed_early', 'paused', 'none', 'dismissed', 'succeeded'],
};

export function statusTone(status) {
  for (const [tone, list] of Object.entries(TONES)) if (list.includes(status)) return tone;
  return 'neutral';
}

export function statusLabel(status) {
  return t(`common:status.${status}`);
}
