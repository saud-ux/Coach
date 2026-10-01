// lib/intervals.js — reading the watch through intervals.icu.
//
// Garmin pushes every sync to intervals.icu on its own, so the server can read
// the watch without the phone: steps, resting HR, HRV and sleep (with Garmin's
// own sleep score) from the wellness log, and workouts from the activities. The
// iOS Shortcut keeps working beside it; it is what brings sleep stages.
//
// Auth is HTTP Basic with the literal user "API_KEY" and the key as password
// (intervals.icu → Settings → Developer Settings). INTERVALS_KEY and
// INTERVALS_ATHLETE come from the environment. Every field read here is
// optional and clamped, exactly like lib/health.js: anything odd is dropped.

const H = require('./health');
const BASE = process.env.INTERVALS_BASE || 'https://intervals.icu/api/v1';   // overridable for tests

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const day = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null;

async function get(path, { key, athlete }){
  const r = await fetch(`${BASE}/athlete/${encodeURIComponent(athlete)}${path}`, {
    headers: { Authorization: 'Basic ' + Buffer.from('API_KEY:' + key).toString('base64'), Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401 || r.status === 403) throw new Error('intervals: the key or athlete id was refused (' + r.status + ')');
  if (!r.ok) throw new Error('intervals: HTTP ' + r.status);
  return r.json();
}

// One wellness row per date. Garmin files a night under the morning it ended,
// so the sleep in row D is the night of D-1 (our night_of).
function wellnessDays(rows){
  const out = [];
  for (const w of Array.isArray(rows) ? rows : []){
    const d = day(w && (w.id || w.date));
    if (!d) continue;
    const row = {
      day: d,
      steps: num(w.steps, 0, 100000),
      resting_hr: num(w.restingHR, 25, 140),
      hrv: num(w.hrv, 5, 300),                    // rMSSD, ms
      sleep_min: w.sleepSecs != null && num(w.sleepSecs, 0, 24 * 3600) != null ? Math.round(w.sleepSecs / 60) : null,
      sleep_score: num(w.sleepScore, 0, 100),
    };
    if (row.steps != null) row.steps = Math.round(row.steps);
    if (row.resting_hr != null) row.resting_hr = Math.round(row.resting_hr);
    if (row.hrv != null) row.hrv = Math.round(row.hrv);
    if (row.sleep_score != null) row.sleep_score = Math.round(row.sleep_score);
    if (Object.keys(row).some(k => k !== 'day' && row[k] != null)) out.push(row);
  }
  return out;
}

// intervals.icu's HR zones may number 5 to 7; anything above zone 5 is zone 5 here.
function zonesOf(times){
  if (!Array.isArray(times) || !times.length) return null;
  const z = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  times.forEach((sec, i) => { const k = 'z' + Math.min(5, i + 1); z[k] += Math.max(0, Number(sec) || 0) / 60; });
  for (const k in z) z[k] = Math.round(z[k] * 10) / 10;
  return z;
}

// Activities -> the same rows the Shortcut produces, keyed by start minute so a
// workout that arrives both ways lands on one row.
function activities(rows){
  const out = [];
  for (const a of Array.isArray(rows) ? rows : []){
    const startMs = Date.parse(a && (a.start_date || a.start_date_local));
    if (!Number.isFinite(startMs)) continue;
    const secs = num(a.elapsed_time ?? a.moving_time, 60, 12 * 3600);
    if (secs == null) continue;
    const km = num(a.distance, 0, 300000);
    const hrr = a.icu_hrr && num(a.icu_hrr.hrr ?? (a.icu_hrr.start_bpm - a.icu_hrr.end_bpm), 0, 90);
    out.push({
      id: H.workoutId(startMs),
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + secs * 1000).toISOString(),
      type: H.typeOf(a.type || a.name),
      duration_min: Math.round(secs / 6) / 10,
      distance_km: km ? Math.round(km / 10) / 100 : null,
      avg_hr: num(a.average_heartrate, 30, 240) != null ? Math.round(a.average_heartrate) : null,
      max_hr: num(a.max_heartrate, 30, 240) != null ? Math.round(a.max_heartrate) : null,
      zones: zonesOf(a.icu_hr_zone_times),
      hr_recovery: hrr != null ? Math.round(hrr) : null,
    });
  }
  return out;
}

const iso = ms => new Date(ms).toISOString().slice(0, 10);

// -> { days, workouts }
async function pull(cfg, { days = 7 } = {}){
  const newest = iso(Date.now() + 864e5), oldest = iso(Date.now() - days * 864e5);
  const [w, a] = await Promise.all([
    get(`/wellness?oldest=${oldest}&newest=${newest}`, cfg),
    get(`/activities?oldest=${oldest}&newest=${newest}`, cfg),
  ]);
  return { days: wellnessDays(w), workouts: activities(a) };
}

module.exports = { pull, wellnessDays, activities, zonesOf };
