// Dates and times in the user's language and time zone. Stored values are UTC.
import { formatLocale, t } from '../i18n/i18n.js';

export function formatDate(value, { time = false } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  return new Intl.DateTimeFormat(formatLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

export function formatDateTime(value) {
  return formatDate(value, { time: true });
}

export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return '—';
  const diff = (new Date(value).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(formatLocale(), { numeric: 'auto' });
  if (abs < 45) return t('common:time.justNow');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}

export function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t('common:duration.daysHours', { days, hours });
  if (hours > 0) return t('common:duration.hoursMinutes', { hours, minutes });
  return t('common:duration.minutes', { minutes });
}

// "4:05" — for short countdowns such as a quote's validity.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Calendar days stored as "YYYY-MM-DD" (UTC days): "Oct 11".
export function formatDay(day) {
  if (!day) return '—';
  return new Intl.DateTimeFormat(formatLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
