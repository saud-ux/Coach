-- 002_health.sql
--
-- Sleep nights and watch workouts, sent by the iOS Shortcut to POST /api/health.
--
-- Garmin -> Apple Health -> Shortcut -> server -> these two tables. The app reads
-- them back with GET /api/health and keeps a copy in state.health so the sleep card
-- still has something to show offline. The server never writes the main state row:
-- that row belongs to the app, and two writers on one JSON blob is how edits get lost.
--
-- Run once in the Supabase SQL editor: paste THIS FILE'S CONTENTS, not its path.
-- Safe to re-run: every statement is guarded.
--
-- The token check matches coach_get / coach_put / coach_sent_* exactly: the caller's
-- token is sha256-hashed and looked up in public.coach_secret.

create table if not exists public.coach_health_night (
  night_of     date primary key,          -- the evening the night started on
  in_bed_start timestamptz,
  in_bed_end   timestamptz,
  asleep_min   integer,
  deep_min     integer,
  rem_min      integer,
  awake_min    integer,
  resting_hr   integer,
  at           timestamptz not null default now()
);

create table if not exists public.coach_health_workout (
  id           text primary key,          -- derived from the start time, see server.js
  start_at     timestamptz not null unique,
  end_at       timestamptz,
  type         text,
  duration_min numeric,
  distance_km  numeric,
  avg_hr       integer,
  max_hr       integer,
  zones        jsonb,                     -- {z1..z5: minutes}
  confirmed    boolean not null default false,
  at           timestamptz not null default now()
);

-- Reached only through the security-definer functions below, never directly.
alter table public.coach_health_night   enable row level security;
alter table public.coach_health_workout enable row level security;

create or replace function public.coach_health_check(p_token text)
returns void
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
end
$$;

-- Store what the Shortcut sent. The server has already validated, clamped and
-- computed zones; this only upserts.
--
-- A night is replaced whole: the Shortcut may run twice in one morning, and the
-- second run has the more complete night. A workout keeps its `confirmed` flag on
-- a re-send, so running the Shortcut again never brings back a card the referee
-- already answered.
create or replace function public.coach_health_add(p_token text, p_nights jsonb, p_workouts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare n_count int := 0; w_count int := 0;
begin
  perform public.coach_health_check(p_token);

  insert into public.coach_health_night as h
    (night_of, in_bed_start, in_bed_end, asleep_min, deep_min, rem_min, awake_min, resting_hr, at)
  select (x->>'night_of')::date,
         (x->>'in_bed_start')::timestamptz, (x->>'in_bed_end')::timestamptz,
         (x->>'asleep_min')::int, (x->>'deep_min')::int, (x->>'rem_min')::int,
         (x->>'awake_min')::int, (x->>'resting_hr')::int, now()
  from jsonb_array_elements(coalesce(p_nights, '[]'::jsonb)) x
  where x ? 'night_of'
  on conflict (night_of) do update set
    in_bed_start = excluded.in_bed_start, in_bed_end = excluded.in_bed_end,
    asleep_min = excluded.asleep_min, deep_min = excluded.deep_min,
    rem_min = excluded.rem_min, awake_min = excluded.awake_min,
    -- a later run without a resting value must not erase the one we have
    resting_hr = coalesce(excluded.resting_hr, h.resting_hr),
    at = now();
  get diagnostics n_count = row_count;

  insert into public.coach_health_workout as w
    (id, start_at, end_at, type, duration_min, distance_km, avg_hr, max_hr, zones, at)
  select x->>'id', (x->>'start')::timestamptz, (x->>'end')::timestamptz, x->>'type',
         (x->>'duration_min')::numeric, (x->>'distance_km')::numeric,
         (x->>'avg_hr')::int, (x->>'max_hr')::int, x->'zones', now()
  from jsonb_array_elements(coalesce(p_workouts, '[]'::jsonb)) x
  where x ? 'id' and x ? 'start'
  on conflict (id) do update set
    -- a re-send that lacks a field keeps the one already stored
    end_at = coalesce(excluded.end_at, w.end_at), type = coalesce(excluded.type, w.type),
    duration_min = coalesce(excluded.duration_min, w.duration_min),
    distance_km = coalesce(excluded.distance_km, w.distance_km),
    avg_hr = coalesce(excluded.avg_hr, w.avg_hr), max_hr = coalesce(excluded.max_hr, w.max_hr),
    zones = coalesce(excluded.zones, w.zones),
    at = now();
    -- `confirmed` deliberately not touched
  get diagnostics w_count = row_count;

  -- a season of history is plenty; the app only ever shows the last month
  delete from public.coach_health_night   where night_of < current_date - 120;
  delete from public.coach_health_workout where start_at < now() - interval '120 days';

  return jsonb_build_object('nights', n_count, 'workouts', w_count);
end
$$;

-- Everything since p_since, plus when the last row arrived.
create or replace function public.coach_health_get(p_token text, p_since date)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.coach_health_check(p_token);
  return jsonb_build_object(
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
        'night_of', to_char(night_of, 'YYYY-MM-DD'),
        'in_bed_start', in_bed_start, 'in_bed_end', in_bed_end,
        'asleep_min', asleep_min, 'deep_min', deep_min, 'rem_min', rem_min,
        'awake_min', awake_min, 'resting_hr', resting_hr) order by night_of)
      from public.coach_health_night where night_of >= p_since), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'start', start_at, 'end', end_at, 'type', type,
        'duration_min', duration_min, 'distance_km', distance_km,
        'avg_hr', avg_hr, 'max_hr', max_hr, 'zones', zones,
        'confirmed', confirmed) order by start_at desc)
      from public.coach_health_workout where start_at >= p_since::timestamptz), '[]'::jsonb),
    'last_at', greatest(
      (select max(at) from public.coach_health_night),
      (select max(at) from public.coach_health_workout))
  );
end
$$;

-- The referee answered the effort question for this workout.
create or replace function public.coach_health_ack(p_token text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.coach_health_check(p_token);
  update public.coach_health_workout set confirmed = true where id = p_id;
  return found;
end
$$;

revoke all on function public.coach_health_check(text) from public;
revoke all on function public.coach_health_add(text, jsonb, jsonb) from public;
revoke all on function public.coach_health_get(text, date) from public;
revoke all on function public.coach_health_ack(text, text) from public;
grant execute on function public.coach_health_add(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.coach_health_get(text, date) to anon, authenticated;
grant execute on function public.coach_health_ack(text, text) to anon, authenticated;

-- Check it worked: the first should return {"nights":1,"workouts":0}, the second
-- should list that night, and the delete cleans up.
--   select public.coach_health_add('<SYNC_TOKEN>', '[{"night_of":"2026-01-01","asleep_min":420}]', '[]');
--   select public.coach_health_get('<SYNC_TOKEN>', '2026-01-01');
--   delete from public.coach_health_night where night_of = '2026-01-01';
