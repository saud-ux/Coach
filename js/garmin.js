// garmin.js — a session written as a Garmin structured workout.
//
// Garmin does not let a website send workouts to the watch (that needs its
// developer programme), so the app shows each session as the exact steps to
// enter once in Garmin Connect: Training → Workouts → Create → Running. Saved
// there, the watch counts down every step, buzzes on each change («Run»,
// «Recover»), and moves on by itself.
//
// Every step is timed rather than measured by distance: GPS cannot tell 20 m
// from 30 m, but a 5-second sprint is a 20-metre sprint at 90%. The times come
// from the distances in the session (js/figures.js) at match pace, and ARIET uses
// its own test times (75 m in 15 s, 25 m walk in 18 s).
//
// Jump drills cannot be timed, so the yoyo day keeps them as one Lap step done
// from the phone, and the watch times only the running.
//
// A step: { k, sec, zone, label }
//   k     warmup | run | recover | rest | cooldown | other   (Garmin's step types)
//   sec   duration in seconds; null means «Lap Button Press»
//   zone  heart-rate zone target, or null for none
// A repeat: { k:'repeat', times, steps:[...] }

// The names the referee saved the workouts under in Garmin Connect, so the app can
// say which one to start on the watch. Fixed: the weekly numbers change inside the
// saved workout, never its name.
export const WATCH_NAME = {
  intervals: 'حكم | سرعات',
  yoyo: 'حكم | ارتدادات وتحمّل',
  run: 'حكم | تحمّل',
  light: 'حكم | تنشيط',
  test: 'حكم | اختبار 12',
};

export const KIND = {
  warmup:   { ar: 'إحماء',   en: 'Warm Up' },
  run:      { ar: 'جري',     en: 'Run' },
  recover:  { ar: 'استشفاء', en: 'Recover' },
  rest:     { ar: 'راحة',    en: 'Rest' },
  cooldown: { ar: 'تبريد',   en: 'Cool Down' },
  other:    { ar: 'حركة',    en: 'Other' },
};

const st = (k, sec, label, zone = null) => ({ k, sec, zone, label });
const rep = (times, ...steps) => ({ k: 'repeat', times, steps });

// p: weekParams(date) — run minutes, sprint count (sp), ARIET reps (ar), light week
export function watchWorkout(type, p){
  p = p || {};
  const sp = p.sp || 6;
  switch (type){
    case 'intervals': return {
      name: WATCH_NAME.intervals,
      steps: [
        st('warmup', 600, 'ركض خفيف وخطوات جانبية', 1),
        rep(sp, st('run', 5, 'سرعة 20 م بجهد 90%'), st('recover', 30, 'رجوع مشي')),
        st('rest', 120, 'راحة'),
        rep(sp, st('run', 10, '8 م جانبي ثم 20 م سرعة'), st('recover', 30, 'مشي')),
        st('rest', 120, 'راحة'),
        rep(sp, st('run', 8, '5 م للخلف ثم 10 م سرعة'), st('recover', 30, 'مشي')),
        st('rest', 180, 'راحة أطول قبل تغيير الاتجاه'),
        rep(p.light ? 2 : 4, st('run', 15, 'تغيير الاتجاه: أمام، جانبي، جانبي، أمام'), st('recover', 45, 'مشي')),
        st('cooldown', 300, 'مشي وإطالات'),
      ]};
    case 'yoyo': return {
      // the jumps cannot be timed, so they are one step ended with Lap: done from
      // the phone's pictures, then the watch takes over for the running parts
      name: WATCH_NAME.yoyo,
      steps: [
        st('warmup', 600, 'ركض خفيف وحركات كاحل', 1),
        st('other', null, 'تمارين القفز من الجوال، واضغط Lap لما تخلص'),
        st('rest', 120, 'راحة'),
        rep(8, st('run', 4, 'رد فعل: انطلق 5 م'), st('recover', 20, 'رجوع للوسط')),
        st('rest', 120, 'راحة قبل التحمّل'),
        rep((p.ar || 6) * 2, st('run', 15, '75 م بجهد 80–85%'), st('recover', 18, '25 م مشي')),
        st('cooldown', 300, 'مشي وإطالات'),
      ]};
    case 'run': {
      const total = p.run || 30;
      return {
        name: WATCH_NAME.run,
        steps: [
          st('warmup', 300, 'أبطأ من وتيرتك', 1),
          st('run', Math.max(5, total - 10) * 60, 'وتيرة مريحة تقدر تتكلم فيها', 2),
          st('cooldown', 300, 'مشي'),
        ]};
    }
    case 'light': return {
      name: WATCH_NAME.light,
      steps: [
        st('run', 900, 'ركض هادي بجهد 50%', 1),
        st('other', 300, 'إطالات حركية'),
      ]};
    case 'test': return {
      name: WATCH_NAME.test,
      steps: [
        st('warmup', 600, 'إحماء', 1),
        st('run', 720, 'أقصى وتيرة تقدر تحافظ عليها'),
        st('cooldown', 300, 'مشي'),
      ]};
    default: return null;        // strength, rest, recovery, match: nothing for the watch to time
  }
}

// total seconds, with lap-button steps counted at a rough 20 s each
export function totalSec(steps){
  return steps.reduce((a, s) => a + (s.k === 'repeat' ? s.times * totalSec(s.steps) : (s.sec ?? 20)), 0);
}
export const clockOf = sec => sec == null ? 'زر Lap'
  : sec < 60 ? `${sec} ث` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
