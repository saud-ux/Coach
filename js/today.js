// today.js — the Today screen and the settings sheet.
//
// Top to bottom: header, the sleep hero, two small tiles (readiness and load),
// an unconfirmed watch workout if one arrived, today's session, and the next
// match. The inbox, the daily quiz and the alert stack used to live here; they
// moved to الجدول, التقدم -> القانون, and the coach line respectively.
//
// Both sheets here build their own markup every time they open. Nothing moves a
// live element into a sheet, because closing one replaces its contents and the
// element would not survive.

import { state, num, parse, addDays, todayISO, fFull, fDm, AR, $ } from './state.js';
import { ring, ringWith, icon, hhmm, clock12, applyTheme } from './ui.js';
import { TYPES, defDur, openDay, sessionParts, openAddMatch } from './schedule.js';
import { loadStatus } from './progress.js';
import { readyNow, readyPct, renderReady } from './coach.js';
import { lastNightSleep, pendingWorkouts, lastSync, syncHealth, maxHr, MAX_HR_DEFAULT,
         sleepParts, recentNights, nightHistory, restingHrWarning,
         stepsOn, stepsHistory, stepsAverage, stepsNote, STEPS_TARGET, hrvStatus } from './health.js';
import { openWorkout } from './workout.js';
import { initNotifications, renderNotif } from './notifications.js';
import { openSheet, switchTab, renderAll } from './main.js';
import { exportBackup, importBackup } from './storage-sync.js';
import { planSteps, shiftDate } from './matchplan.js';
import { WATCH_NAME } from './garmin.js';

/* ---------- the band: title, three tiles, the week ---------- */
// The header says what today is: the match countdown when one is three days off
// or less, otherwise the kind of day. No greeting.
const DAY_KIND = { intervals: 'يوم سرعات', run: 'يوم تحمّل', strength: 'يوم قوة', yoyo: 'يوم ارتدادات',
  light: 'يوم تنشيط', rest: 'يوم راحة', recovery: 'يوم استشفاء', test: 'يوم الاختبار', match: 'يوم المباراة' };
function dayTitle(){
  const t = todayISO();
  const next = state.matches.filter(m => m.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const days = next ? Math.round((parse(next.date) - parse(t)) / 864e5) : null;
  if (days === 0) return 'يوم المباراة';
  if (days === 1) return 'بكرة مباراة';
  if (days === 2) return 'باقي يومين على المباراة';
  if (days === 3) return 'باقي 3 أيام على المباراة';
  const s = state.sessions[t];
  return (s && DAY_KIND[s.type]) || 'اليوم';
}
function renderTodayHead(){
  const el = $('todayDate');
  if (el) el.textContent = fFull.format(parse(todayISO()));
  const h = $('todayHello');
  if (h) h.textContent = dayTitle();
}


// Readiness, load and steps sit in the band as three equal tiles: the numbers one
// tap away, and the sleep card moves up.
function renderBand(){
  const chips = $('bandChips'), week = $('bandWeek');
  if (!chips || !week) return;
  const t = todayISO(), r = state.readiness[t];
  const pct = r ? readyPct(readyNow(r)) : null;
  const L = loadStatus();
  const word = !L.enough || L.ratio == null ? '' : L.ratio > 1.3 ? 'مرتفع' : L.ratio >= 0.8 ? 'متوازن' : 'منخفض';
  const steps = stepsOn(t);
  // three equal tiles: a small label, the number, and a thin bar for where it sits
  const tile = (id, label, value, sub, pct, color) => `<button class="bchip" id="${id}">
      <small>${label}</small><b>${value}</b><em>${sub || '&nbsp;'}</em>
      <i class="bbar"><i style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%;background:${color}"></i></i></button>`;
  const stepsOk = steps != null || stepsAverage() != null;
  chips.innerHTML =
    tile('chipReady', 'الجاهزية', pct == null ? 'عبّيها' : `${num(pct)}%`,
      pct == null ? 'أقل من دقيقة' : pct >= 80 ? 'جاهز تمامًا' : pct >= 60 ? 'متوسطة' : 'منخفضة', pct ?? 0, '#3BD37F') +
    tile('chipLoad', 'الحمل', L.enough && L.ratio != null ? num(L.ratio.toFixed(2)) : '–', L.enough && L.ratio != null ? word : 'بيانات قليلة',
      L.enough && L.ratio != null ? 100 * L.ratio / 1.6 : 0, '#5DB2F2') +
    (stepsOk ? tile('chipSteps', 'الخطوات', steps != null ? num(steps) : '–', `الهدف ${num(STEPS_TARGET)}`, 100 * (steps || 0) / STEPS_TARGET, '#E7C873') : '');
  $('chipReady').onclick = openReadySheet;
  $('chipLoad').onclick = () => switchTab('prog');
  const cs = $('chipSteps'); if (cs) cs.onclick = openStepsSheet;

  // the week, Sunday first like الجدول; today in gold, a match day outlined
  const DAY = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const ws = addDays(t, -parse(t).getDay());
  week.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), s = state.sessions[d], lg = state.logs[d];
    const isMatch = state.matches.some(m => m.date === d);
    const dot = s && s.type !== 'rest' ? (TYPES[s.type] || TYPES.rest).c : 'rgba(255,255,255,.3)';
    const cls = ['bday', d === t ? 'now' : '', isMatch && d !== t ? 'mt' : '', lg && lg.done && d < t ? 'dn' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-d="${d}" aria-label="${fFull.format(parse(d))}${s ? '، ' + s.title : ''}">
      <small>${d === t ? 'اليوم' : DAY[i]}</small><b>${num(parse(d).getDate())}</b><i style="background:${d === t ? 'currentColor' : dot}"></i></button>`;
  }).join('');
  week.querySelectorAll('.bday').forEach(b => b.onclick = () => openDay(b.dataset.d));
}

/* ---------- sleep hero ---------- */
// One ~176px ring in --sleep carrying the 0-100 score, the total under it, then a
// three-column row of deep sleep / bedtime / resting heart rate, then one centred
// coach line that reacts to the score.
function sleepLine(score, night){
  if (night && night.awake_min >= 45 && score < 70) return 'صحيت كثير بالليل. خفّف اليوم وحاول تنام بدري.';
  if (score >= 85) return 'نومك ممتاز الليلة، جسمك جاهز تمامًا.';
  if (score >= 70) return 'نومك زين. تقدر تاخذ تمرينك عادي اليوم.';
  if (score >= 55) return 'نومك مقبول، بس لا تضغط على نفسك اليوم.';
  return 'نومك قليل الليلة. خذها بهدوء اليوم ونام بدري.';
}

function renderSleep(){
  const box = $('sleepCard');
  if (!box) return;
  const night = lastNightSleep();

  if (!night || night.score == null){
    box.innerHTML = `<section class="card sleep2">
      <div class="sl2top">
        ${ringWith({ size:96, pct:0, color:'var(--sleep)', width:10 }, `<b class="ringnum md dim">–</b><small class="ringcap">النوم</small>`)}
        <div class="sl2facts"><b class="sl2dur">ما وصلت بيانات النوم</b>
          <span class="snote">شغّل اختصار الساعة، أو خلّ قارمن يزامن مع تطبيق الصحة.</span></div>
      </div>
      <button class="sl2line" id="sleepHelp"><span>${icon('info')} كيف أربط ساعتي؟</span><b>الإعدادات ‹</b></button>
    </section>`;
    $('sleepHelp').onclick = () => openSettings('health');
    return;
  }

  // the night's stages as one bar of totals; the watch sends minutes per stage,
  // not their order through the night, so this does not pretend to be a timeline
  let stages = '';
  if (Number.isFinite(night.deep_min)){
    const deep = night.deep_min || 0, rem = night.rem_min || 0, awake = night.awake_min || 0;
    const core = Math.max(0, night.asleep_min - deep - rem);
    stages = `<div class="sl2bar" role="img" aria-label="عميق ${hhmm(deep)}، خفيف ${hhmm(core)}، أحلام ${hhmm(rem)}، صاحي ${hhmm(awake)}">
      ${[[deep,'--st-deep'],[core,'--st-core'],[rem,'--st-rem'],[awake,'--st-awake']].filter(([m]) => m > 0)
        .map(([m, c]) => `<i style="flex:${m};background:var(${c})"></i>`).join('')}</div>`;
  }

  box.innerHTML = `<section class="card sleep2 tappable" id="sleepOpen" role="button" tabindex="0" aria-label="تفاصيل النوم">
    <div class="sl2top">
      ${ringWith({ size:96, pct:night.score/100, color:'var(--sleep)', width:10 },
        `<b class="ringnum md">${num(night.score)}</b><small class="ringcap">النوم</small>`)}
      <div class="sl2facts">
        <b class="sl2dur">${hhmm(night.asleep_min || 0)}</b>
        <div><span>العميق</span><b>${night.deep_min != null ? hhmm(night.deep_min) : '–'}</b></div>
        <div><span>وقت النوم</span><b>${night.in_bed_start ? clock12(new Date(night.in_bed_start)) : '–'}</b></div>
        <div><span>نبض الراحة</span><b>${night.resting_hr != null ? num(night.resting_hr) : '–'}</b></div>
      </div>
    </div>
    ${stages}
    <div class="sl2line"><span>${sleepLine(night.score, night)}</span><b>التفاصيل ‹</b></div>
  </section>`;
  const open = $('sleepOpen');
  open.onclick = () => openSleepSheet(night);
  open.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openSleepSheet(night); } };
}

/* ---------- sleep details ---------- */
// Everything the card summarises, opened from it: the night's times, the stages
// as one stacked bar, how each of the score's four parts was earned, and the last
// seven nights. The breakdown reads sleepParts(), the same function that makes
// the score, so the two can never disagree.
const STAGES = [
  { k: 'deep',  l: 'عميق',  c: 'var(--st-deep)' },
  { k: 'core',  l: 'خفيف',  c: 'var(--st-core)' },
  { k: 'rem',   l: 'أحلام (REM)', c: 'var(--st-rem)' },
  { k: 'awake', l: 'صاحي',  c: 'var(--st-awake)' },
];
const fNight = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const fWdShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short' });

function partText(p, sp, night){
  if (p.k === 'duration') return `${hhmm(night.asleep_min)} من ${hhmm(sp.target)} المطلوبة`;
  if (p.k === 'deep') return p.known ? `${hhmm(night.deep_min)}، يعني ${num(Math.round(100 * sp.deepShare))}% من نومك (الهدف ${num(100 * sp.deepTarget)}% أو أكثر)` : 'الساعة ما أرسلت النوم العميق';
  if (p.k === 'rem') return p.known ? `${hhmm(night.rem_min)}، يعني ${num(Math.round(100 * sp.remShare))}% من نومك (الهدف ${num(Math.round(100 * sp.remTarget))}% أو أكثر)` : 'الساعة ما أرسلت نوم الأحلام';
  if (p.k === 'awake') return p.known ? `صحيت ${hhmm(night.awake_min)} بعد ما نمت (أقل من ساعة أفضل)` : 'الساعة ما أرسلت وقت الاستيقاظ';
  if (!p.known) return `يحتاج 3 ليالي قبلها على الأقل، عندك ${num(sp.nightsForConsistency)}`;
  const d = Math.abs(sp.drift);
  if (d <= 30) return 'نمت في وقتك المعتاد تقريبًا';
  return `نمت ${sp.drift > 0 ? 'بعد' : 'قبل'} وقتك المعتاد بـ ${hhmm(d)}`;
}
const PART_LABEL = { duration: 'مدة النوم', deep: 'النوم العميق', rem: 'نوم الأحلام (REM)', awake: 'الاستيقاظ بالليل', consistency: 'انتظام وقت النوم' };

function sleepTip(night, sp){
  // the part that cost the most points, not the one with the fewest: losing 24
  // of 55 on duration matters more than 15 of 15 on bedtime
  const weakest = sp.parts.filter(p => p.known).sort((a, b) => (1 - b.v) * b.w - (1 - a.v) * a.w)[0];
  if (!weakest || weakest.v >= 0.9) return 'كل أجزاء نومك زينة. حافظ على نفس الوقت.';
  return {
    duration: `أكبر شي ينقصك المدة. لو تنام ${hhmm(Math.max(0, sp.target - night.asleep_min))} زيادة توصل للهدف.`,
    rem: 'نوم الأحلام قليل، وأغلبه يجي آخر الليل. النوم الأطول وثبات وقت الصحيان يزودونه.',
    deep: 'نومك العميق قليل. تمرين بالنهار وغرفة باردة ومظلمة يساعدونه، والكافيين بعد العصر يقلله.',
    awake: 'صحيت كثير بالليل. خفّف السوايل قبل النوم بساعة، وخلّ الجوال بعيد.',
    consistency: 'وقت نومك يتغير كثير. ثبّته قريب من نفس الساعة كل ليلة، حتى بالإجازة.'
  }[weakest.k];
}

function stagesHTML(night){
  if (!Number.isFinite(night.deep_min)) return '<p class="snote">الساعة ما أرسلت مراحل النوم لهذي الليلة.</p>';
  const deep = night.deep_min || 0, rem = night.rem_min || 0, awake = night.awake_min || 0;
  const core = Math.max(0, night.asleep_min - deep - rem);
  const mins = { deep, core, rem, awake }, total = deep + core + rem + awake || 1;
  const shown = STAGES.filter(s => mins[s.k] > 0);
  return `<div class="stbar" role="img" aria-label="${STAGES.map(s => `${s.l} ${hhmm(mins[s.k])}`).join('، ')}">
      ${shown.map(s => `<i style="flex:${mins[s.k]};background:${s.c}"></i>`).join('')}
    </div>
    <div class="stlegend">${STAGES.map(s => `<div><span class="sw" style="background:${s.c}"></span>
      <span class="stl">${s.l}</span><b>${hhmm(mins[s.k])}</b><small>${num(Math.round(100 * mins[s.k] / total))}%</small></div>`).join('')}</div>`;
}

// One series, so no legend: the heading names it. The target is a hairline, the
// latest night carries the only label, and tapping a column reads its values out
// in the caption under the chart.
function weekHTML(list){
  if (list.length < 2) return '<p class="snote">تحتاج ليلتين على الأقل عشان تظهر المقارنة.</p>';
  const top = Math.max(9 * 60, ...list.map(n => n.asleep_min || 0));
  const y = m => Math.round(100 * m / top);
  return `<div class="wkchart" role="group" aria-label="مدة النوم آخر ${num(list.length)} ليالي">
      <div class="wktarget" style="bottom:${y(450)}%"><span>الهدف 7:30</span></div>
      ${list.map((n, i) => `<button class="wkcol${i === list.length - 1 ? ' last' : ''}" data-i="${i}"
          aria-label="${fNight.format(parse(n.night_of))}: ${hhmm(n.asleep_min)}، الدرجة ${n.score ?? '–'}">
        ${i === list.length - 1 ? `<em>${hhmm(n.asleep_min)}</em>` : ''}
        <i style="height:${Math.max(2, y(n.asleep_min || 0))}%"></i>
        <small>${fWdShort.format(parse(n.night_of))}</small></button>`).join('')}
    </div>
    <p class="snote wkcap" id="wkCap">اضغط على أي ليلة تشوف تفاصيلها.</p>`;
}

export function openSleepSheet(night){
  const sp = sleepParts(night, recentNights(7, night.night_of));
  if (!sp) return;
  const list = nightHistory(7);
  // Garmin's own score when intervals.icu sent it; the breakdown below stays this app's estimate
  const shown = night.garmin_score ?? sp.score;
  const hv = hrvStatus();
  const prev = recentNights(7, night.night_of).map(n => n.resting_hr).filter(Number.isFinite);
  const avgHr = prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : null;
  const inBed = night.in_bed_start && night.in_bed_end ? Math.round((Date.parse(night.in_bed_end) - Date.parse(night.in_bed_start)) / 60000) : null;
  const eff = inBed ? Math.min(100, Math.round(100 * night.asleep_min / inBed)) : null;

  openSheet(sh => {
    sh.innerHTML = `<h2 class="sheeth">تفاصيل النوم</h2>
      <p class="snote">ليلة ${fNight.format(parse(night.night_of))}${night.in_bed_start ? ` · ${clock12(new Date(night.in_bed_start))}` : ''}${night.in_bed_end ? ` ← ${clock12(new Date(night.in_bed_end))}` : ''}</p>

      <div class="slhead">
        ${ringWith({ size: 96, pct: shown / 100, color: 'var(--sleep)', width: 9 }, `<b class="ringnum sm">${num(shown)}</b>`)}
        <div class="slfacts">
          <div><span>نمت</span><b>${hhmm(night.asleep_min)}</b></div>
          <div><span>في السرير</span><b>${inBed != null ? hhmm(inBed) : '–'}</b></div>
          <div><span>كفاءة النوم</span><b>${eff != null ? num(eff) + '%' : '–'}</b></div>
        </div>
      </div>

      ${night.garmin_score != null ? `<p class="capnote">الدرجة ${num(night.garmin_score)} من قارمن نفسه. ${night.from === 'garmin' ? 'مراحل النوم ما وصلت من الاختصار لهذي الليلة.' : 'التفصيل تحت تقدير التطبيق من مراحل النوم.'}</p>` : ''}
      <section class="sgroup"><h3>مراحل النوم</h3>${stagesHTML(night)}</section>

      ${night.from === 'garmin' ? '' : `<section class="sgroup"><h3>كيف انحسبت الدرجة</h3>
        ${sp.parts.map(p => `<div class="spart">
          <div class="sptop"><b>${PART_LABEL[p.k]}</b><span>${num(Math.round(p.v * p.w))} من ${num(p.w)}</span></div>
          <div class="spbar"><i style="width:${Math.round(100 * p.v)}%"></i></div>
          <small>${partText(p, sp, night)}</small></div>`).join('')}
        ${sp.cap ? `<p class="capnote">المجموع ${num(sp.raw)}، بس النوم أقل من ${num(sp.cap.under / 60)} ساعات فالدرجة ما تتعدى ${num(sp.cap.max)}.</p>` : ''}
        <p class="coachline left">${sleepTip(night, sp)}</p>
      </section>`}

      <section class="sgroup"><h3>نبض الراحة</h3>
        <p class="slhr"><b>${night.resting_hr != null ? num(night.resting_hr) : '–'}</b><span>نبضة بالدقيقة</span></p>
        <p class="snote">${night.resting_hr == null ? 'الساعة ما أرسلت نبض الراحة لهذي الليلة.'
          : avgHr == null ? 'بعد كم ليلة بقارنه بمعدلك.'
          : night.resting_hr - avgHr >= 5 ? `أعلى من معدلك (${num(avgHr)}) بـ ${num(night.resting_hr - avgHr)}. ممكن تعب أو بداية مرض، خذها بهدوء اليوم.`
          : avgHr - night.resting_hr >= 3 ? `أقل من معدلك (${num(avgHr)}). علامة استشفاء زينة.`
          : `قريب من معدلك (${num(avgHr)}).`}</p>
      </section>

      ${hv ? `<section class="sgroup"><h3>متغيرية نبض القلب</h3>
        <p class="slhr"><b>${num(hv.now)}</b><span>ملّي ثانية</span></p>
        <p class="snote">${hv.avg == null ? 'بعد كم ليلة بقارنها بمعدلك.' : hv.low
          ? `أقل من معدلك (${num(hv.avg)}) بوضوح. جسمك ما استشفى كامل، خفّف اليوم.`
          : `قريبة من معدلك (${num(hv.avg)}) أو أعلى. علامة استشفاء زينة.`}</p></section>` : ''}

      <section class="sgroup"><h3>آخر ${num(list.length)} ليالي</h3>${weekHTML(list)}</section>`;

    sh.querySelectorAll('.wkcol').forEach(b => b.onclick = () => {
      const n = list[+b.dataset.i];
      sh.querySelectorAll('.wkcol').forEach(x => x.classList.toggle('on', x === b));
      sh.querySelector('#wkCap').textContent =
        `ليلة ${fNight.format(parse(n.night_of))}: نمت ${hhmm(n.asleep_min)}${n.deep_min != null ? `، عميق ${hhmm(n.deep_min)}` : ''}، الدرجة ${n.score != null ? num(n.score) : '–'}`;
    });
  });
}

/* ---------- steps ----------
   Today's total in the band; the sheet has the last two weeks against the 8,000
   target, the 7-day average, and what the numbers mean on a rest day and the day
   before a match (health.js stepsNote). */
export function openStepsSheet(){
  const list = stepsHistory(14), have = list.filter(x => x.steps != null);
  const today = stepsOn(todayISO()), avg = stepsAverage(), note = stepsNote();
  const top = Math.max(12000, ...have.map(x => x.steps));
  const y = v => Math.round(100 * v / top);
  openSheet(sh => {
    sh.innerHTML = `<h2 class="sheeth">الخطوات</h2>
      <div class="slhead">
        ${ringWith({ size: 96, pct: Math.min(1, (today || 0) / STEPS_TARGET), color: 'var(--gold)', width: 9 }, `<b class="ringnum sm">${today != null ? num(Math.round(today / 100) / 10) : '–'}</b>${today != null ? '<span class="ringsub">ألف</span>' : ''}`)}
        <div class="slfacts">
          <div><span>اليوم</span><b>${today != null ? num(today) : '–'}</b></div>
          <div><span>متوسط 7 أيام</span><b>${avg != null ? num(avg) : '–'}</b></div>
          <div><span>الهدف</span><b>${num(STEPS_TARGET)}</b></div>
        </div>
      </div>
      ${note ? `<p class="capnote">${note.text}</p>` : ''}
      <section class="sgroup"><h3>آخر أسبوعين</h3>
        ${have.length >= 2 ? `<div class="wkchart steps" role="group" aria-label="الخطوات آخر 14 يوم">
          <div class="wktarget" style="bottom:${y(STEPS_TARGET)}%"><span>الهدف ${num(STEPS_TARGET)}</span></div>
          ${list.map((x, i) => `<button class="wkcol${i === list.length - 1 ? ' last' : ''}" data-i="${i}" aria-label="${fNight.format(parse(x.day))}: ${x.steps != null ? num(x.steps) + ' خطوة' : 'ما فيه بيانات'}">
            <i style="height:${x.steps != null ? Math.max(2, y(x.steps)) : 0}%"></i>
            <small>${i % 2 === list.length % 2 ? '' : num(parse(x.day).getDate())}</small></button>`).join('')}
        </div><p class="snote wkcap" id="stCap">اضغط على أي يوم تشوف خطواته.</p>`
        : '<p class="snote">تحتاج يومين على الأقل عشان يظهر الرسم.</p>'}
      </section>
      <section class="sgroup"><h3>كم الأفضل؟</h3>
        <p class="snote">خلّ متوسطك ${num(STEPS_TARGET)} إلى ${num(10000)} خطوة باليوم. بعد هذا الرقم الفائدة الصحية تزيد شوي بس.</p>
        <p class="snote">أيام التمرين توصلها بسهولة. يوم الراحة لا تتعدى ${num(15000)}، واليوم اللي قبل المباراة خلّها تحت ${num(12000)} عشان رجولك ترتاح.</p>
      </section>`;
    sh.querySelectorAll('.wkcol').forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i];
      sh.querySelectorAll('.wkcol').forEach(c => c.classList.toggle('on', c === b));
      sh.querySelector('#stCap').textContent = `${fNight.format(parse(x.day))}: ${x.steps != null ? num(x.steps) + ' خطوة' : 'ما وصلت بيانات'}`;
    });
  });
}

// The readiness conversation is a sheet now rather than a block on Today. The
// #ready container is created inside the sheet, and renderReady() no-ops when it
// is not in the document, so renderAll() stays safe while the sheet is closed.
export function openReadySheet(){
  openSheet(sh => {
    sh.innerHTML = `<h2 class="sheeth">فحص الجاهزية</h2><div id="ready"></div>`;
    renderReady();
  });
}

/* ---------- unconfirmed watch workout ---------- */
function renderWatchCard(){
  const box = $('watchCard');
  if (!box) return;
  const w = pendingWorkouts()[0];
  const warn = restingHrWarning();
  const t0 = todayISO(), s0 = state.sessions[t0];
  const warnHTML = warn ? `<section class="card hrwarn">
      <span class="hwic">${icon('heart')}</span>
      <div><b>نبض راحتك مرتفع ليلتين ورا بعض</b>
        <small>${num(warn.now)} والمعدل ${num(warn.avg)}. ممكن تعب أو بداية مرض.</small></div>
      ${s0 && !s0.orig && ['run','strength','intervals','yoyo'].includes(s0.type) ? '<button class="btn primary sm" id="hrLight">خفّف اليوم</button>' : ''}
    </section>` : '';
  const sn = stepsNote();
  const stepsHTML = sn ? `<button class="card hrwarn stepwarn" id="stepWarn"><span class="hwic">${icon('route')}</span>
      <div><b>خطوات كثيرة اليوم</b><small>${sn.text}</small></div></button>` : '';
  if (!w){ box.innerHTML = warnHTML + stepsHTML; wireWarn(); return; }
  const bits = [
    w.duration_min ? `${num(Math.round(w.duration_min))} دقيقة` : '',
    w.distance_km ? `${num(Number(w.distance_km).toFixed(1))} كم` : ''
  ].filter(Boolean).join(' · ');
  // the workout's own day, in local time: a late run must not file under tomorrow's UTC date
  const st = new Date(w.start), wd = isNaN(st) ? '' : `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
  const lg = state.logs[wd];
  const autod = !!(lg && lg.auto && lg.effort_est);
  box.innerHTML = warnHTML + stepsHTML + `<button class="card watchcard" id="watchOpen">
    <span class="wic">${icon('timer')}</span>
    <span class="wtx"><b>${autod ? 'سجّلت تمرينك من الساعة' : 'وصل تمرينك من الساعة'}</b><small>${[bits, autod ? 'كيف حسيت بالمجهود؟' : 'جاهز تأكّده'].filter(Boolean).join(' · ')}</small></span>
    <span class="wgo">${icon('back')}</span>
  </button>`;
  $('watchOpen').onclick = () => openWorkout(w.id);
  wireWarn();
}

function wireWarn(){
  const sw = $('stepWarn'); if (sw) sw.onclick = openStepsSheet;
  const b = $('hrLight');
  if (b) b.onclick = () => import('./coach.js').then(m => { m.lighten(todayISO(), false); import('./state.js').then(s => s.save()); renderAll(); });
}

/* ---------- the match-day plan ----------
   Shown the day before, on the day, and the morning after. Steps already past are
   ticked, the next one is open with its instructions, the rest are one line. The
   same steps go out as pushes from the cron (js/matchplan.js). */
function renderMatchPlan(){
  const box = $('planCard');
  if (!box) return;
  const t = todayISO();
  const near = [t, shiftDate(t, 1), shiftDate(t, -1)];
  const m = near.map(d => state.matches.find(x => x.date === d && x.time)).find(Boolean);
  if (!m){ box.innerHTML = ''; return; }
  const kit = ((state.push && state.push.prefs && state.push.prefs.match) || {}).before || 120;
  let steps = planSteps(m, Number(kit)).map(s => ({ ...s, date: shiftDate(m.date, s.day) }));
  // the morning after shows only what is left: recovery and the evaluation
  if (m.date < t) steps = steps.filter(s => s.day === 1);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const at = s => s.date < t ? -1e9 : s.date > t ? 1e9 : s.min - nowMin;   // minutes from now
  const nextI = steps.findIndex(s => at(s) >= -10);
  const clk = s => clock12(`${Math.floor(s.min / 60)}:${String(s.min % 60).padStart(2, '0')}`);
  const when = s => s.date === t ? clk(s) : s.date === shiftDate(t, 1) ? `بكرة ${clk(s)}` : s.date > t ? 'بعد بكرة' : 'أمس';
  const teams = m.home || m.away ? `${m.home || '؟'} × ${m.away || '؟'}` : 'المباراة';
  box.innerHTML = `<section class="card mplan">
    <div class="mphead"><span class="mpic">${icon('flag')}</span>
      <div><b>خطة يوم المباراة</b><small>${teams} · ${m.date === t ? 'اليوم' : m.date > t ? 'بكرة' : 'أمس'} ${clock12(m.time)}</small></div></div>
    <ol class="mpl">${steps.map((s, i) => `<li class="${i < nextI || nextI < 0 ? 'done' : i === nextI ? 'next' : ''}">
      <span class="mpt">${when(s)}</span><i class="mpdot"></i>
      <div><b>${s.title}</b>${i === nextI ? `<small>${s.body}</small>` : ''}</div></li>`).join('')}</ol>
    ${m.date < t && !(state.logs[m.date] && state.logs[m.date].done) ? '<button class="btn ghost sm" id="mpEval" style="width:100%;margin-top:10px">قيّم مباراة أمس</button>' : ''}
  </section>`;
  const ev = $('mpEval'); if (ev) ev.onclick = () => openDay(m.date);
}

/* ---------- today's session ---------- */
function renderSessionCard(){
  const box = $('sessionCard');
  if (!box) return;
  const t = todayISO(), s = state.sessions[t], lg = state.logs[t];
  const done = !!(lg && lg.done);

  if (!s || s.type === 'rest'){
    box.innerHTML = `<section class="card session">
      <p class="eyebrow">اليوم · راحة</p>
      <h2>يوم راحة</h2>
      <p class="sessnote">مشي خفيف وإطالات إذا حبيت. جسمك يبني نفسه في الراحة.</p>
      ${s ? `<button class="btn primary" id="sessGo">شوف تفاصيل اليوم</button>` : ''}
    </section>`;
    const g = $('sessGo'); if (g) g.onclick = () => openDay(t);
    return;
  }

  if (s.type === 'match'){
    const m = state.matches.find(x => x.date === t);
    box.innerHTML = `<section class="card session ismatch">
      <p class="eyebrow">اليوم · مباراة</p>
      <h2>${s.title}</h2>
      ${m && (m.home || m.away) ? `<p class="sessnote">${[m.home, m.away].filter(Boolean).join(' × ')}</p>` : ''}
      <button class="btn primary" id="sessGo">${done ? 'شوف التقييم' : 'قيّم المباراة'}</button>
    </section>`;
    $('sessGo').onclick = () => openDay(t);
    return;
  }

  const ty = TYPES[s.type] || TYPES.rest;
  const parts = sessionParts(t, s);
  const total = parts.reduce((a, p) => a + p.min, 0) || 1;

  const ICON = { run: 'route', intervals: 'bolt', yoyo: 'bolt', strength: 'spark', light: 'heart', recovery: 'heart', test: 'timer' };
  box.innerHTML = `<section class="card session">
    <div class="sesshead">
      <span class="sessic" style="color:${ty.c};background:color-mix(in srgb,${ty.c} 14%,transparent)">${icon(ICON[s.type] || 'bolt')}</span>
      <div><p class="eyebrow">تمرين اليوم · ${ty.l} · ${num(defDur(t, s))} دقيقة</p><h2>${s.title}</h2></div>
    </div>
    <div class="segbar" role="img" aria-label="أجزاء الحصة">
      ${parts.map(p => `<i style="flex:${p.min / total};background:${p.color}"></i>`).join('')}
    </div>
    <div class="seglabels">${parts.map(p => `<span>${p.label}${p.min ? ' ' + num(Math.round(p.min)) + ' د' : ''}</span>`).join('')}</div>
    ${watchLine(s.type)}
    <button class="btn primary" id="sessGo">${done ? 'أنهيته ✓' : 'ابدأ بالإحماء'}</button>
  </section>`;
  $('sessGo').onclick = () => openDay(t);
}

// Which saved workout to start on the watch today (js/garmin.js WATCH_NAME).
function watchLine(type){
  const n = WATCH_NAME[type];
  return n ? `<div class="watchline"><span class="wlic">${icon('timer')}</span><span>بالساعة شغّل <b>${n}</b><small dir="ltr">Run → Training → Workouts</small></span></div>`
    : type === 'strength' ? `<div class="watchline"><span class="wlic">${icon('timer')}</span><span>بالساعة شغّل نشاط <b>Strength</b><small>وتابع التمارين من الجوال</small></span></div>` : '';
}

/* ---------- next match line ---------- */
// The phone's Calendar opens a .ics link with an «Add» sheet. The server writes
// the file (GET /api/ics), with an alert three hours before kickoff.
function icsLink(m, teams){
  const role = m.role !== undefined && m.role !== '' ? ['حكم مساعد أول','حكم مساعد ثاني','حكم رابع','حكم ساحة'][+m.role] : '';
  const q = new URLSearchParams({ t: `مباراة: ${teams}`, d: m.date, h: m.time, l: m.venue || '', n: [m.comp, role].filter(Boolean).join(' · ') });
  return `/api/ics?${q}`;
}
function renderNextMatch(){
  const box = $('nextMatchLine');
  if (!box) return;
  const t = todayISO();
  const next = state.matches.filter(m => m.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];

  if (!next){
    box.innerHTML = `<button class="matchline none" id="addMatchToday">
      <span class="mic">${icon('flag')}</span>
      <span class="mtx"><b>ما فيه مباراة قادمة</b><small>أضفها لما ينزل التكليف</small></span>
      <span class="mgo">${icon('plus')}</span></button>`;
    $('addMatchToday').onclick = () => openAddMatch();
    return;
  }

  const days = Math.round((parse(next.date) - parse(t)) / 864e5);
  // the stub of the ticket. Arabic counts the dual separately, and 11+ takes the singular
  const [pre, big] = days === 0 ? ['', 'اليوم'] : days === 1 ? ['', 'بكرة'] : days === 2 ? ['بعد', 'يومين']
    : days <= 10 ? ['بعد', `${num(days)} أيام`] : ['بعد', `${num(days)} يوم`];
  const teams = next.home || next.away ? `${next.home || '؟'} × ${next.away || '؟'}` : 'مباراة';
  // a team's initial, without the article: الهلال -> هـ
  const ini = n => { const w = String(n || '').trim().replace(/^ال/, ''); return w ? (w[0] === 'ه' ? 'هـ' : w[0]) : ''; };
  const role = next.role !== undefined && next.role !== '' ? ['حكم مساعد أول','حكم مساعد ثاني','حكم رابع','حكم ساحة'][+next.role] : '';
  box.innerHTML = `<button class="mticket" id="goMatch">
    <span class="mtmain">
      ${next.home || next.away
        ? `<span class="mtav"><i>${ini(next.home)}</i><i>${ini(next.away)}</i></span>`
        : `<span class="mic">${icon('flag')}</span>`}
      <span class="mtx"><b>${teams}</b>
        <small>${[fDm.format(parse(next.date)), next.time ? clock12(next.time) : '', role].filter(Boolean).join(' · ')}</small></span>
    </span>
    <span class="mtstub">${pre ? `<small>${pre}</small>` : ''}<b>${big}</b></span>
  </button>
  <div class="mtacts">
    ${next.time ? `<a class="mtact" href="${icsLink(next, teams)}">${icon('calendar')} أضف للتقويم</a>` : ''}
    ${next.venue ? `<a class="mtact" href="https://maps.apple.com/?q=${encodeURIComponent(next.venue)}" target="_blank" rel="noopener">${icon('route')} الاتجاهات للملعب</a>` : ''}
  </div>`;
  $('goMatch').onclick = () => openDay(next.date);
}

/* ---------- settings sheet ---------- */
// Settings used to be a fourth segment inside التقدم. It is a sheet now, opened by
// the gear in the Today header. The markup is built here each time it opens and
// the notification wiring is re-run against it.
const CITIES_OPT = [['zulfi','الزلفي'],['riyadh','الرياض'],['majmaah','المجمعة']];

export function openSettings(focus){
  openSheet(sh => {
    sh.innerHTML = `<h2 class="sheeth">الإعدادات</h2>

      <section class="sgroup scard">
        <h3><span class="sgi">${icon('moon')}</span>المظهر</h3>
        <p class="snote">التلقائي ليلي من 6 المغرب إلى 5 الفجر.</p>
        <div class="chiprow" id="themeRow" style="margin-top:10px">
          <button class="chip" data-t="auto">تلقائي</button>
          <button class="chip" data-t="day">نهاري</button>
          <button class="chip" data-t="night">ليلي</button>
        </div>
      </section>

      <section class="sgroup scard">
        <h3><span class="sgi">${icon('timer')}</span>التمرين</h3>
        <label class="sw" style="margin-top:4px"><input type="checkbox" id="voiceSw"><span>صوت المؤقت: يقول لك متى تبدأ الراحة ومتى تنطلق</span></label>
        <p class="snote">الشاشة تبقى شغالة وأنت فاتح تمرين اليوم أو المؤقت شغّال.</p>
      </section>

      <section class="sgroup scard">
        <h3><span class="sgi">${icon('flag')}</span>المدينة</h3>
        <p class="snote">تُستخدم لتوقّع الطقس واقتراح أنسب وقت للتمرين.</p>
        <select class="in" id="citySel">${CITIES_OPT.map(([v,l]) =>
          `<option value="${v}">${l}</option>`).join('')}</select>
      </section>

      <section class="sgroup scard" id="healthPanel">
        <h3><span class="sgi">${icon('heart')}</span>ربط الساعة</h3>
        <p class="snote">بيانات النوم والتمارين تجي من ساعتك عن طريق اختصار آيفون.</p>
        <p class="snote" id="healthLast"></p>
        <button class="btn ghost" id="healthTest">${icon('refresh')} اختبر الربط</button>
        <p class="snote" id="healthMsg" hidden></p>
        <label class="flabel" for="maxHr">أقصى نبض</label>
        <input class="in sm" id="maxHr" type="number" inputmode="numeric" min="120" max="230" step="1">
        <p class="snote">مناطق النبض تنحسب منه. إذا ما تعرفه: 220 ناقص عمرك. يطبّق على التمارين اللي توصل بعد التغيير.</p>
      </section>

      <section class="sgroup scard" id="notifPanel">
        <h3><span class="sgi">${icon('inbox')}</span>التنبيهات</h3>
        <p class="snote" id="notifState">…</p>
        <div class="srow">
          <button class="btn primary sm" id="notifOn">فعّل التنبيهات</button>
          <button class="btn ghost sm" id="notifTest" hidden>جرّب تنبيه</button>
        </div>
        <div id="notifOpts" hidden>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nReady"><span>فحص الجاهزية الصباحي</span></label><input class="in sm" type="time" id="nReadyT"></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nTrain"><span>تذكير التمرين</span></label><input class="in sm" type="time" id="nTrainT"></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nMatch"><span>قبل المباراة</span></label><select class="in sm" id="nMatchB"><option value="60">بساعة</option><option value="120">بساعتين</option><option value="180">بثلاث ساعات</option></select></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nPlan"><span>خطة يوم المباراة: النوم، الماء، الأكل، الإحماء، والاستشفاء</span></label></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nSteps"><span>الخطوات: 12 الظهر و4 العصر و8 الليل، إذا كنت متأخر عن هدف 8,000</span></label></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nWater"><span>شرب الماء من 9 الصبح لين 9 الليل</span></label><select class="in sm" id="nWaterE"><option value="1">كل ساعة</option><option value="2">كل ساعتين</option><option value="3">كل 3 ساعات</option></select></div>
          <div class="nitem"><label class="sw"><input type="checkbox" id="nWeek"><span>ملخص الأسبوع</span></label><div class="srow">  <select class="in sm" id="nWeekD"><option value="5">الجمعة</option><option value="6">السبت</option><option value="0">الأحد</option></select>  <input class="in sm" type="time" id="nWeekT"></div></div>
          <p class="snote">التنبيه يكتبه المدرب حسب جدولك والطقس. تذكير التمرين يتخطى أيام الراحة والمباريات تلقائيًا.</p>
        </div>
        <button class="btn ghost sm" id="vapidBtn">أظهر مفاتيح التنبيهات الثابتة</button>
        <div id="vapidBox" hidden></div>
      </section>

      <section class="sgroup scard">
        <h3><span class="sgi">${icon('refresh')}</span>نسخة احتياطية</h3>
        <p class="snote">بياناتك محفوظة على هذا الجهاز. صدّر نسخة من وقت لآخر، أو استورد نسخة من جهاز ثاني.</p>
        <div class="srow">
          <button class="btn ghost sm" id="expBtn">تصدير نسخة</button>
          <button class="btn ghost sm" id="impBtn">استيراد نسخة</button>
        </div>
        <input type="file" id="impFile" accept="application/json,.json" hidden>
      </section>`;

    // appearance
    const paintTheme = () => sh.querySelectorAll('#themeRow .chip').forEach(b =>
      b.classList.toggle('on', b.dataset.t === ((state.settings && state.settings.theme) || 'auto')));
    sh.querySelectorAll('#themeRow .chip').forEach(b => b.onclick = () => {
      state.settings = { ...(state.settings || {}), theme: b.dataset.t };
      applyTheme(b.dataset.t);
      paintTheme();
      import('./state.js').then(m => m.save());
    });
    paintTheme();

    // the rest timer's voice
    const vs = sh.querySelector('#voiceSw');
    vs.checked = !(state.settings && state.settings.voice === false);
    vs.onchange = () => { state.settings = { ...(state.settings || {}), voice: vs.checked }; import('./state.js').then(m => m.save()); };

    // city
    const city = sh.querySelector('#citySel');
    city.value = (state.settings && state.settings.city) || 'zulfi';
    city.onchange = e => {
      state.settings = { ...(state.settings || {}), city: e.target.value };
      import('./state.js').then(m => m.save());
      import('./progress.js').then(m => m.loadWeather());
    };

    // watch link
    const lastEl = sh.querySelector('#healthLast'), msg = sh.querySelector('#healthMsg');
    const showLast = at => {
      lastEl.textContent = at
        ? `آخر بيانات وصلت: ${new Date(at).toLocaleString(AR, { dateStyle:'medium', timeStyle:'short' })}`
        : 'ما وصلت أي بيانات بعد. شغّل الاختصار مرة من جوالك.';
    };
    showLast(lastSync());
    // The test asks the server what it holds, not the cache: "it works" has to mean
    // the Shortcut reached the server and the server can read it back.
    sh.querySelector('#healthTest').onclick = async e => {
      const b = e.currentTarget;
      b.disabled = true; msg.hidden = false; msg.textContent = 'أتأكد…';
      const r = await syncHealth({ force: true });
      b.disabled = false;
      if (r.ok){
        showLast(r.last_at);
        msg.textContent = r.last_at
          ? `الربط شغّال ✅ عندي ${num(r.nights)} ليلة و${num(r.workouts)} تمرين من آخر شهر.`
          : 'الخادم جاهز ✅ بس ما وصل شي من الاختصار للحين.';
        const iv = r.intervals;
        if (iv) msg.textContent += iv.error
          ? (iv.error === 'not_migrated' ? ' intervals.icu: قاعدة البيانات تحتاج ملف 004.'
             : /refused/.test(iv.error) ? ' intervals.icu: المفتاح أو رقم الحساب غلط.' : ' intervals.icu: ما قدرت أوصل له الحين.')
          : iv.last_ok ? ` intervals.icu متصل، آخر سحب ${clock12(new Date(iv.last_ok))}.` : '';
        return;
      }
      msg.textContent = ({
        not_migrated: 'قاعدة البيانات تحتاج ملف الترحيل 002_health.sql.',
        'sync disabled': 'الربط يحتاج قاعدة البيانات، وهي مو مفعّلة على الخادم.',
        passcode: 'رمز الدخول غلط أو ناقص. افتح المدرب مرة عشان يطلبه.',
        offline: 'ما قدرت أوصل للخادم. تأكد من النت وجرّب مرة ثانية.'
      })[r.error] || 'صار خطأ في الخادم. جرّب بعد شوي.';
    };

    // max heart rate: saved with the rest of the state, which is where the server
    // reads it from when the Shortcut posts
    const mh = sh.querySelector('#maxHr');
    mh.value = maxHr();
    mh.placeholder = String(MAX_HR_DEFAULT);
    mh.onchange = () => {
      const n = Math.round(Number(mh.value));
      if (!(n >= 120 && n <= 230)){ mh.value = maxHr(); return; }
      state.settings = { ...(state.settings || {}), max_hr: n };
      import('./state.js').then(m => m.save());
    };

    // backup
    sh.querySelector('#expBtn').onclick = exportBackup;
    sh.querySelector('#impBtn').onclick = () => sh.querySelector('#impFile').click();
    sh.querySelector('#impFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      const ok = await importBackup(f);
      alert(ok ? 'تم استيراد بياناتك ✅' : 'الملف غير صالح');
      if (ok) renderAll();
      e.target.value = '';
    };

    // reminders: the wiring reads the ids above, so it is re-run on every open
    initNotifications();
    renderNotif();

    if (focus === 'health'){
      const h = sh.querySelector('#healthPanel');
      if (h) setTimeout(() => h.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
    }
  });
}

export function renderToday(){
  renderTodayHead();
  renderSleep();
  renderBand();
  renderMatchPlan();
  renderWatchCard();
  renderSessionCard();
  renderNextMatch();
}
