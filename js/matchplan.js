// matchplan.js — the match-day plan: what to do from the night before to the
// morning after, timed from kickoff.
//
// One source for two readers. Today draws it as a timeline (js/today.js), and the
// server's cron imports this same file to send each step as a push (server.js),
// so the times on screen and the times the phone buzzes cannot drift apart. It is
// pure on purpose: no DOM, no state, nothing the server cannot load.
//
// A step: { key, day, min, title, body, push }
//   day   -1 the evening before, 0 match day, 1 the morning after
//   min   minutes past midnight on that day
//   push  false for steps the cron already covers another way: "kit" is the
//         existing «قبل المباراة» reminder (its own lead time, written by the
//         coach), and kickoff needs no notification.
//
// An away match carries match.travel = { mode: 'car'|'plane', hours, stay }:
// hours is door to stadium (the airport included for a flight), stay is a night
// there after the match. travelPlan() times the trip back from arriving at the
// stadium 90 minutes before kickoff; a start before 8 am, or a drive over five
// hours, moves the trip to the day before. Its steps (keys tr_*) join the plan
// and the meal moves before the departure.

const toMin = hhmm => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };

export const TRAVEL_MODES = { car: 'سيارة', plane: 'طيران' };
const ARRIVE = 90;                     // at the stadium, minutes before kickoff
const BUFFER = 30;                     // slack on the road
// a minute count past midnight on `day`, carried into the next day when it spills over
const at = (day, min) => ({ day: day + Math.floor(min / 1440), min: ((min % 1440) + 1440) % 1440 });
const hm = min => `${Math.floor(min / 60) % 24}:${String(min % 60).padStart(2, '0')}`;
function hoursText(h){
  const w = Math.floor(h), half = h - w >= 0.5;
  if (!w) return 'نص ساعة';
  const base = w === 1 ? 'ساعة' : w === 2 ? 'ساعتين' : `${w} ساعات`;
  return half ? base + ' ونص' : base;
}

// -> null, or { mode, hours, stay, early, leave:{day,min}, arrive:{day,min}, back:{day,min}, backHome:{day,min}|null, late }
export function travelPlan(match){
  const tr = match && match.travel, K = toMin(match && match.time);
  const hours = tr && Number(tr.hours);
  if (!tr || !TRAVEL_MODES[tr.mode] || !(hours > 0 && hours <= 16) || K == null) return null;
  const door = Math.round(hours * 60);
  const same = K - ARRIVE - door - BUFFER;
  const early = same < 8 * 60 || (tr.mode === 'car' && hours > 5);    // a long drive is split by a night; a flight only by the clock
  // the day before: be there by 8 pm, leaving no earlier than 8 am
  const leave = early ? at(-1, Math.max(8 * 60, 20 * 60 - door - BUFFER)) : at(0, same);
  const arrive = early ? at(leave.day, leave.min + door + BUFFER) : at(0, K - ARRIVE);
  // after the match: 105 minutes of play and 45 for the crew's debrief
  const back = tr.stay ? at(1, 11 * 60) : at(0, K + 150);
  const backHome = tr.stay ? null : at(back.day, back.min + door);
  const late = !!backHome && (backHome.day > 0 && backHome.min >= 60);    // home after 1 am
  return { mode: tr.mode, hours, stay: !!tr.stay, airport: tr.airport || '', early, leave, arrive, back, backHome, late };
}

export function planSteps(match, kitBefore = 120){
  const K = toMin(match && match.time);
  if (K == null) return [];
  const clamp = (m, lo) => Math.max(lo, m);
  const tp = travelPlan(match);
  const steps = [
    { key: 'sleep', day: -1, min: 22 * 60 + 30, push: true, title: 'نم بدري',
      body: tp && tp.early ? 'نم بدري في السكن. جيب سدادة أذن وغطاء عيون، وخلّ المكيف معتدل.'
        : 'بكرة مباراة. نم بدري الليلة وخلّ الجوال بعيد عن السرير.' },
    { key: 'water', day: 0, min: clamp(Math.min(9 * 60, K - 300), 6 * 60), push: true, title: 'ابدأ الترطيب',
      body: 'اشرب 500 مل ماء الحين، وكوب مع كل وجبة لين المباراة.' },
    { key: 'meal', day: 0, min: clamp(K - 240, 6 * 60 + 30), push: true, title: 'الوجبة الرئيسية',
      body: 'وجبتك الرئيسية الحين: رز أو مكرونة مع بروتين خفيف. خفّف الدهون والمقليات.' },
    { key: 'kit', day: 0, min: K - kitBefore, push: false, title: 'ماء وتجهيز',
      body: 'اشرب 500 مل وجهّز أغراضك: الراية، الساعة مشحونة، ملابس احتياط.' },
    { key: 'warm', day: 0, min: K - 45, push: true, title: 'الإحماء',
      body: 'ابدأ الإحماء: 10 دقائق جري خفيف، ثم حركات جانبية وسرعات قصيرة ووقفات تسلل.' },
    { key: 'kickoff', day: 0, min: K, push: false, title: 'صافرة البداية',
      body: 'الله يوفقك.' },
    { key: 'recover', day: 1, min: tp && tp.late ? 11 * 60 : 10 * 60, push: true, title: 'صباح الاستشفاء',
      body: 'مشي 20 دقيقة وإطالات، واشرب كثير. وقيّم مباراة أمس من الجدول.' },
  ];
  return tp ? withTravel(steps, tp) : steps;
}

function withTravel(steps, tp){
  const L = tp.leave, road = hoursText(tp.hours), byCar = tp.mode === 'car';
  // the main meal is eaten before a same-day departure, never on the road
  const meal = steps.find(s => s.key === 'meal');
  if (!tp.early && meal && meal.min > L.min - 45){
    meal.min = Math.max(6 * 60 + 30, L.min - 60);
    meal.body = `كل وجبتك الرئيسية الحين قبل تطلع: رز أو مكرونة مع بروتين خفيف. بعدها الطريق ${road}.`;
  }
  // the kit reminder can fall on the road: nothing to pack there, only water
  const kit = steps.find(s => s.key === 'kit');
  if (!tp.early && kit && kit.min > L.min && kit.min < tp.arrive.min) kit.body = 'اشرب 500 مل ماء. أغراضك جاهزة بالشنطة.';
  const add = (key, p, title, body) => steps.push({ key, day: p.day, min: p.min, push: true, title, body });
  add('tr_pack', at(L.day, tp.early ? L.min - 90 : -150), 'جهّز شنطة السفر',
    `بكرة${tp.early ? '' : ' الصبح'} سفر. حط بالشنطة: طقمين، الراية، شاحن الساعة، الهوية، قارورة ماء، وتمر أو موز.`);
  add('tr_leave', L, byCar ? 'وقت الطلعة' : `اطلع ${tp.airport ? 'لمطار ' + tp.airport : 'للمطار'}`,
    byCar ? `اطلع الحين، الطريق ${road}. ${tp.hours >= 2 ? 'وقف كل ساعتين وامشِ 5 دقائق تفك رجولك، ' : ''}خلّ الماء جنبك واشرب بالطريق.`
      : `اطلع الحين${tp.airport ? ' لمطار ' + tp.airport : ''}، وكن هناك قبل الإقلاع بساعة ونص. في الطيارة قم وامشِ كل ساعة، واشرب كوب ماء كل ساعة، والبس جوارب ضاغطة إذا عندك.`);
  if (tp.hours >= 2.5) add('tr_snack', at(L.day, L.min + Math.round(tp.hours * 30)), 'سناك الطريق',
    'نص الطريق: كل موزة أو تمر واشرب كوب ماء. لا تاكل أكل ثقيل.');
  if (tp.early) add('tr_arrive', tp.arrive, 'وصلت السكن؟',
    'امشِ 15 دقيقة تفك رجولك من الطريق، وتعشّ خفيف، وجهّز ملابس بكرة.');
  add('tr_back', tp.back, 'الرجعة',
    tp.stay ? 'قبل تطلع امشِ 20 دقيقة وتمدد. في الطريق وقف كل ساعتين، واشرب كثير.'
      : `كل وجبة واشرب قبل تطلع. ${byCar ? 'إذا حسيت بنعاس وقف ونام 20 دقيقة، لا تكمل وأنت تعبان.' : 'خذ معك ماء وسناك للرحلة.'}`
        + (tp.late ? ` بتوصل البيت تقريبًا ${hm(tp.backHome.min)}، فكّر تنام هناك وترجع الصبح.` : ''));
  return steps.sort((a, b) => a.day - b.day || a.min - b.min);
}

// "YYYY-MM-DD" plus n days, in plain calendar arithmetic (no timezone involved).
export function shiftDate(date, n){
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
