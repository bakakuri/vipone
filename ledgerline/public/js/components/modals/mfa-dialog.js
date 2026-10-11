// Step-up two-factor prompt: shown when an action needs a verified session
// (aal2). Resolves true once the code is accepted.
import { authApi } from '../../api/endpoints.js';
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { errorMessage } from '../feedback/error-message.js';
import { otpInput } from '../forms/otp-input.js';
import { openModal } from './modal.js';

export function mfaDialog({ reason } = {}) {
  return new Promise((resolve) => {
    const error = h('div', { class: 'field__error', role: 'alert' });
    let busy = false;
    const submit = async (code) => {
      if (busy) return;
      busy = true;
      error.textContent = '';
      try {
        await authApi.mfaChallenge(code);
        modal.close(true);
      } catch (err) {
        error.textContent = errorMessage(err);
        otp.clear();
      } finally {
        busy = false;
      }
    };
    const otp = otpInput({ onComplete: submit });
    const modal = openModal({
      title: t('auth:mfa.challengeTitle'),
      body: [h('p', { class: 'text-muted' }, reason || t('auth:mfa.challengeText')), otp.el, error],
      onClose: (result) => resolve(result === true),
    });
    otp.focus();
  });
}

// Runs an action; if the server answers mfa_required, asks for the code and retries once.
export async function withMfa(action) {
  try {
    return await action();
  } catch (err) {
    if (err?.code === 'mfa_required' && (await mfaDialog())) return action();
    throw err;
  }
}
