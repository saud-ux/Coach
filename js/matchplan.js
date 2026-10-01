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

const toMin = hhmm => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };

export function planSteps(match, kitBefore = 120){
  const K = toMin(match && match.time);
  if (K == null) return [];
  const clamp = (m, lo) => Math.max(lo, m);
  return [
    { key: 'sleep', day: -1, min: 22 * 60 + 30, push: true, title: 'نم بدري',
      body: 'بكرة مباراة. نم بدري الليلة وخلّ الجوال بعيد عن السرير.' },
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
    { key: 'recover', day: 1, min: 10 * 60, push: true, title: 'صباح الاستشفاء',
      body: 'مشي 20 دقيقة وإطالات، واشرب كثير. وقيّم مباراة أمس من الجدول.' },
  ];
}

// "YYYY-MM-DD" plus n days, in plain calendar arithmetic (no timezone involved).
export function shiftDate(date, n){
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
