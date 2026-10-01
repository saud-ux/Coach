// nudges.js — the small reminders through the day: drink water, and walk until
// the steps target is closed.
//
// The cron (server.js) calls slotsDue() on every tick. Only when a steps slot is
// due does it read today's steps, then compose() turns the due slots into at most
// one push, so water and steps landing on the same tick do not buzz twice.
//
// Steps reach the server only when the Shortcut runs, so a count read at 12:00
// may be from the morning. A count older than two hours is said as such
// («حسب آخر مزامنة…»), never passed off as now. Pure functions, no I/O.

const STEPS_TARGET = 8000;
const DAY_START = 7 * 60, DAY_END = 21 * 60;     // the walking day the pace is spread over

const toMin = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };
const clock = min => { const h = Math.floor(min / 60), m = min % 60, h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; };
const fmt = n => Math.round(n).toLocaleString('en-US');
const minutesIn = (ms, tz) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = t => Number((p.find(x => x.type === t) || {}).value); return g('hour') * 60 + g('minute'); };

const WATER = [
  'اشرب كوب ماء الحين. جسمك يشتغل أحسن وهو مترطب.',
  'وقت الماء. كوب واحد يكفي الحين.',
  'لا تنتظر العطش. اشرب كوب ماء.',
  'كوب ماء الحين، ورجولك تشكرك بالتمرين.',
];

// Which slots fall inside this tick. water: every `every` hours from `from` to
// `to`; steps: the listed times. Match days drop the steps nudges (the match is
// the walking), and water goes quiet from an hour before kickoff to two after,
// where the match-day plan already speaks.
function slotsDue(now, prefs, matches, within){
  const out = { water: null, steps: null };
  const K = (matches || []).filter(m => m.date === now.date && m.time).map(m => toMin(m.time)).find(x => x != null);
  const w = prefs.water || {};
  if (w.on){
    const every = Math.max(60, Math.min(240, Number(w.every || 2) * 60));
    const from = toMin(w.from) ?? 9 * 60, to = toMin(w.to) ?? 21 * 60;
    for (let t = from; t <= to; t += every){
      if (K != null && t >= K - 60 && t <= K + 120) continue;
      if (within(t)) { out.water = t; break; }
    }
  }
  const s = prefs.steps || {};
  if (s.on && K == null){
    for (const hh of (Array.isArray(s.times) ? s.times : [])){
      const t = toMin(hh);
      if (t != null && within(t)) { out.steps = t; break; }
    }
  }
  return out;
}

// The steps line, or null when there is nothing worth saying (target closed, or
// on pace with fresh data).
function stepsLine(slot, steps, lastAt, nowMs, tz = 'Asia/Riyadh', target = STEPS_TARGET){
  if (steps == null) return 'ما وصلتني خطواتك اليوم. قوم تمشّى 10 دقايق، وشغّل «مزامنة الساعة» عشان أتابع معك.';
  if (steps >= target) return null;
  const left = target - steps;
  const walk = Math.max(10, Math.min(60, Math.ceil(left / 100 / 5) * 5));     // ~100 steps a minute, in 5s
  const fresh = lastAt && nowMs - Date.parse(lastAt) < 2 * 3600e3;
  if (!fresh){
    const when = lastAt ? clock(minutesIn(Date.parse(lastAt), tz)) : null;
    return `${when ? `حسب آخر مزامنة (${when})` : 'حسب آخر مزامنة'} كنت على ${fmt(steps)} خطوة، وباقي ${fmt(left)} على هدف ${fmt(target)}. قوم تمشّى شوي.`;
  }
  const pace = target * Math.max(0, Math.min(1, (slot - DAY_START) / (DAY_END - DAY_START)));
  if (steps >= 0.9 * pace) return null;
  return `مشيت ${fmt(steps)} خطوة لين الحين، وباقي ${fmt(left)} على هدف ${fmt(target)}. مشي ${walk >= 60 ? 'ساعة' : walk + ' دقيقة'} يقربك منه.`;
}

// -> { keys, title, body } or null. A combined push claims both keys, so a later
// tick in the same window cannot send the water half again on its own.
function compose(due, date, slotSteps){
  const water = due.water != null ? WATER[Math.floor(due.water / 60) % WATER.length] : null;
  const steps = due.steps != null ? slotSteps : null;
  const wk = `water:${date}:${due.water}`, sk = `steps:${date}:${due.steps}`;
  if (water && steps) return { keys: [sk, wk], title: 'ماء وخطوات', body: `${steps} واشرب كوب ماء.` };
  if (steps) return { keys: [sk], title: 'الخطوات', body: steps };
  if (water) return { keys: [wk], title: 'اشرب ماء', body: water };
  return null;
}

module.exports = { slotsDue, stepsLine, compose, STEPS_TARGET };
