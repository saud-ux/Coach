// lib/health.js — turns what the iOS Shortcut sends into clean rows.
//
// The Shortcut is the least trustworthy writer in the system: it is built by hand
// on a phone, its numbers can arrive as text with units attached, its dates come
// formatted however the phone's locale likes, and the labels on sleep samples are
// in whatever language the phone is set to. So every field is optional, every
// number is clamped, and anything that cannot be read is dropped rather than
// stored as garbage. A payload with nothing usable in it is not an error -- it is
// just nothing.
//
// Pure functions only, no I/O, so the whole thing is testable from a terminal:
//   node -e "console.log(require('./lib/health').normalize(require('./sample.json'), {maxHr:190, tz:'Asia/Riyadh'}))"

const LIMITS = { sleep: 3000, nights: 31, workouts: 20, hr: 6000 };
const MAX_HR_DEFAULT = 190;

/* ---------- reading loose values ---------- */

// Arabic-Indic and Persian digits, the Arabic decimal comma, and a unit tail
// ("62 count/min", "٦٢ ن/د", "5.2 km") all come out as a plain number.
function toNum(v){
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
             .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0)
             .replace(/٫/g, '.').replace(/٬|,(?=\d{3}(?!\d))/g, '')
             .replace(/(\d),(\d{1,2})(?!\d)/, '$1.$2');            // "6,2 km" is a decimal comma
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
const clampNum = (v, lo, hi) => { const n = toNum(v); return n == null || n < lo || n > hi ? null : n; };

function toMs(v){
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;   // epoch s or ms
  const s = String(v).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).trim();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
const isoOf = ms => new Date(ms).toISOString();

// The calendar date and hour of an instant in the referee's own timezone.
function localParts(ms, tz){
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

/* ---------- sleep ---------- */

// Apple Health's sleep stages, in English and in Arabic, as the Shortcut hands
// them over. Order matters: "Asleep Deep" must hit deep before it hits asleep.
const STAGES = [
  ['deep',   /deep|عميق/i],
  ['rem',    /rem|حركة العين|الريم/i],
  ['core',   /core|أساسي|اساسي|خفيف|light/i],
  ['awake',  /awake|مستيقظ|صاحي|يقظ/i],
  ['inbed',  /in ?bed|في السرير|بالسرير/i],
  ['asleep', /asleep|sleep|نائم|نوم/i],
];
const stageOf = v => { const s = String(v == null ? '' : v); for (const [k, re] of STAGES) if (re.test(s)) return k; return null; };

// Total minutes covered by a set of intervals, overlaps counted once. Two sources
// writing the same night (the watch and the phone, say) would otherwise double it.
function unionMin(iv){
  if (!iv.length) return 0;
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  let total = 0, [a, b] = s[0];
  for (let i = 1; i < s.length; i++){
    const [c, d] = s[i];
    if (c <= b) b = Math.max(b, d);
    else { total += b - a; a = c; b = d; }
  }
  return Math.round((total + b - a) / 60000);
}

// Raw samples -> one row per night. A night is filed under the evening it began:
// anything starting before noon belongs to the previous date. Samples starting
// between 11:00 and 18:00 are naps and are left out -- they are not the night.
function nightsFromSamples(samples, tz){
  const by = new Map();
  for (const x of samples.slice(0, LIMITS.sleep)){
    if (!x || typeof x !== 'object') continue;
    const st = stageOf(x.value ?? x.stage ?? x.type), a = toMs(x.start ?? x.startDate), b = toMs(x.end ?? x.endDate);
    if (!st || a == null || b == null || b <= a || b - a > 16 * 3600e3) continue;
    const { date, hour } = localParts(a, tz);
    if (hour >= 11 && hour < 18) continue;
    const night = hour < 12 ? localParts(a - 12 * 3600e3, tz).date : date;
    if (!by.has(night)) by.set(night, { deep: [], rem: [], core: [], awake: [], inbed: [], asleep: [] });
    by.get(night)[st].push([a, b]);
  }
  const out = [];
  for (const [night_of, g] of by){
    const all = [...g.deep, ...g.rem, ...g.core, ...g.awake, ...g.inbed, ...g.asleep];
    const sleeping = [...g.deep, ...g.rem, ...g.core, ...g.asleep];
    if (!sleeping.length) continue;                     // only "in bed": not a night we can score
    const staged = g.deep.length || g.rem.length || g.core.length;
    out.push({
      night_of,
      in_bed_start: isoOf(Math.min(...all.map(i => i[0]))),
      in_bed_end:   isoOf(Math.max(...all.map(i => i[1]))),
      asleep_min: unionMin(sleeping),
      deep_min: staged ? unionMin(g.deep) : null,
      rem_min:  staged ? unionMin(g.rem) : null,
      awake_min: g.awake.length ? unionMin(g.awake) : null,
      resting_hr: null
    });
  }
  return out;
}

// A night the Shortcut already summed up itself.
function cleanNight(x, tz){
  if (!x || typeof x !== 'object') return null;
  const a = toMs(x.in_bed_start), b = toMs(x.in_bed_end);
  let night_of = /^\d{4}-\d{2}-\d{2}$/.test(String(x.night_of || '')) ? x.night_of : null;
  if (!night_of && a != null){
    const { date, hour } = localParts(a, tz);
    night_of = hour < 12 ? localParts(a - 12 * 3600e3, tz).date : date;
  }
  const asleep = clampNum(x.asleep_min, 1, 1080);
  if (!night_of || asleep == null) return null;
  // a stage cannot be longer than the sleep it is part of; awake time sits outside it
  const part = (v, cap) => { const n = clampNum(v, 0, 1080); return n == null ? null : Math.round(Math.min(n, cap)); };
  return {
    night_of,
    in_bed_start: a != null ? isoOf(a) : null,
    in_bed_end: b != null && (a == null || b > a) ? isoOf(b) : null,
    asleep_min: Math.round(asleep),
    deep_min: part(x.deep_min, asleep), rem_min: part(x.rem_min, asleep), awake_min: part(x.awake_min, 600),
    resting_hr: (n => n == null ? null : Math.round(n))(clampNum(x.resting_hr, 25, 140))
  };
}

// Resting HR arrives as one number or as a list of samples; the latest one wins.
function restingFrom(v){
  if (Array.isArray(v)){
    const xs = v.map(s => ({ v: clampNum(s && (s.value ?? s), 25, 140), t: toMs(s && (s.date ?? s.start)) ?? 0 }))
                .filter(s => s.v != null).sort((a, b) => b.t - a.t);
    return xs.length ? Math.round(xs[0].v) : null;
  }
  const n = clampNum(v, 25, 140);
  return n == null ? null : Math.round(n);
}

/* ---------- workouts ---------- */

const TYPES = [
  ['running',  /run|jog|جري|ركض/i],
  ['walking',  /walk|hik|مشي/i],
  ['cycling',  /cycl|bik|دراج/i],
  ['hiit',     /hiit|interval|فتر|عالي الكثافة/i],
  ['strength', /strength|weight|functional|core|قوة|أثقال|اثقال/i],
  ['soccer',   /soccer|football|كرة/i],
];
const typeOf = v => { const s = String(v == null ? '' : v); for (const [k, re] of TYPES) if (re.test(s)) return k; return 'other'; };

// The id is the start time to the minute. The same workout sent twice -- the
// Shortcut ran again, or Health rounded the seconds differently -- lands on the
// same row instead of making a second card.
const workoutId = ms => 'w' + Math.round(ms / 60000).toString(36);

const zoneOf = (bpm, max) => { const p = bpm / max; return p >= 0.9 ? 'z5' : p >= 0.8 ? 'z4' : p >= 0.7 ? 'z3' : p >= 0.6 ? 'z2' : 'z1'; };

// Heart-rate samples -> time-weighted average, peak, and minutes per zone. Each
// sample owns the time until the next one, capped at two minutes so a gap where
// the strap lost contact does not get billed to whatever zone came before it.
function hrStats(samples, a, b, maxHr){
  const pts = samples.slice(0, LIMITS.hr)
    .map(s => ({ v: clampNum(s && (s.value ?? s.bpm), 30, 240), t: toMs(s && (s.date ?? s.start ?? s.time)) }))
    .filter(s => s.v != null && s.t != null && s.t >= a - 60e3 && (b == null || s.t <= b + 60e3))
    .sort((x, y) => x.t - y.t);
  if (!pts.length) return null;
  const CAP = 120e3;
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let wSum = 0, vSum = 0, peak = 0;
  for (let i = 0; i < pts.length; i++){
    const next = pts[i + 1] ? pts[i + 1].t - pts[i].t : (i ? pts[i].t - pts[i - 1].t : 60e3);
    const w = Math.min(CAP, Math.max(0, next));
    zones[zoneOf(pts[i].v, maxHr)] += w;
    wSum += w; vSum += w * pts[i].v; peak = Math.max(peak, pts[i].v);
  }
  for (const k in zones) zones[k] = Math.round(zones[k] / 6000) / 10;      // ms -> minutes, one decimal
  const avg = wSum ? vSum / wSum : pts.reduce((s, p) => s + p.v, 0) / pts.length;
  return { avg_hr: Math.round(avg), max_hr: Math.round(peak), zones };
}

function cleanWorkout(x, maxHr){
  if (!x || typeof x !== 'object') return null;
  const a = toMs(x.start ?? x.startDate), b0 = toMs(x.end ?? x.endDate);
  if (a == null) return null;
  const b = b0 != null && b0 > a && b0 - a < 12 * 3600e3 ? b0 : null;
  let dur = clampNum(x.duration_min, 1, 600);
  if (dur == null && b != null) dur = (b - a) / 60000;
  if (dur == null || dur < 1) return null;           // a tap on the start button is not a workout
  let km = clampNum(x.distance_km, 0, 300);
  if (km == null){ const m = clampNum(x.distance_m, 0, 300000); if (m != null) km = m / 1000; }

  const hr = Array.isArray(x.hr) ? x.hr : Array.isArray(x.hr_samples) ? x.hr_samples : [];
  const st = hr.length ? hrStats(hr, a, b ?? a + dur * 60000, maxHr) : null;
  // the watch's own figures win when it sent them; the samples fill what it did not
  const avg = clampNum(x.avg_hr, 30, 240), max = clampNum(x.max_hr, 30, 240);
  return {
    id: workoutId(a),
    start: isoOf(a),
    end: isoOf(b ?? a + dur * 60000),
    type: typeOf(x.type ?? x.name),
    duration_min: Math.round(dur * 10) / 10,
    distance_km: km == null ? null : Math.round(km * 100) / 100,
    avg_hr: avg != null ? Math.round(avg) : st ? st.avg_hr : null,
    max_hr: max != null ? Math.round(max) : st ? st.max_hr : null,
    zones: st ? st.zones : null
  };
}

/* ---------- the whole payload ---------- */

// -> { nights:[...], workouts:[...] }, both possibly empty.
function normalize(body, { maxHr = MAX_HR_DEFAULT, tz = 'Asia/Riyadh' } = {}){
  const b = body && typeof body === 'object' ? body : {};
  const mh = clampNum(maxHr, 120, 230) || MAX_HR_DEFAULT;

  const nights = new Map();
  if (Array.isArray(b.sleep)) for (const n of nightsFromSamples(b.sleep, tz)) nights.set(n.night_of, n);
  // a night summed up by the Shortcut beats one rebuilt from samples
  if (Array.isArray(b.nights)) for (const x of b.nights.slice(0, LIMITS.nights)){
    const n = cleanNight(x, tz); if (n) nights.set(n.night_of, n);
  }
  const list = [...nights.values()].sort((x, y) => x.night_of.localeCompare(y.night_of)).slice(-LIMITS.nights);

  // a resting value sent on its own belongs to the most recent night
  const rest = restingFrom(b.resting_hr);
  if (rest != null && list.length && list[list.length - 1].resting_hr == null) list[list.length - 1].resting_hr = rest;

  const seen = new Set(), workouts = [];
  if (Array.isArray(b.workouts)) for (const x of b.workouts.slice(0, LIMITS.workouts)){
    const w = cleanWorkout(x, mh);
    if (w && !seen.has(w.id)){ seen.add(w.id); workouts.push(w); }
  }
  return { nights: list, workouts };
}

module.exports = { normalize, toNum, toMs, stageOf, typeOf, unionMin, hrStats, workoutId, MAX_HR_DEFAULT };
