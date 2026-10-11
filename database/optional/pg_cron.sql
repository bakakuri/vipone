-- Ledgerline — optional: run the scheduled jobs from Supabase (pg_cron + pg_net)
-- instead of Vercel Cron. Use it on the Vercel Hobby plan (cron jobs at most
-- once a day there) or if you prefer the database to drive the schedule.
--
-- 1. Supabase → Database → Extensions: enable pg_cron and pg_net
--    (this file also tries to enable them).
-- 2. Store the site URL and the CRON_SECRET in Supabase Vault — once, with
--    your values (the secret is encrypted at rest and never appears in this file):
--      select vault.create_secret('https://your-domain.com', 'ledgerline_app_url');
--      select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'ledgerline_cron_secret');
-- 3. Run this file in the SQL editor.
-- 4. Remove the "crons" block from vercel.json, or keep it as a daily backup
--    (jobs are idempotent, so overlapping runs are safe).
--
-- Check:   select * from cron.job_run_details order by start_time desc limit 20;
--          select id, status_code, content from net._http_response order by created desc limit 20;
-- Stop:    select cron.unschedule('ledgerline-frequent'); select cron.unschedule('ledgerline-daily');

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function app.call_ledgerline_jobs(p_group text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_group not in ('frequent', 'daily') then
    raise exception 'unknown job group %', p_group;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ledgerline_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ledgerline_cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'Store ledgerline_app_url and ledgerline_cron_secret in Supabase Vault first (see the top of pg_cron.sql)';
  end if;
  -- Asynchronous HTTP request; the response lands in net._http_response.
  return net.http_get(
    url := rtrim(v_url, '/') || '/api/v1/jobs/group/' || p_group,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function app.call_ledgerline_jobs(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function app.call_ledgerline_jobs(text) from anon, authenticated';
  end if;
end;
$$;

-- Scheduling under an existing name replaces that job.
select cron.schedule('ledgerline-frequent', '*/5 * * * *', $job$select app.call_ledgerline_jobs('frequent')$job$);
select cron.schedule('ledgerline-daily', '0 3 * * *', $job$select app.call_ledgerline_jobs('daily')$job$);
