-- Ledgerline — Georgian (ka) as a fourth interface language.
--
-- Users can choose Georgian for the interface and emails. Texts entered by
-- staff (products, announcements, deposit instructions) may have a Georgian
-- version; when it is missing the English text is shown, so
-- app.has_all_locales() keeps requiring en, ru and ar only.

alter table app.profiles drop constraint if exists profiles_locale_check;
alter table app.profiles add constraint profiles_locale_check check (locale in ('en', 'ru', 'ar', 'ka'));

alter table app.email_outbox drop constraint if exists email_outbox_locale_check;
alter table app.email_outbox add constraint email_outbox_locale_check check (locale in ('en', 'ru', 'ar', 'ka'));

alter table app.legal_documents drop constraint if exists legal_documents_locale_check;
alter table app.legal_documents add constraint legal_documents_locale_check check (locale in ('en', 'ru', 'ar', 'ka'));

-- Georgian versions of the current legal documents (the English text prevails).
insert into app.legal_documents (doc_type, version, locale, title, path, is_current, is_prevailing)
select d.doc_type, d.version, 'ka', k.title, d.path, true, false
from app.legal_documents d
join (values
  ('terms', 'მომსახურების პირობები'),
  ('privacy', 'კონფიდენციალურობის პოლიტიკა'),
  ('cookies', 'ქუქი-ფაილების პოლიტიკა'),
  ('risk', 'რისკების შესახებ ინფორმაცია')
) as k (doc_type, title) on k.doc_type = d.doc_type
where d.locale = 'en' and d.is_current
on conflict do nothing;

-- Offer Georgian in the language switcher (unless staff already chose the list).
update app.system_settings
set value = value || '["ka"]'::jsonb
where key = 'languages.enabled' and value = '["en", "ru", "ar"]'::jsonb;
