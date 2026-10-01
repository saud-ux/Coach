// today.js — the day in a few spoken sentences, for Siri.
//
// GET /api/today (server.js) answers with this text, and a Shortcut named after
// the Siri phrase («وش تمريني اليوم») reads it out: Get Contents of URL, then
// Speak Text. Written for the ear, not the screen: whole words for the clock
// («7:30 مساءً», never «م»), no emoji, no ranges written with a dash.
//
// It reads what the app already wrote (the plan, the readiness answers, the
// matches) and last night from the health tables. It never writes anything.

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const toMin = hhmm => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };
function shift(date, n){
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayName(date){
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
// 19:30 -> «7:30 مساءً»; 12:15 -> «12:15 ظهرًا»
function spokenClock(min){
  const h = Math.floor(min / 60) % 24, m = min % 60, h12 = h % 12 || 12;
  const part = h < 12 ? 'صباحًا' : h < 15 ? 'ظهرًا' : 'مساءً';
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${part}`;
}
function hoursAr(n){
  if (n === 1) return 'ساعة';
  if (n === 2) return 'ساعتين';
  return `${n} ${n <= 10 ? 'ساعات' : 'ساعة'}`;
}
function duration(min){
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} دقيقة`;
  return m ? `${hoursAr(h)} و${m} دقيقة` : hoursAr(h);
}
// the first sentence of a session's details, made speakable
function firstLine(details){
  const line = String(details || '').split('\n').map(s => s.replace(/^[•\-\s]+/, '').trim()).find(Boolean) || '';
  const first = line.split(/(?<=[.!؟])\s/)[0];
  const said = first.replace(/(\d+)\s*[–-]\s*(\d+)/g, '$1 إلى $2')
    .replace(/\s*×\s*/g, ' في ')
    .replace(/\s*\([^)]*\)/g, '').replace(/[\s:،,]+$/, '').replace(/[،,]?\s*ثم$/, '').slice(0, 160);
  return said && !/[.!؟]$/.test(said) ? said + '.' : said;
}
const sleepTo5 = s => 1 + 4 * Math.max(0, Math.min(100, s)) / 100;
const readyNow = r => r.sleep_watch == null ? (r.sleep + r.sore + r.energy) / 3
  : ((r.sleep + sleepTo5(r.sleep_watch)) / 2 + r.sore + r.energy) / 3;

// data: the app's state row; nights and days: rows from coach_health_get; now:
// {date, min} in the referee's timezone; planSteps: js/matchplan.js's, when loaded.
function brief(data, nights, now, planSteps, days){
  const d = data || {}, t = now.date;
  const sessions = d.sessions || {}, logs = d.logs || {}, readiness = d.readiness || {}, matches = d.matches || [];
  const name = (d.settings && d.settings.name) || 'سعود';
  const out = [];

  out.push(now.min < 12 * 60 ? `صباح الخير يا ${name}.` : `مساء الخير يا ${name}.`);

  // last night: filed under the evening it began
  const night = (nights || []).find(n => n.night_of === shift(t, -1));
  if (night && night.asleep_min) out.push(`نمت ${duration(night.asleep_min)}.`);
  const yd = (days || []).find(x => x.day === shift(t, -1));
  if (yd && yd.steps) out.push(`وأمس مشيت ${yd.steps} خطوة.`);

  const r = readiness[t];
  if (r && r.sleep && r.sore && r.energy) out.push(`جاهزيتك اليوم ${Math.round(readyNow(r) / 5 * 100)} بالمية.`);
  else if (now.min < 15 * 60) out.push('ما عبّيت فحص الجاهزية للحين.');

  const matchToday = matches.find(m => m.date === t && m.time);
  const teams = m => m.home && m.away ? `، ${m.home} ضد ${m.away}` : (m.home || m.away) ? `، ${m.home || m.away}` : '';
  const s = sessions[t], done = !!(logs[t] && logs[t].done);
  if (matchToday){
    const K = toMin(matchToday.time);
    out.push(`اليوم عندك مباراة الساعة ${spokenClock(K)}${teams(matchToday)}.`);
    if (planSteps){
      const kit = Number((((d.push || {}).prefs || {}).match || {}).before) || 120;   // the cron's own lead time
      const next = planSteps(matchToday, kit).find(x => x.day === 0 && x.min >= now.min - 10 && x.key !== 'kickoff');
      if (next) out.push(`الخطوة الجاية الساعة ${spokenClock(next.min)}: ${next.title}. ${next.body}`);
    }
  } else if (!s || s.type === 'rest'){
    out.push('اليوم راحة. مشي خفيف وإطالات إذا حبيت.');
  } else if (done){
    out.push(`تمرين اليوم ${s.title}، وخلّصته. الله يعطيك العافية.`);
  } else {
    out.push(`تمرين اليوم: ${s.title}.`);
    const more = firstLine(s.details);
    if (more) out.push(more);
  }

  // what comes next on the match calendar
  if (!matchToday){
    const next = matches.filter(m => m.date > t).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next && next.date === shift(t, 1)){
      out.push(`وبكرة عندك مباراة${next.time ? ' الساعة ' + spokenClock(toMin(next.time)) : ''}${teams(next)}، فنم بدري الليلة.`);
      // an away match whose trip starts today
      const leave = planSteps && planSteps(next).find(x => x.key === 'tr_leave' && x.day === -1);
      if (leave) out.push(`والسفر اليوم، اطلع الساعة ${spokenClock(leave.min)}.`);
    }
    else if (next && next.date <= shift(t, 14))
      out.push(`مباراتك الجاية يوم ${dayName(next.date)}${teams(next)}.`);
  }
  const y = matches.find(m => m.date === shift(t, -1));
  if (y && !(logs[y.date] && logs[y.date].done)) out.push('ولا تنسى تقيّم مباراة أمس.');

  // the plan's own text can carry Arabic-Indic digits; the app shows Western ones everywhere
  return out.join(' ').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/٪/g, '%');
}

module.exports = { brief, spokenClock, duration, firstLine };
