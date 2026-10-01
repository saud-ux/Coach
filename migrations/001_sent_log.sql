-- 001_sent_log.sql
--
-- Fixes duplicate reminders.
--
-- The server kept "I already sent this one" in a Map in process memory. Render's
-- free plan spins the instance down when it goes idle, and the restart cleared the
-- Map -- so the next cron tick inside the same 35-minute window re-sent a reminder
-- the user had already read. This moves that log into the database.
--
-- Run once in the Supabase SQL editor. Safe to re-run: every statement is guarded.

create table if not exists public.coach_sent (
  key  text primary key,              -- '<kind>:<YYYY-MM-DD>', e.g. 'train:2026-10-01'
  date text not null,                 -- the local date the reminder belongs to
  at   timestamptz not null default now()
);

-- The table is reached only through the two functions below, which check the shared
-- token the server already uses for coach_get / coach_put. No direct table access.
alter table public.coach_sent enable row level security;

-- Has this reminder already gone out?
create or replace function public.coach_sent_has(p_token text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or p_token <> current_setting('app.sync_token', true) then
    raise exception 'bad token';
  end if;
  return exists (select 1 from public.coach_sent where key = p_key);
end;
$$;

-- Claim it. Called before the push is sent, so a second tick arriving while the
-- first is still working finds it taken. Also trims anything older than 7 days, so
-- the table cannot grow without bound.
create or replace function public.coach_sent_mark(p_token text, p_key text, p_date text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or p_token <> current_setting('app.sync_token', true) then
    raise exception 'bad token';
  end if;
  insert into public.coach_sent (key, date) values (p_key, p_date)
    on conflict (key) do nothing;
  delete from public.coach_sent where at < now() - interval '7 days';
end;
$$;

revoke all on function public.coach_sent_has(text, text) from public;
revoke all on function public.coach_sent_mark(text, text, text) from public;
grant execute on function public.coach_sent_has(text, text) to anon, authenticated;
grant execute on function public.coach_sent_mark(text, text, text) to anon, authenticated;

-- NOTE ON THE TOKEN CHECK
-- The two functions above compare p_token against the `app.sync_token` database
-- setting. If your existing coach_get / coach_put check the token a different way
-- -- a literal, a settings table, a column -- change these two to match, because
-- otherwise every call raises 'bad token', the server logs
--   sent-log read failed, falling back to memory
-- and you are back to the in-memory behaviour this migration is meant to replace.
--
-- To set it once for the project:
--   alter database postgres set app.sync_token = '<the same value as SYNC_TOKEN>';
-- then reconnect so the setting takes effect.
