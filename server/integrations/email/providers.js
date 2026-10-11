// Outbound email transports. All share: send({ to, subject, html, text }) -> { id }

import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

// Development / tests: nothing leaves the machine. Messages are kept in memory
// so tests can read confirmation links.
export function createLogEmailProvider() {
  const outbox = [];
  return {
    name: 'log',
    outbox,
    async send(message) {
      const id = `log-${outbox.length + 1}`;
      outbox.push({ id, ...message, sentAt: new Date().toISOString() });
      logger.info('email (log provider)', { to: message.to, subject: message.subject });
      return { id };
    },
  };
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new AppError('service_unavailable', { cause: err });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError('email_send_failed', { status: 502, details: { status: res.status } });
  return data;
}

// https://resend.com/docs/api-reference/emails/send-email
export function createResendProvider({ apiKey, from }) {
  return {
    name: 'resend',
    async send({ to, subject, html, text }) {
      const data = await postJson('https://api.resend.com/emails', { authorization: `Bearer ${apiKey}` }, { from, to: [to], subject, html, text });
      return { id: data.id };
    },
  };
}

// https://postmarkapp.com/developer/api/email-api
export function createPostmarkProvider({ token, from }) {
  return {
    name: 'postmark',
    async send({ to, subject, html, text }) {
      const data = await postJson('https://api.postmarkapp.com/email', { 'x-postmark-server-token': token }, {
        From: from, To: to, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: 'outbound',
      });
      return { id: data.MessageID };
    },
  };
}
