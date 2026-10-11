// Renders a transactional email from locales/<lng>/emails.json.
// Every parameter is HTML-escaped; links must be absolute app URLs.

import { getConfig } from '../../config/env.js';
import { interpolate, loadNamespace } from '../../utils/server-i18n.js';

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderEmail(template, locale, params = {}) {
  const config = getConfig();
  const strings = loadNamespace(locale, 'emails');
  const fallback = loadNamespace('en', 'emails');
  const t = strings.templates?.[template] || fallback.templates?.[template];
  if (!t) throw new Error(`unknown email template ${template}`);
  const common = strings.common || fallback.common;
  const vars = { appName: config.appName, ...params };
  const escaped = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const subject = interpolate(t.subject, vars);
  const paragraphs = (t.body || []).map((p) => interpolate(p, escaped));
  const actionUrl = params.actionUrl && String(params.actionUrl).startsWith(config.appUrl) ? params.actionUrl : null;
  const actionLabel = t.action ? interpolate(t.action, escaped) : null;
  const footer = interpolate(common.footer, escaped);

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#eef2f0;font-family:'IBM Plex Sans','IBM Plex Sans Arabic',Arial,sans-serif;color:#14201c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #d9e1dd">
<tr><td style="font-size:18px;font-weight:600;padding-bottom:16px">${escapeHtml(config.appName)}</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${interpolate(t.heading || t.subject, escaped)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px">${p}</td></tr>`).join('')}
${actionUrl && actionLabel ? `<tr><td style="padding:12px 0 20px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1f6f63;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${actionLabel}</a></td></tr>` : ''}
<tr><td style="font-size:12px;line-height:1.5;color:#56635e;border-top:1px solid #d9e1dd;padding-top:16px">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [interpolate(t.heading || t.subject, vars), '', ...(t.body || []).map((p) => interpolate(p, vars)), actionUrl ? `\n${actionUrl}` : '', '', interpolate(common.footer, vars)].join('\n');
  return { subject, html, text };
}
