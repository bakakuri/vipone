import { h, icon } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { errorMessage } from './error-message.js';

export function errorState(error, { onRetry } = {}) {
  return h('div', { class: 'empty-state error-state', role: 'alert' },
    h('div', { class: 'empty-state__icon' }, icon('alert')),
    h('div', { class: 'empty-state__title' }, t('errors:loadFailedTitle')),
    h('p', {}, errorMessage(error)),
    error?.requestId ? h('p', { class: 'text-xs text-subtle' }, t('errors:reference', { id: error.requestId })) : null,
    onRetry ? h('button', { class: 'btn btn--sm', type: 'button', on: { click: onRetry } }, icon('refresh', { size: 'sm' }), t('common:actions.retry')) : null,
  );
}
