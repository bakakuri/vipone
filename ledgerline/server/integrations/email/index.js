import { getConfig } from '../../config/env.js';
import { createLogEmailProvider, createPostmarkProvider, createResendProvider } from './providers.js';

let provider;

export function getEmailProvider() {
  if (!provider) {
    const { email } = getConfig();
    if (email.provider === 'resend') provider = createResendProvider({ apiKey: email.resendApiKey, from: email.from });
    else if (email.provider === 'postmark') provider = createPostmarkProvider({ token: email.postmarkToken, from: email.from });
    else provider = createLogEmailProvider();
  }
  return provider;
}

export function setEmailProvider(p) {
  provider = p;
}
