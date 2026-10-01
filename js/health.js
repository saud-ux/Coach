// health.js — sleep and watch workouts.
//
// Phase 2 builds the read side: the shape, the sleep score, and the accessors the
// Today screen and the Workout Summary read from. Phase 3 fills it from the watch
// (Garmin -> Apple Health -> an iOS Shortcut -> POST /api/health) and writes the
// matching SHORTCUT.md.
//
// The data is cached in state.health so the sleep card still has something to show
// on a cold offline open. It is a cache, not a source of truth: the server keeps
// the authoritative rows, and phase 3 deliberately does not let the server write
// into the main state row.

import { state, save, todayISO, addDays } from './state.js';

/* ---------- shape ----------
state.health = {
  nights:  { "YYYY-MM-DD": {            // keyed by night_of
    in_bed_start, in_bed_end,                     // ISO strings
    asleep_min, deep_min, rem_min, awake_min,     // numbers
    resting_hr                                    // number
  }},
  workouts: [ {                         // newest first
    id, start, end, type, duration_min, distance_km,
    avg_hr, max_hr, zones: {z2,z3,z4,z5},         // minutes per zone
    confirmed: false
  }],
  syncedAt: ISO string | null
}
---------------------------------- */

const empty = () => ({ nights: {}, workouts: [], syncedAt: null });

export function healthState(){
  if (!state.health || typeof state.health !== 'object') state.health = empty();
  if (!state.health.nights) state.health.nights = {};
  if (!Array.isArray(state.health.workouts)) state.health.workouts = [];
  return state.health;
}

/* ---------- sleep score ----------
   0-100 from four parts. Phase 3 documents this in ARCHITECTURE.md and tunes it
   against real nights; the weights below are the starting point.

     duration     55   asleep time against a 7h30 target (the main weight)
     deep share   20   deep / asleep, against a 20% target
     awake        10   time awake after falling asleep: 0 min full, 60 min none
     consistency  15   bedtime against the median of the last 7 nights

   Everything is clamped, so a missing or absurd field costs only its own slice
   and cannot drag the whole score negative. A field that is absent scores 0.6
   rather than 0 -- "unknown" should not read as "bad".                         */

const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const DUR_TARGET = 450;      // 7h30 asleep counts as a full night
const DEEP_TARGET = 0.20;

// Minutes past midnight, shifted so that 23:00 and 01:00 are two hours apart
// rather than twenty-two.
function bedMinutes(iso){
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const m = d.getHours() * 60 + d.getMinutes();
  return m < 12 * 60 ? m + 24 * 60 : m;
}

export function sleepScore(night, history = []){
  if (!night || !Number.isFinite(night.asleep_min) || night.asleep_min <= 0) return null;

  const duration = clamp01(night.asleep_min / DUR_TARGET);
  const deep = Number.isFinite(night.deep_min)
    ? clamp01((night.deep_min / night.asleep_min) / DEEP_TARGET) : 0.6;
  const awake = Number.isFinite(night.awake_min)
    ? clamp01(1 - night.awake_min / 60) : 0.6;

  let consistency = 0.6;
  const beds = history.map(n => bedMinutes(n.in_bed_start)).filter(Number.isFinite);
  const mine = bedMinutes(night.in_bed_start);
  if (beds.length >= 3 && Number.isFinite(mine)){
    const sorted = [...beds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const drift = Math.abs(mine - median);
    consistency = clamp01(1 - (drift - 30) / 60);     // <=30 min full, >=90 min none
  }

  return Math.round(100 * (duration * 0.55 + deep * 0.20 + awake * 0.10 + consistency * 0.15));
}

/* ---------- accessors the UI reads ---------- */

// "Last night" is the night whose night_of is yesterday: you wake up today from
// the night of yesterday. A night filed under today is accepted too, because a
// Shortcut that runs after midnight may label it that way.
export function lastNightSleep(){
  const h = healthState();
  const y = addDays(todayISO(), -1), t = todayISO();
  const key = h.nights[y] ? y : (h.nights[t] ? t : null);
  if (!key) return null;
  const night = h.nights[key];
  return { ...night, night_of: key, score: sleepScore(night, recentNights(7, key)) };
}

export function recentNights(n = 7, before = todayISO()){
  const h = healthState();
  return Object.keys(h.nights).filter(d => d < before).sort().slice(-n).map(d => h.nights[d]);
}

// Workouts that arrived from the watch and have not been confirmed yet.
export function pendingWorkouts(){
  return healthState().workouts.filter(w => !w.confirmed);
}

export function workoutById(id){
  return healthState().workouts.find(w => w.id === id) || null;
}

// Mark one confirmed once it has been written into state.logs.
export function confirmWorkout(id){
  const w = workoutById(id);
  if (w){ w.confirmed = true; save(); }
  return w;
}

/* ---------- phase 3 seams ---------- */

// Fetches /api/health. A no-op until phase 3; it must stay safe to call on every
// open, including offline.
export async function syncHealth(){ /* phase 3 */ }

// What goes into the coach's prompt alongside the schedule.
export function healthContext(){
  const s = lastNightSleep();
  if (!s) return null;
  return {
    sleep_score: s.score,
    asleep_min: s.asleep_min,
    deep_min: s.deep_min,
    awake_min: s.awake_min,
    resting_hr: s.resting_hr
  };
}

export function lastSync(){ return healthState().syncedAt; }
