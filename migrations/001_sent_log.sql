-- 001_sent_log.sql
--
-- Fixes duplicate reminders.
--
-- The server kept "I already sent this one" in a Map in process memory. Render's
-- free plan spins the instance down when it goes idle, and the restart cleared the
-- Map -- so the next cron tick inside the same 35-minute window re-sent a reminder
-- the user had already read. This moves that log into the database.
--
-- Run once in the Supabase SQL editor: paste THIS FILE'S CONTENTS, not its path.
-- Safe to re-run: every statement is guarded.
--
-- The token check matches the existing coach_get / coach_put exactly: the caller's
-- token is sha256-hashed and looked up in public.coach_secret. Keep these three in
-- step if that scheme ever changes.

create table if not exists public.coach_sent (
  key  text primary key,              -- '<kind>:<YYYY-MM-DD>', e.g. 'train:2026-10-01'
  date text not null,                 -- the local date the reminder belongs to
  at   timestamptz not null default now()
);

-- Reached only through the two security-definer functions below, never directly.
alter table public.coach_sent enable row level security;

-- Has this reminder already gone out?
create or replace function public.coach_sent_has(p_token text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.coach_secret
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'forbidden';
  end if;
  return exists (select 1 from public.coach_sent where key = p_key);
end
$$;

-- Claim it. Called BEFORE the push is sent, so a second cron tick arriving while
-- the first is still working finds it taken.
--
-- Returns true when this call is the one that claimed it and false when it was
-- already there, which makes the claim atomic on its own: the primary key plus
-- `on conflict do nothing` decides the winner inside one statement, with no gap
-- between checking and claiming. The server currently ignores the return value
-- and calls coach_sent_has first; this is here so it can be tightened later
-- without another migration.
create or replace function public.coach_sent_mark(p_token text, p_key text, p_date text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare claimed boolean;
begin
  if not exists (
    select 1 from public.coach_secret
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.coach_sent (key, date) values (p_key, p_date)
    on conflict (key) do nothing;
  get diagnostics claimed = row_count;

  -- keep the table from growing without bound; a week is far more history than
  -- the 35-minute dedupe window needs
  delete from public.coach_sent where at < now() - interval '7 days';

  return claimed;
end
$$;

revoke all on function public.coach_sent_has(text, text) from public;
revoke all on function public.coach_sent_mark(text, text, text) from public;
grant execute on function public.coach_sent_has(text, text) to anon, authenticated;
grant execute on function public.coach_sent_mark(text, text, text) to anon, authenticated;

-- Check it worked: should return false, then true, then true.
--   select public.coach_sent_has('<SYNC_TOKEN>', 'test:2026-01-01');
--   select public.coach_sent_mark('<SYNC_TOKEN>', 'test:2026-01-01', '2026-01-01');
--   select public.coach_sent_has('<SYNC_TOKEN>', 'test:2026-01-01');
--   delete from public.coach_sent where key = 'test:2026-01-01';
