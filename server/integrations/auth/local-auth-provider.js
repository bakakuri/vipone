// Local auth provider for development and automated tests (AUTH_PROVIDER=local).
// Same interface as the Supabase provider. Configuration validation forbids it
// in production. Uses the local Supabase shim tables (auth.users, local_auth.*).
//
// - scrypt password hashes, HS256 access tokens (15 min)
// - opaque refresh tokens stored hashed, rotated on every use; reuse of a
//   rotated token revokes the whole session family
// - TOTP factors encrypted at rest with a key derived from LOCAL_JWT_SECRET

import { AppError } from '../../core/errors.js';
import { decrypt, encrypt, hashPassword, randomToken, sha256Hex, verifyPassword } from '../../security/crypto.js';
import { signHs256, verifyJwt, JwtError } from '../../security/jwt.js';
import { generateSecret, otpauthUri, verifyTotp } from '../../security/totp.js';

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const ISSUER = 'ledgerline-local';
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

export function createLocalAuthProvider(config, { getSql }) {
  const secret = config.auth.localJwtSecret;

  async function issueSession(sql, user, { aal = 'aal1', familyId, sessionId, amr = ['password'] } = {}) {
    const family = familyId || crypto.randomUUID();
    const session = sessionId || crypto.randomUUID();
    const refreshToken = randomToken(32);
    await sql`
      insert into local_auth.refresh_tokens (user_id, token_hash, family_id, session_id, aal, expires_at)
      values (${user.id}, ${sha256Hex(refreshToken)}, ${family}, ${session}, ${aal}, now() + ${`${REFRESH_TTL_DAYS} days`}::interval)`;
    const accessToken = signHs256(
      { sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', iss: ISSUER, aal, session_id: session, amr },
      secret,
      { expiresInSeconds: ACCESS_TTL },
    );
    return {
      accessToken,
      refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TTL,
      aal,
      user: { id: user.id, email: user.email, emailConfirmed: Boolean(user.email_confirmed_at), metadata: user.raw_user_meta_data || {} },
    };
  }

  async function claimsOf(accessToken) {
    try {
      return await verifyJwt(accessToken, { hsSecret: secret, audience: 'authenticated', issuer: ISSUER });
    } catch (err) {
      if (err instanceof JwtError && err.code === 'expired') throw new AppError('token_expired');
      throw new AppError('unauthenticated');
    }
  }

  async function userById(sql, id) {
    const [user] = await sql`
      select id, email, email_confirmed_at, encrypted_password, raw_user_meta_data from auth.users where id = ${id}`;
    if (!user) throw new AppError('unauthenticated');
    return user;
  }

  async function createEmailToken(sql, userId, purpose) {
    const token = randomToken(24);
    await sql`
      insert into local_auth.email_tokens (user_id, purpose, token_hash, expires_at)
      values (${userId}, ${purpose}, ${sha256Hex(token)}, now() + interval '1 day')`;
    return token;
  }

  return {
    name: 'local',
    sendsOwnEmails: false,

    async signUp({ email, password, metadata }) {
      const sql = getSql();
      const [existing] = await sql`select id from auth.users where lower(email) = lower(${email})`;
      if (existing) return { userId: null, confirmationRequired: true, existing: true };
      const [user] = await sql`
        insert into auth.users (email, encrypted_password, raw_user_meta_data)
        values (${email}, ${hashPassword(password)}, ${sql.json(metadata || {})})
        returning id, email`;
      const token = await createEmailToken(sql, user.id, 'signup');
      return { userId: user.id, confirmationRequired: true, emailToken: token };
    },

    async signIn({ email, password }) {
      const sql = getSql();
      const [user] = await sql`
        select id, email, email_confirmed_at, encrypted_password, banned_until, raw_user_meta_data
        from auth.users where lower(email) = lower(${email})`;
      const ok = verifyPassword(password, user?.encrypted_password || DUMMY_HASH);
      if (!user || !ok) throw new AppError('invalid_credentials');
      if (!user.email_confirmed_at) throw new AppError('email_not_confirmed');
      await sql`update auth.users set last_sign_in_at = now() where id = ${user.id}`;
      return issueSession(sql, user);
    },

    async refresh(refreshToken) {
      const sql = getSql();
      const outcome = await sql.begin(async (tx) => {
        const [row] = await tx`
          select * from local_auth.refresh_tokens where token_hash = ${sha256Hex(refreshToken || '')} for update`;
        if (!row) return { error: 'session_expired' };
        if (row.revoked_at) {
          // A rotated token was presented again: treat the family as stolen.
          // (Committed before the error is raised.)
          await tx`update local_auth.refresh_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = ${row.family_id}`;
          return { error: 'session_expired' };
        }
        if (new Date(row.expires_at) <= new Date()) return { error: 'session_expired' };
        const user = await userById(tx, row.user_id);
        const session = await issueSession(tx, user, { aal: row.aal, familyId: row.family_id, sessionId: row.session_id });
        await tx`update local_auth.refresh_tokens set revoked_at = now() where id = ${row.id}`;
        return { session };
      });
      if (outcome.error) throw new AppError(outcome.error);
      return outcome.session;
    },

    async signOut(accessToken, refreshToken) {
      const sql = getSql();
      if (refreshToken) {
        const [row] = await sql`select family_id from local_auth.refresh_tokens where token_hash = ${sha256Hex(refreshToken)}`;
        if (row) await sql`update local_auth.refresh_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = ${row.family_id}`;
      }
    },

    async signOutOthers(accessToken) {
      const claims = await claimsOf(accessToken);
      await getSql()`
        update local_auth.refresh_tokens set revoked_at = now()
        where user_id = ${claims.sub} and session_id <> ${claims.session_id} and revoked_at is null`;
    },

    async verifyAccessToken(token) {
      const claims = await claimsOf(token);
      return { userId: claims.sub, email: claims.email, aal: claims.aal || 'aal1', sessionId: claims.session_id, exp: claims.exp, amr: claims.amr };
    },

    async verifyEmailToken({ tokenHash, type }) {
      const sql = getSql();
      return sql.begin(async (tx) => {
        const purpose = type === 'recovery' ? 'recovery' : 'signup';
        const [row] = await tx`
          select * from local_auth.email_tokens
          where token_hash = ${sha256Hex(tokenHash || '')} and purpose = ${purpose} for update`;
        if (!row || row.used_at || new Date(row.expires_at) <= new Date()) throw new AppError('link_expired');
        await tx`update local_auth.email_tokens set used_at = now() where id = ${row.id}`;
        if (purpose === 'signup') {
          await tx`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${row.user_id}`;
        }
        const user = await userById(tx, row.user_id);
        return issueSession(tx, user, { amr: [purpose === 'recovery' ? 'recovery' : 'email'] });
      });
    },

    async resendConfirmation({ email }) {
      const sql = getSql();
      const [user] = await sql`select id, email_confirmed_at from auth.users where lower(email) = lower(${email})`;
      if (!user || user.email_confirmed_at) return {};
      return { emailToken: await createEmailToken(sql, user.id, 'signup') };
    },

    async requestPasswordReset({ email }) {
      const sql = getSql();
      const [user] = await sql`select id from auth.users where lower(email) = lower(${email})`;
      if (!user) return {};
      return { emailToken: await createEmailToken(sql, user.id, 'recovery') };
    },

    async updatePassword({ accessToken, password }) {
      const claims = await claimsOf(accessToken);
      const sql = getSql();
      const user = await userById(sql, claims.sub);
      if (verifyPassword(password, user.encrypted_password)) throw new AppError('password_same');
      await sql`update auth.users set encrypted_password = ${hashPassword(password)}, updated_at = now() where id = ${claims.sub}`;
      // Sign out every other session.
      await sql`
        update local_auth.refresh_tokens set revoked_at = now()
        where user_id = ${claims.sub} and session_id <> ${claims.session_id} and revoked_at is null`;
    },

    async getUser(accessToken) {
      const claims = await claimsOf(accessToken);
      const sql = getSql();
      const user = await userById(sql, claims.sub);
      const factors = await sql`select id, status, created_at from local_auth.mfa_factors where user_id = ${claims.sub}`;
      return { id: user.id, email: user.email, factors: factors.map((f) => ({ id: f.id, status: f.status, createdAt: f.created_at })) };
    },

    mfa: {
      async enroll(accessToken) {
        const claims = await claimsOf(accessToken);
        const sql = getSql();
        const totpSecret = generateSecret();
        await sql`delete from local_auth.mfa_factors where user_id = ${claims.sub} and status = 'unverified'`;
        const [factor] = await sql`
          insert into local_auth.mfa_factors (user_id, secret_ciphertext)
          values (${claims.sub}, ${encrypt(totpSecret, secret, 'ledgerline:mfa')})
          returning id`;
        return {
          factorId: factor.id,
          secret: totpSecret,
          uri: otpauthUri({ secret: totpSecret, accountName: claims.email, issuer: config.appName }),
        };
      },
      async verify(accessToken, factorId, code) {
        const claims = await claimsOf(accessToken);
        const sql = getSql();
        return sql.begin(async (tx) => {
          const [factor] = await tx`
            select * from local_auth.mfa_factors where id = ${factorId} and user_id = ${claims.sub} for update`;
          if (!factor) throw new AppError('not_found');
          const step = verifyTotp(decrypt(factor.secret_ciphertext, secret, 'ledgerline:mfa'), code, {
            lastUsedStep: factor.last_used_step,
          });
          if (step === null) throw new AppError('mfa_invalid_code');
          await tx`update local_auth.mfa_factors set status = 'verified', last_used_step = ${step} where id = ${factor.id}`;
          const user = await userById(tx, claims.sub);
          return issueSession(tx, user, { aal: 'aal2', sessionId: claims.session_id, amr: ['password', 'totp'] });
        });
      },
      async unenroll(accessToken, factorId) {
        const claims = await claimsOf(accessToken);
        await getSql()`delete from local_auth.mfa_factors where id = ${factorId} and user_id = ${claims.sub}`;
      },
    },
  };
}
