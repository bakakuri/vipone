// Interactive onboarding: spotlight + card, Next/Back/Skip/Continue later.
// Progress is saved to the profile so the tour resumes on another device.
import { profileApi } from '../../api/endpoints.js';
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { TOUR_STEPS } from './tour-steps.js';

function visibleTarget(selector) {
  if (!selector) return null;
  const el = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
  return el || null;
}

export function startTour({ step = 0, onFinish } = {}) {
  let index = Math.min(step, TOUR_STEPS.length - 1);
  const spotlight = h('div', { class: 'tour-spotlight' });
  const title = h('h2', { class: 'tour-card__title', id: 'tour-title' });
  const text = h('p', { class: 'tour-card__text' });
  const counter = h('span', { class: 'tour-card__step' });
  const progress = h('div', { class: 'tour-card__progress', 'aria-hidden': 'true' }, TOUR_STEPS.map(() => h('span')));
  const back = h('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, t('onboarding:back'));
  const next = h('button', { class: 'btn btn--sm btn--primary', type: 'button' });
  const later = h('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, t('onboarding:later'));
  const skip = h('button', { class: 'link-button text-small', type: 'button' }, t('onboarding:skip'));
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title', 'aria-live': 'polite' },
    h('div', { class: 'cluster cluster--between' }, counter, skip), title, text, progress,
    h('div', { class: 'tour-card__actions' }, back, later, h('span', { class: 'spacer' }), next));
  document.body.append(spotlight, card);

  const save = (data) => profileApi.onboarding(data).catch(() => {});

  function position() {
    const step = TOUR_STEPS[index];
    const target = visibleTarget(step.target);
    if (target) {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const r = target.getBoundingClientRect();
      spotlight.classList.remove('is-centered');
      Object.entries({ top: `${r.top - 6}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` }).forEach(([k, v]) => spotlight.style.setProperty(k, v));
      const cardW = card.offsetWidth || 340;
      const below = r.bottom + 16 + card.offsetHeight < window.innerHeight;
      const left = Math.min(Math.max(16, r.left), window.innerWidth - cardW - 16);
      card.style.setProperty('left', `${left}px`);
      card.style.setProperty('top', `${below ? r.bottom + 16 : Math.max(16, r.top - card.offsetHeight - 16)}px`);
    } else {
      spotlight.classList.add('is-centered');
      Object.entries({ top: '50%', left: '50%' }).forEach(([k, v]) => spotlight.style.setProperty(k, v));
      card.style.setProperty('left', `${Math.max(16, (window.innerWidth - card.offsetWidth) / 2)}px`);
      card.style.setProperty('top', `${Math.max(16, (window.innerHeight - card.offsetHeight) / 2)}px`);
    }
  }

  function render() {
    const step = TOUR_STEPS[index];
    counter.textContent = t('onboarding:stepOf', { current: index + 1, total: TOUR_STEPS.length });
    title.textContent = t(`onboarding:steps.${step.id}.title`);
    text.textContent = t(`onboarding:steps.${step.id}.text`);
    back.disabled = index === 0;
    next.textContent = index === TOUR_STEPS.length - 1 ? t('onboarding:finish') : t('onboarding:next');
    [...progress.children].forEach((s, i) => s.classList.toggle('is-active', i <= index));
    requestAnimationFrame(position);
  }

  function end(data) {
    spotlight.remove();
    card.remove();
    window.removeEventListener('resize', position);
    document.removeEventListener('keydown', onKey);
    save(data);
    onFinish?.(data);
  }

  function onKey(e) {
    if (e.key === 'Escape') end({ step: index, dismissed: false });
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const forward = (e.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
      if (forward) next.click();
      else if (index > 0) back.click();
    }
  }

  back.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    render();
  });
  next.addEventListener('click', () => {
    if (index === TOUR_STEPS.length - 1) return end({ completed: true, step: index });
    index += 1;
    save({ step: index });
    render();
  });
  later.addEventListener('click', () => end({ step: index }));
  skip.addEventListener('click', () => end({ dismissed: true, step: index }));
  window.addEventListener('resize', position);
  document.addEventListener('keydown', onKey);
  render();
  next.focus();
}
