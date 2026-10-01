-- 003_steps_recovery.sql
--
-- Daily steps, and the one-minute heart-rate recovery after each workout.
--
-- Steps arrive from the Shortcut as one total per day (grouped by day in Health);
-- the recovery is worked out by lib/health.js from the heart rate around the end
-- of a workout. Both ride the same POST /api/health; steps are stored by
-- coach_health_add_days and read back by coach_health_get.
--
-- Run once in the Supabase SQL editor after 002. Safe to re-run.

create table if not exists public.coach_health_day (
  day    date primary key,
  steps  integer,
  at     timestamptz not null default now()
);
alter table public.coach_health_day enable row level security;

alter table public.coach_health_workout add column if not exists hr_recovery integer;   -- bpm fallen in the first minute

-- The add function keeps its signature and learns hr_recovery. Steps get their
-- own function rather than a fourth argument: changing the signature would mean
-- dropping the old one, and an overload would make a call by name ambiguous.
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
    resting_hr = coalesce(excluded.resting_hr, h.resting_hr),
    at = now();
  get diagnostics n_count = row_count;

  insert into public.coach_health_workout as w
    (id, start_at, end_at, type, duration_min, distance_km, avg_hr, max_hr, zones, hr_recovery, at)
  select x->>'id', (x->>'start')::timestamptz, (x->>'end')::timestamptz, x->>'type',
         (x->>'duration_min')::numeric, (x->>'distance_km')::numeric,
         (x->>'avg_hr')::int, (x->>'max_hr')::int, x->'zones', (x->>'hr_recovery')::int, now()
  from jsonb_array_elements(coalesce(p_workouts, '[]'::jsonb)) x
  where x ? 'id' and x ? 'start'
  on conflict (id) do update set
    end_at = coalesce(excluded.end_at, w.end_at), type = coalesce(excluded.type, w.type),
    duration_min = coalesce(excluded.duration_min, w.duration_min),
    distance_km = coalesce(excluded.distance_km, w.distance_km),
    avg_hr = coalesce(excluded.avg_hr, w.avg_hr), max_hr = coalesce(excluded.max_hr, w.max_hr),
    zones = coalesce(excluded.zones, w.zones),
    hr_recovery = coalesce(excluded.hr_recovery, w.hr_recovery),
    at = now();
  get diagnostics w_count = row_count;

  delete from public.coach_health_night   where night_of < current_date - 120;
  delete from public.coach_health_workout where start_at < now() - interval '120 days';

  return jsonb_build_object('nights', n_count, 'workouts', w_count);
end
$$;

create or replace function public.coach_health_add_days(p_token text, p_days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare d_count int := 0;
begin
  perform public.coach_health_check(p_token);
  -- today is sent again on every run with more steps in it; a day never goes down,
  -- so a run that read Health before the watch synced cannot shrink it
  insert into public.coach_health_day as d (day, steps, at)
  select (x->>'day')::date, (x->>'steps')::int, now()
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) x
  where x ? 'day' and x ? 'steps'
  on conflict (day) do update set steps = greatest(excluded.steps, d.steps), at = now();
  get diagnostics d_count = row_count;

  delete from public.coach_health_day where day < current_date - 120;
  return jsonb_build_object('days', d_count);
end
$$;

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
        'avg_hr', avg_hr, 'max_hr', max_hr, 'zones', zones, 'hr_recovery', hr_recovery,
        'confirmed', confirmed) order by start_at desc)
      from public.coach_health_workout where start_at >= p_since::timestamptz), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'steps', steps) order by day)
      from public.coach_health_day where day >= p_since), '[]'::jsonb),
    'last_at', greatest(
      (select max(at) from public.coach_health_night),
      (select max(at) from public.coach_health_workout),
      (select max(at) from public.coach_health_day))
  );
end
$$;

revoke all on function public.coach_health_add_days(text, jsonb) from public;
grant execute on function public.coach_health_add_days(text, jsonb) to anon, authenticated;

-- Check: the first returns {"days":1}, the second lists it, the delete cleans up.
--   select public.coach_health_add_days('<SYNC_TOKEN>', '[{"day":"2026-01-01","steps":8000}]');
--   select public.coach_health_get('<SYNC_TOKEN>', '2026-01-01');
--   delete from public.coach_health_day where day = '2026-01-01';
