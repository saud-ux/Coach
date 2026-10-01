-- 004_wellness.sql
--
-- The daily wellness row from intervals.icu (lib/intervals.js): resting HR, HRV,
-- total sleep and Garmin's own sleep score, beside the steps 003 added. Stored by
-- day; the sleep in row D is the night that ended on the morning of D.
--
-- Run once in the Supabase SQL editor after 003. Safe to re-run. No row is ever
-- deleted here (003's coach_health_add_days already trims old days).

alter table public.coach_health_day add column if not exists resting_hr  integer;
alter table public.coach_health_day add column if not exists hrv         integer;   -- rMSSD, ms
alter table public.coach_health_day add column if not exists sleep_min   integer;
alter table public.coach_health_day add column if not exists sleep_score integer;   -- Garmin's

-- A field the call does not carry keeps what is stored; steps never go down.
create or replace function public.coach_health_add_wellness(p_token text, p_days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare d_count int := 0;
begin
  perform public.coach_health_check(p_token);
  insert into public.coach_health_day as d (day, steps, resting_hr, hrv, sleep_min, sleep_score, at)
  select (x->>'day')::date, (x->>'steps')::int, (x->>'resting_hr')::int, (x->>'hrv')::int,
         (x->>'sleep_min')::int, (x->>'sleep_score')::int, now()
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) x
  where x ? 'day'
  on conflict (day) do update set
    steps       = greatest(excluded.steps, d.steps),
    resting_hr  = coalesce(excluded.resting_hr, d.resting_hr),
    hrv         = coalesce(excluded.hrv, d.hrv),
    sleep_min   = coalesce(excluded.sleep_min, d.sleep_min),
    sleep_score = coalesce(excluded.sleep_score, d.sleep_score),
    at = now();
  get diagnostics d_count = row_count;
  return jsonb_build_object('days', d_count);
end
$$;

revoke all on function public.coach_health_add_wellness(text, jsonb) from public;
grant execute on function public.coach_health_add_wellness(text, jsonb) to anon, authenticated;

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
      select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'steps', steps,
        'resting_hr', resting_hr, 'hrv', hrv, 'sleep_min', sleep_min, 'sleep_score', sleep_score) order by day)
      from public.coach_health_day where day >= p_since), '[]'::jsonb),
    'last_at', greatest(
      (select max(at) from public.coach_health_night),
      (select max(at) from public.coach_health_workout),
      (select max(at) from public.coach_health_day))
  );
end
$$;
