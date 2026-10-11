// Auth provider selection. Both providers implement the same interface:
//   signUp, signIn, refresh, signOut, verifyAccessToken, verifyEmailToken,
//   resendConfirmation, requestPasswordReset, updatePassword, getUser,
//   mfa.{enroll, verify, unenroll}, sendsOwnEmails

import { getConfig } from '../../config/env.js';
import { getSql } from '../../db/client.js';
import { createLocalAuthProvider } from './local-auth-provider.js';
import { createSupabaseAuthProvider } from './supabase-auth-provider.js';

let provider;

export function getAuthProvider() {
  if (!provider) {
    const config = getConfig();
    provider =
      config.auth.provider === 'supabase'
        ? createSupabaseAuthProvider(config)
        : createLocalAuthProvider(config, { getSql });
  }
  return provider;
}

export function setAuthProvider(p) {
  provider = p;
}
