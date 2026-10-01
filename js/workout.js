// workout.js — the Workout Summary screen, «وصل تمرينك من الساعة».
//
// A workout arrives from the watch with duration, distance and heart-rate data
// but no sense of how hard it felt. This screen shows what the watch measured and
// asks the one thing only the referee knows, then writes the result into
// state.logs[date] exactly where a hand-logged session would go.
//
// THE 1-10 ANSWER IS NOT STORED RAW. dayLoad() computes
//   load = minutes x RPE[effort]   with   RPE = [0,2,4,6,8,10]  indexed 1..5
// so every past ACWR figure is built on a 1-5 scale. The picker maps onto it with
// Math.round(answer/2) clamped to 1..5, which is the exact inverse of that table:
// a 10 becomes 5 (x10), an 8 becomes 4 (x8), and so on. The raw answer is kept
// beside it as `rpe10` for later, but nothing computes load from that field.

import { state, save, num, parse, todayISO, fFull, $ } from './state.js';
import { ring, ringWith, icon, hhmm, clock12 } from './ui.js';
import { workoutById, confirmWorkout, hrLoad, recoveryBand, recoveryUsual } from './health.js';
import { RPE, dayLoad } from './progress.js';
import { defDur } from './schedule.js';
import { openSheet, closeSheet, renderAll } from './main.js';

/* ---------- the mapping, in one place ---------- */
export const effortFrom10 = n => Math.max(1, Math.min(5, Math.round(Number(n) / 2)));

const TYPE_AR = {
  running: 'جري', run: 'جري', walking: 'مشي', walk: 'مشي',
  cycling: 'دراجة', strength: 'قوة', hiit: 'سرعات', football: 'كرة قدم',
  soccer: 'كرة قدم', other: 'تمرين'
};

// Zones are a share of max HR. Only 2..5 are shown: zone 1 is standing around.
const ZONES = [
  { k: 'z5', label: 'المنطقة 5', sub: '90%+',   color: 'var(--max)' },
  { k: 'z4', label: 'المنطقة 4', sub: '80–90%', color: 'var(--effort)' },
  { k: 'z3', label: 'المنطقة 3', sub: '70–80%', color: 'var(--match)' },
  { k: 'z2', label: 'المنطقة 2', sub: '60–70%', color: 'var(--ready)' },
];

const dateOfWorkout = w => (w.start ? new Date(w.start) : new Date());
const isoOf = w => {
  const d = dateOfWorkout(w);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export function openWorkout(id){
  const w = workoutById(id);
  if (!w) return;

  const date = isoOf(w);
  const existing = state.logs[date] || {};
  // start from whatever is already recorded for that day, so reopening the screen
  // does not silently reset an answer
  let pick = existing.rpe10 || (existing.effort ? existing.effort * 2 : null);

  openSheet(sh => {
    const draw = () => {
      const effort = pick ? effortFrom10(pick) : null;
      const mins = Math.round(w.duration_min || 0);
      // the heart rate measures the load when the zones cover the session; the
      // felt effort is then a second opinion shown beside it, not the number
      const hl = hrLoad(w);
      const felt = effort ? mins * RPE[effort] : 0;
      const load = hl ?? felt;
      // the ring is scaled against a hard hour: 60 min at RPE 10 = 600 points
      const loadPct = Math.min(1, load / 600);

      const zoneTotal = ZONES.reduce((a, z) => a + ((w.zones && w.zones[z.k]) || 0), 0);
      const typeAr = TYPE_AR[String(w.type || '').toLowerCase()] || 'تمرين';

      sh.innerHTML = `
        <header class="whead">
          <button class="iconbtn" id="wBack" aria-label="رجوع">${icon('back')}</button>
          <div>
            <h2>وصل تمرينك من الساعة</h2>
            <p class="wsub">${fFull.format(parse(date))} · ${clock12(dateOfWorkout(w))} · ${typeAr}</p>
          </div>
        </header>

        <div class="wring">
          ${ringWith({ size:180, pct:loadPct, color:'var(--effort)', width:14 },
            `<span class="ringlabel">${icon('bolt')} حمل الحصة</span>
             <b class="ringnum">${hl != null || effort ? num(load) : '–'}</b>
             <span class="ringsub">${hl != null ? 'نقطة من نبضك' : effort ? 'نقطة' : 'حدّد مجهودك'}</span>`)}
        </div>
        ${hl != null && effort ? `<p class="snote" style="text-align:center">إحساسك يقول ${num(felt)} نقطة · ${
          Math.abs(felt - hl) <= 0.2 * hl ? 'قريب من نبضك' : felt > hl ? 'حسيته أصعب مما قال نبضك' : 'نبضك يقول إنه أصعب مما حسيت'}</p>` : ''}

        <div class="wstats">
          <div class="card wstat"><span>${icon('clock')}</span><b>${hhmm(mins)}</b><small>المدة</small></div>
          <div class="card wstat"><span>${icon('route')}</span><b>${w.distance_km != null ? num(Number(w.distance_km).toFixed(1)) : '–'}</b><small>كم</small></div>
          <div class="card wstat"><span>${icon('heart')}</span><b>${w.avg_hr != null ? num(Math.round(w.avg_hr)) : '–'}</b><small>متوسط النبض</small></div>
          <div class="card wstat"><span>${icon('spark')}</span><b>${w.max_hr != null ? num(Math.round(w.max_hr)) : '–'}</b><small>أعلى نبض</small></div>
        </div>

        ${recoveryHTML(w)}

        <section class="card zones">
          <h3>مناطق النبض</h3>
          ${zoneTotal ? ZONES.map(z => {
            const v = (w.zones && w.zones[z.k]) || 0;
            return `<div class="zrow">
              <span class="zlab">${z.label}<small>${z.sub}</small></span>
              <span class="zbar"><i style="width:${Math.round(100*v/zoneTotal)}%;background:${z.color}"></i></span>
              <span class="zmin">${v ? num(Math.round(v)) + ' د' : '–'}</span>
            </div>`;
          }).join('') : '<p class="snote">ما وصلت قراءات نبض لهذي الحصة.</p>'}
        </section>

        <section class="card picker">
          <h3>كيف حسيت بالمجهود؟</h3>
          <div class="p10" role="group" aria-label="من 1 إلى 10">
            ${Array.from({length:10}, (_,i) => i+1).map(n =>
              `<button class="p10b${pick === n ? ' on' : ''}" data-n="${n}" aria-pressed="${pick === n}">${num(n)}</button>`).join('')}
          </div>
          <div class="p10ends"><span>سهل جدًا</span><span>أقصى مجهود</span></div>
        </section>

        <button class="btn primary wide" id="wSave" ${pick ? '' : 'disabled'}>أكّد وسجّل</button>`;

      sh.querySelector('#wBack').onclick = closeSheet;
      sh.querySelectorAll('.p10b').forEach(b => b.onclick = () => { pick = +b.dataset.n; draw(); });
      sh.querySelector('#wSave').onclick = () => {
        if (!pick) return;
        const effort = effortFrom10(pick);
        state.logs[date] = {
          ...existing,
          done: true,
          effort,                                   // the 1-5 value dayLoad() reads
          rpe10: pick,                              // the raw answer, for later
          dur: mins || existing.dur || defDur(date, state.sessions[date]),
          note: existing.note || '',
          hr_load: hl, zones: w.zones || existing.zones || null, effort_est: false,
          distance: w.distance_km ?? existing.distance ?? null,
          avg_hr: w.avg_hr ?? existing.avg_hr ?? null,
          max_hr: w.max_hr ?? existing.max_hr ?? null,
          source: 'watch'
        };
        confirmWorkout(w.id);
        save();
        closeSheet();
        renderAll();
      };
    };
    draw();
  }, { bare: true });
}

// The pulse's fall in the first minute after stopping, against the referee's own
// recent average. Shown only when the Shortcut sent heart rate past the end.
function recoveryHTML(w){
  const band = recoveryBand(w.hr_recovery);
  if (!band) return '';
  const usual = recoveryUsual(w.id);
  const vs = usual == null ? 'بعد كم تمرين بقارنه بمعدلك.'
    : w.hr_recovery - usual >= 4 ? `أحسن من معدلك (${num(usual)}). قلبك يرجع أسرع، وهذي علامة لياقة.`
    : usual - w.hr_recovery >= 4 ? `أقل من معدلك (${num(usual)}). ممكن تعب متراكم، أو إنك مشيت بدل ما توقف.`
    : `قريب من معدلك (${num(usual)}).`;
  return `<section class="card hrr">
    <span class="hrrn">${num(w.hr_recovery)}<small>نبضة</small></span>
    <div><b>رجوع النبض في أول دقيقة<span class="hrrtag ${band.cls}">${band.word}</span></b>
      <p>${vs}</p></div>
  </section>`;
}
