// health.js — sleep and watch workouts.
//
// The watch (Garmin -> Apple Health -> an iOS Shortcut -> POST /api/health) fills
// two server tables; syncHealth() reads them back into state.health. SHORTCUT.md
// is the recipe for the phone side.
//
// The data is cached in state.health so the sleep card still has something to show
// on a cold offline open. It is a cache, not a source of truth: the server keeps
// the authoritative rows, and phase 3 deliberately does not let the server write
// into the main state row.

import { state, save, hooks, todayISO, addDays } from './state.js';

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
    hr_recovery,                                  // bpm fallen in the first minute after
    confirmed: false
  }],
  days:    { "YYYY-MM-DD": steps },     // daily step totals
  syncedAt: ISO string | null
}
---------------------------------- */

const empty = () => ({ nights: {}, workouts: [], days: {}, syncedAt: null });

export function healthState(){
  if (!state.health || typeof state.health !== 'object') state.health = empty();
  if (!state.health.nights) state.health.nights = {};
  if (!Array.isArray(state.health.workouts)) state.health.workouts = [];
  if (!state.health.days || typeof state.health.days !== 'object') state.health.days = {};
  return state.health;
}

/* ---------- sleep score ----------
   0-100 from five parts, then a cap for short nights. ARCHITECTURE.md §13
   documents it with worked examples. Tuned towards Garmin Connect's own score,
   which the watch does not send to Apple Health: on the first real night Garmin
   said 53 and the old four-part version said 61, mostly because it ignored REM.

     duration     45   asleep time against a 7h30 target (the main weight)
     deep share   15   deep / asleep, against a 20% target
     REM share    15   REM / asleep, against a 21% target
     awake        10   time awake after falling asleep: 0 min full, 60 min none
     consistency  15   bedtime against the median of the last 7 nights

   Short-night cap: under 5h asleep the score cannot pass 55, under 4h 45, the
   way Garmin calls a short night "non-restorative" whatever its stages were.

   Everything is clamped, so a missing or absurd field costs only its own slice
   and cannot drag the whole score negative. A field that is absent scores 0.6
   rather than 0 -- "unknown" should not read as "bad".                         */

const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const DUR_TARGET = 450;      // 7h30 asleep counts as a full night
const DEEP_TARGET = 0.20;
const REM_TARGET = 0.21;
const CAPS = [[240, 45], [300, 55]];   // [asleep under N minutes, score at most]

// Minutes past midnight, shifted so that 23:00 and 01:00 are two hours apart
// rather than twenty-two.
function bedMinutes(iso){
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const m = d.getHours() * 60 + d.getMinutes();
  return m < 12 * 60 ? m + 24 * 60 : m;
}

// The four parts, each 0-1, plus what they were measured from. The score and the
// details sheet both read this, so the breakdown can never disagree with the
// number on the ring.
export function sleepParts(night, history = []){
  if (!night || !Number.isFinite(night.asleep_min) || night.asleep_min <= 0) return null;

  const hasDeep = Number.isFinite(night.deep_min), hasAwake = Number.isFinite(night.awake_min);
  const hasRem = Number.isFinite(night.rem_min);
  const duration = clamp01(night.asleep_min / DUR_TARGET);
  const deepShare = hasDeep ? night.deep_min / night.asleep_min : null;
  const deep = hasDeep ? clamp01(deepShare / DEEP_TARGET) : 0.6;
  const remShare = hasRem ? night.rem_min / night.asleep_min : null;
  const rem = hasRem ? clamp01(remShare / REM_TARGET) : 0.6;
  const awake = hasAwake ? clamp01(1 - night.awake_min / 60) : 0.6;

  let consistency = 0.6, drift = null;
  const beds = history.map(n => bedMinutes(n.in_bed_start)).filter(Number.isFinite);
  const mine = bedMinutes(night.in_bed_start);
  if (beds.length >= 3 && Number.isFinite(mine)){
    const sorted = [...beds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    drift = mine - median;                              // + later than usual, - earlier
    consistency = clamp01(1 - (Math.abs(drift) - 30) / 60);   // <=30 min full, >=90 min none
  }

  const parts = [
    { k: 'duration',    w: 45, v: duration,    known: true },
    { k: 'deep',        w: 15, v: deep,        known: hasDeep },
    { k: 'rem',         w: 15, v: rem,         known: hasRem },
    { k: 'awake',       w: 10, v: awake,       known: hasAwake },
    { k: 'consistency', w: 15, v: consistency, known: drift != null },
  ];
  const raw = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0));
  const capRule = CAPS.find(([under]) => night.asleep_min < under) || null;
  const score = capRule ? Math.min(raw, capRule[1]) : raw;
  return { score, raw, cap: capRule && raw > capRule[1] ? { under: capRule[0], max: capRule[1] } : null,
           parts, deepShare, remShare, drift, nightsForConsistency: beds.length,
           target: DUR_TARGET, deepTarget: DEEP_TARGET, remTarget: REM_TARGET };
}

export function sleepScore(night, history = []){
  const p = sleepParts(night, history);
  return p ? p.score : null;
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

// The last n nights on record, oldest first, each with its own score measured
// against the nights before it, the same way the ring measures last night.
export function nightHistory(n = 7){
  const h = healthState();
  const keys = Object.keys(h.nights).sort().slice(-n);
  return keys.map(k => ({ ...h.nights[k], night_of: k, score: sleepScore(h.nights[k], recentNights(7, k)) }));
}

export function recentNights(n = 7, before = todayISO()){
  const h = healthState();
  return Object.keys(h.nights).filter(d => d < before).sort().slice(-n).map(d => h.nights[d]);
}

// Workouts that arrived from the watch and have not been confirmed yet, newest
// first, and only recent ones.
export function pendingWorkouts(){
  const cutoff = Date.now() - PENDING_DAYS * 864e5;
  return healthState().workouts.filter(w => !w.confirmed && !(Date.parse(w.start) < cutoff));
}

export function workoutById(id){
  return healthState().workouts.find(w => w.id === id) || null;
}

// Mark one confirmed once it has been written into state.logs.
export function confirmWorkout(id){
  const w = workoutById(id);
  if (w){ w.confirmed = true; save(); ack(id); }
  return w;
}

/* ---------- sync ---------- */

// Max heart rate the zones are cut from. The server reads the same setting when the
// Shortcut posts, so a change here applies to workouts that arrive afterwards.
export const MAX_HR_DEFAULT = 190;
export function maxHr(){
  const n = Number(state.settings && state.settings.max_hr);
  return n >= 120 && n <= 230 ? n : MAX_HR_DEFAULT;
}

// Same passcode handling as every other call: the header from localStorage, and
// no prompt -- a background sync must never pop a dialog on its own.
function api(path, opts = {}){
  let pass = '';
  try { pass = localStorage.getItem('rc-pass') || ''; } catch(e){}
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Passcode': pass } });
}

const KEEP_NIGHTS = 31, KEEP_WORKOUTS = 40;
// A watch workout older than this stops asking. The first sync can backfill a
// month, and a month of cards would bury today's.
const PENDING_DAYS = 3;

// Server rows -> the cache. The server is the source of truth for what the watch
// measured; the only thing the device knows better is that the referee confirmed a
// workout while the ack was still in flight, so `confirmed` is OR-ed and an ack
// that did not land is sent again.
function merge(remote){
  const h = healthState();
  let changed = false;
  for (const n of remote.nights || []){
    if (!n || !n.night_of) continue;
    const { night_of, ...row } = n;
    if (JSON.stringify(h.nights[night_of]) !== JSON.stringify(row)){ h.nights[night_of] = row; changed = true; }
  }
  const local = new Map(h.workouts.map(w => [w.id, w]));
  const resend = [];
  for (const w of remote.workouts || []){
    if (!w || !w.id) continue;
    const mine = local.get(w.id);
    const confirmed = !!(w.confirmed || (mine && mine.confirmed));
    if (mine && mine.confirmed && !w.confirmed) resend.push(w.id);
    const row = { ...w, confirmed };
    if (!mine || JSON.stringify(mine) !== JSON.stringify(row)){ local.set(w.id, row); changed = true; }
  }
  h.workouts = [...local.values()].sort((a, b) => String(b.start).localeCompare(String(a.start))).slice(0, KEEP_WORKOUTS);
  const keys = Object.keys(h.nights).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_NIGHTS))){ delete h.nights[k]; changed = true; }
  for (const d of remote.days || []){
    if (!d || !d.day || !Number.isFinite(d.steps)) continue;
    if (h.days[d.day] !== d.steps){ h.days[d.day] = d.steps; changed = true; }
  }
  const dk = Object.keys(h.days).sort();
  for (const k of dk.slice(0, Math.max(0, dk.length - KEEP_NIGHTS))){ delete h.days[k]; changed = true; }
  return { changed, resend };
}

let inFlight = null, lastRun = 0;

// Fetches /api/health. Safe to call on every open and every return to the app,
// offline included: any failure leaves the cache exactly as it was. Resolves to
// {ok, last_at, nights, workouts} or {ok:false, error} so Settings can report it.
export function syncHealth({ force = false } = {}){
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastRun < 60e3) return Promise.resolve({ ok: true, skipped: true });
  lastRun = Date.now();
  inFlight = (async () => {
    try {
      const r = await api('/api/health');
      let d = null; try { d = await r.json(); } catch(e){}
      if (!r.ok) return { ok: false, error: (d && d.error) || (r.status === 401 ? 'passcode' : 'http_' + r.status) };
      const body = d || {};
      const { changed, resend } = merge(body);
      const h = healthState();
      const newer = !!body.last_at && body.last_at !== h.syncedAt;
      if (newer) h.syncedAt = body.last_at;
      const stamped = stampReadiness();
      const auto = autoLogWorkouts();
      const slept = stampMatchSleep();
      // nothing new is the common case, and it must not count as an edit: save()
      // marks the state dirty, which would make a concurrent syncRemote() skip
      if (changed || newer || stamped || auto || slept){ save(); hooks.rerender(); }
      resend.forEach(ack);
      return { ok: true, last_at: body.last_at || null, nights: (body.nights || []).length, workouts: (body.workouts || []).length };
    } catch(e){
      return { ok: false, error: 'offline' };
    } finally { inFlight = null; }
  })();
  return inFlight;
}

// Tell the server this workout is answered, so a re-sent Shortcut payload or a
// second device does not bring the card back. Fire and forget: if it fails the
// next sync sees the mismatch and sends it again.
export function ack(id){
  api('/api/health/ack', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {});
}

/* ---------- readiness: the watch as a second opinion on sleep ---------- */

// 0-100 -> the 1-5 axis the readiness answers use. 100 is 5, 50 is 3, 0 is 1.
export const sleepTo5 = score => 1 + 4 * Math.max(0, Math.min(100, score)) / 100;

// Today's readiness entry remembers the watch score it was blended with, so the
// number on the tile does not drift if the cache changes later, and so a past day
// keeps scoring the way it scored on the day. Stamped when the answers land, or on
// the first sync after, whichever comes second.
export function stampReadiness(){
  const t = todayISO(), r = state.readiness && state.readiness[t];
  if (!r || r.sleep_watch != null) return false;
  const s = lastNightSleep();
  if (!s || s.score == null) return false;
  r.sleep_watch = s.score;
  return true;
}

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

/* ---------- load from heart rate ----------
   Each minute in a zone scores what that zone is on the effort scale the app has
   always used (RPE = [0,2,4,6,8,10] for effort 1-5): zone 1 = 2 ... zone 5 = 10.
   So a heart-rate load is in the same units as minutes x RPE, and ACWR can mix
   days measured either way without a jump. Used only when the zones cover most of
   the session; a strap that dropped out falls back to the felt effort. */
const ZONE_RPE = { z1: 2, z2: 4, z3: 6, z4: 8, z5: 10 };
export function hrLoad(w){
  if (!w || !w.zones) return null;
  let mins = 0, load = 0;
  for (const k in ZONE_RPE){ const m = Number(w.zones[k]) || 0; mins += m; load += m * ZONE_RPE[k]; }
  if (!mins || (w.duration_min && mins < 0.7 * w.duration_min)) return null;
  return Math.round(load);
}

// Effort guessed from heart rate, for a session logged before the referee says how
// it felt: average HR as a share of max HR, onto the 1-5 scale.
export function effortFromHr(w){
  const avg = Number(w && w.avg_hr); if (!avg) return null;
  const p = avg / maxHr();
  return p >= 0.88 ? 5 : p >= 0.82 ? 4 : p >= 0.75 ? 3 : p >= 0.68 ? 2 : 1;
}

/* ---------- logging a session from the watch ----------
   A workout that arrives on a day with a planned session marks that day done:
   its duration, an effort guessed from heart rate, and the heart-rate load. The
   workout stays unconfirmed, so its card still asks how it felt, and the answer
   replaces the guess. Match days are left alone: their evaluation is its own step. */
export function autoLogWorkouts(){
  let changed = false;
  for (const w of pendingWorkouts()){
    const d = localDate(w.start); if (!d) continue;
    const s = state.sessions[d], lg = state.logs[d];
    if (!s || s.type === 'rest' || s.type === 'match' || (lg && lg.done)) continue;
    state.logs[d] = {
      ...(lg || {}), done: true,
      dur: Math.round(w.duration_min || 0) || (lg && lg.dur) || undefined,
      effort: effortFromHr(w) || (lg && lg.effort) || null,
      effort_est: true,                            // a guess until the referee answers
      hr_load: hrLoad(w), zones: w.zones || null,
      distance: w.distance_km ?? null, avg_hr: w.avg_hr ?? null, max_hr: w.max_hr ?? null,
      source: 'watch', auto: true, note: (lg && lg.note) || ''
    };
    changed = true;
  }
  return changed;
}
const localDate = iso => { const t = new Date(iso); if (isNaN(t)) return null;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/* ---------- resting heart rate warning ----------
   Two nights running at 5+ above the average of the nights before them is the
   classic early sign of fatigue or an illness coming. Needs 4 earlier nights. */
export function restingHrWarning(){
  const h = healthState();
  const keys = Object.keys(h.nights).filter(k => Number.isFinite(h.nights[k].resting_hr)).sort();
  if (keys.length < 6) return null;
  const last2 = keys.slice(-2), before = keys.slice(-9, -2);
  if (last2[1] < addDays(todayISO(), -2)) return null;          // stale: no warning off old data
  const avg = before.reduce((a, k) => a + h.nights[k].resting_hr, 0) / before.length;
  const up = last2.map(k => h.nights[k].resting_hr - avg);
  if (!(up[0] >= 5 && up[1] >= 5)) return null;
  return { avg: Math.round(avg), now: h.nights[last2[1]].resting_hr, up: Math.round(Math.min(...up)) };
}

/* ---------- steps ----------
   Daily totals from the watch. The target is an average of 8,000 a day: the
   point past which the large step-count studies stop finding much more benefit
   for adults, and easy for a referee to pass on a training day. Two days get a
   ceiling instead, because there the aim is rest: a rest day and the day before
   a match. Over 15,000 on a rest day, or 12,000 the day before a match, the
   legs did not really rest. */
export const STEPS_TARGET = 8000;
const REST_CAP = 15000, EVE_CAP = 12000;
export function stepsOn(day){ const v = healthState().days[day]; return Number.isFinite(v) ? v : null; }
// The last n days that have a total, oldest first, today included.
export function stepsHistory(n = 14){
  const t = todayISO();
  return Array.from({ length: n }, (_, i) => addDays(t, i - n + 1)).map(day => ({ day, steps: stepsOn(day) }));
}
// Average of the last 7 full days (today is still filling up), from those on record.
export function stepsAverage(){
  const t = todayISO();
  const xs = Array.from({ length: 7 }, (_, i) => stepsOn(addDays(t, -1 - i))).filter(v => v != null);
  return xs.length >= 3 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}
// A note when today's walking works against today's plan, else null.
export function stepsNote(){
  const t = todayISO(), n = stepsOn(t);
  if (n == null) return null;
  const eve = state.matches.some(m => m.date === addDays(t, 1));
  const s = state.sessions[t];
  if (eve && n > EVE_CAP) return { level: 'warn', text: `مشيت ${n.toLocaleString('en-US')} خطوة اليوم وبكرة مباراة. ريّح رجولك باقي اليوم.` };
  if (s && s.type === 'rest' && n > REST_CAP) return { level: 'warn', text: `اليوم راحة بس مشيت ${n.toLocaleString('en-US')} خطوة. رجولك ما ارتاحت فعليًا.` };
  return null;
}

/* ---------- heart-rate recovery ----------
   How far the pulse falls in the first minute after a workout (lib/health.js
   works it out from the samples the Shortcut sends past the end). The faster it
   falls the fitter the heart; the bands are the usual ones for a one-minute drop
   after stopping, read loosely, since walking it off instead of standing still
   makes the drop smaller. */
export function recoveryBand(drop){
  if (!Number.isFinite(drop)) return null;
  return drop >= 30 ? { word: 'ممتاز', cls: 'top' } : drop >= 20 ? { word: 'جيد', cls: 'good' }
       : drop >= 12 ? { word: 'مقبول', cls: 'mid' } : { word: 'ضعيف', cls: 'low' };
}
// Newest first, the workouts that carry a recovery figure.
export function recoveryHistory(n = 8){
  return healthState().workouts.filter(w => Number.isFinite(w.hr_recovery)).slice(0, n)
    .map(w => ({ id: w.id, start: w.start, drop: w.hr_recovery, type: w.type }));
}
// The average of the ones before this workout, for "compared to your usual".
export function recoveryUsual(beforeId){
  const xs = recoveryHistory(12); const i = xs.findIndex(x => x.id === beforeId);
  const prev = (i < 0 ? xs : xs.slice(i + 1)).slice(0, 5);
  return prev.length >= 2 ? Math.round(prev.reduce((a, x) => a + x.drop, 0) / prev.length) : null;
}

/* ---------- sleep before a match ----------
   Each match remembers the night before it (m.sleep_before), stamped here while
   that night is still in the 31-night cache. The match keeps it after the cache
   moves on, so the comparison with the assessor's score can cover a season. */
export function stampMatchSleep(){
  const h = healthState(); let changed = false;
  for (const m of state.matches){
    if (m.sleep_before || !m.date) continue;
    const key = addDays(m.date, -1), n = h.nights[key];
    if (!n || !n.asleep_min) continue;
    m.sleep_before = { asleep_min: n.asleep_min, score: sleepScore(n, recentNights(7, key)) };
    changed = true;
  }
  return changed;
}
// Matches with both a night and a score, split at 7 hours asleep.
export function sleepVsScore(){
  const rows = state.matches
    .map(m => ({ date: m.date, score: parseFloat(m.score), sleep: m.sleep_before }))
    .filter(r => r.sleep && Number.isFinite(r.score));
  if (rows.length < 2) return rows.length ? { rows, groups: null } : null;
  const avg = xs => xs.length ? Math.round(10 * xs.reduce((a, r) => a + r.score, 0) / xs.length) / 10 : null;
  const long = rows.filter(r => r.sleep.asleep_min >= 420), short = rows.filter(r => r.sleep.asleep_min < 420);
  return { rows, groups: { long: { n: long.length, avg: avg(long) }, short: { n: short.length, avg: avg(short) } } };
}
