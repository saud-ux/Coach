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
    // Garmin sends a 0 score for a night it has not scored yet: that is "no score"
    if (!row.sleep_score) row.sleep_score = null;
    if (!row.sleep_min) row.sleep_min = null;
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

/* ---------- planned workouts: the app's sessions onto the watch ----------
   Each day's watch workout (js/garmin.js) becomes an intervals.icu calendar event
   in its workout text format, which intervals.icu sends on to Garmin Connect
   («Upload planned workouts» in its Garmin connection), so it appears on the
   watch's calendar with that week's counts. Events carry external_id rc-<date>, so
   a re-send updates the same event, and an rc- event whose day no longer has a
   watch workout (made lighter into a rest, moved) is deleted. Nothing else on the
   calendar is touched.

   Cues are short English words: the watch may not draw Arabic. A step with no
   time on the app side (the jumps, ended with Lap) is given 8 minutes here, as
   intervals.icu's text has no lap-press step. */
const CUE = { warmup: 'Warm up', run: 'Go', recover: 'Easy', rest: 'Rest', cooldown: 'Cool down', other: 'Drills' };
const dur = sec => sec >= 60 ? `${Math.floor(sec / 60)}m${sec % 60 ? (sec % 60) + 's' : ''}` : `${sec}s`;
function stepLine(s){
  const sec = s.sec == null ? 480 : s.sec;
  return `- ${CUE[s.k] || 'Go'} ${dur(sec)}${s.zone ? ` Z${s.zone} HR` : ''}`;
}
function workoutText(steps){
  const out = [];
  for (const s of steps){
    if (s.k === 'repeat'){ out.push('', `${s.times}x`, ...s.steps.map(stepLine), ''); continue; }
    if (s.k === 'warmup'){ out.push('Warmup', stepLine(s), ''); continue; }
    if (s.k === 'cooldown'){ out.push('', 'Cooldown', stepLine(s)); continue; }
    out.push(stepLine(s));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function send(path, cfg, method, body){
  const r = await fetch(`${BASE}/athlete/${encodeURIComponent(cfg.athlete)}${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Basic ' + Buffer.from('API_KEY:' + cfg.key).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`intervals: ${method} ${path.split('?')[0]} HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// plan: [{date, name, steps}] for the days that have a watch workout, within
// [oldest, newest]. -> {pushed, removed}
async function pushPlan(cfg, plan, { oldest, newest }){
  const events = plan.map(p => ({
    category: 'WORKOUT', type: 'Run', name: p.name,
    start_date_local: `${p.date}T00:00:00`,
    description: workoutText(p.steps),
    external_id: `rc-${p.date}`,
  }));
  if (events.length) await send('/events/bulk?upsert=true', cfg, 'POST', events);
  const keep = new Set(events.map(e => e.external_id));
  const existing = (await get(`/events?oldest=${oldest}&newest=${newest}`, cfg)) || [];
  let removed = 0;
  for (const e of existing){
    if (e && /^rc-\d{4}-\d{2}-\d{2}$/.test(e.external_id || '') && !keep.has(e.external_id)){
      await send(`/events/${encodeURIComponent(e.id)}`, cfg, 'DELETE');
      removed++;
    }
  }
  return { pushed: events.length, removed };
}

module.exports = { pull, wellnessDays, activities, zonesOf, workoutText, pushPlan };
