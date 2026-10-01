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

import { state, num, parse, todayISO, fFull, fDm, AR, $ } from './state.js';
import { ring, ringWith, icon, hhmm, clock12 } from './ui.js';
import { TYPES, defDur, openDay, sessionParts, openAddMatch } from './schedule.js';
import { loadStatus } from './progress.js';
import { readyNow, readyPct, renderReady } from './coach.js';
import { lastNightSleep, pendingWorkouts, lastSync, syncHealth, maxHr, MAX_HR_DEFAULT } from './health.js';
import { openWorkout } from './workout.js';
import { initNotifications, renderNotif } from './notifications.js';
import { openSheet, switchTab, renderAll } from './main.js';
import { exportBackup, importBackup } from './storage-sync.js';

/* ---------- header ---------- */
function renderTodayHead(){
  const el = $('todayDate');
  if (el) el.textContent = fFull.format(parse(todayISO()));
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
    box.innerHTML = `<section class="card sleep empty">
      ${ringWith({ size:176, pct:0, color:'var(--sleep)', width:14 },
        `<span class="ringlabel">${icon('moon')} النوم</span><b class="ringnum dim">–</b>`)}
      <p class="sleepnone">ما وصلت بيانات النوم</p>
      <button class="linkbtn" id="sleepHelp">${icon('info')} كيف أربط ساعتي؟</button>
    </section>`;
    $('sleepHelp').onclick = () => openSettings('health');
    return;
  }

  box.innerHTML = `<section class="card sleep">
    ${ringWith({ size:176, pct:night.score/100, color:'var(--sleep)', width:14 },
      `<span class="ringlabel">${icon('moon')} النوم</span>
       <b class="ringnum">${num(night.score)}</b>
       <span class="ringsub">${hhmm(night.asleep_min || 0)}</span>`)}
    <div class="stat3">
      <div><span>النوم العميق</span><b>${night.deep_min != null ? hhmm(night.deep_min) : '–'}</b></div>
      <div><span>وقت النوم</span><b>${night.in_bed_start ? clock12(new Date(night.in_bed_start)) : '–'}</b></div>
      <div><span>نبض الراحة</span><b>${night.resting_hr != null ? num(night.resting_hr) : '–'}</b></div>
    </div>
    <p class="coachline">${sleepLine(night.score, night)}</p>
  </section>`;
}

/* ---------- the two small tiles ---------- */
function renderTiles(){
  const box = $('todayTiles');
  if (!box) return;
  const r = state.readiness[todayISO()];
  const pct = r ? readyPct(readyNow(r)) : null;
  const L = loadStatus();

  const word = !L.enough || L.ratio == null ? '—'
    : L.ratio > 1.3 ? 'مرتفع'
    : L.ratio >= 0.8 ? 'متوازن'
    : 'منخفض';
  // 1.6 reads as a full ring, so the safe band sits a bit past halfway round
  const loadPct = L.ratio == null ? 0 : Math.min(1, L.ratio / 1.6);

  box.innerHTML = `
    <button class="card tile" id="tileReady">
      ${ring({ size:62, pct:(pct ?? 0)/100, color:'var(--ready)', width:7 })}
      <span class="tiletx"><small>الجاهزية</small><b>${pct == null ? 'عبّيها' : num(pct) + '%'}</b></span>
    </button>
    <button class="card tile" id="tileLoad">
      ${ring({ size:62, pct:loadPct, color:'var(--load)', width:7 })}
      <span class="tiletx"><small>حمل التدريب</small>
        <b>${L.enough && L.ratio != null ? num(L.ratio.toFixed(2)) : '–'}</b>
        <i>${word}</i></span>
    </button>`;

  $('tileReady').onclick = openReadySheet;
  $('tileLoad').onclick = () => switchTab('prog');
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
  if (!w){ box.innerHTML = ''; return; }
  const bits = [
    w.duration_min ? `${num(Math.round(w.duration_min))} دقيقة` : '',
    w.distance_km ? `${num(Number(w.distance_km).toFixed(1))} كم` : ''
  ].filter(Boolean).join(' · ');
  box.innerHTML = `<button class="card watchcard" id="watchOpen">
    <span class="wic">${icon('timer')}</span>
    <span class="wtx"><b>وصل تمرينك من الساعة</b><small>${bits || 'جاهز تأكّده'}</small></span>
    <span class="wgo">${icon('back')}</span>
  </button>`;
  $('watchOpen').onclick = () => openWorkout(w.id);
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

  box.innerHTML = `<section class="card session">
    <p class="eyebrow">تمرين اليوم · ${ty.l}</p>
    <h2>${s.title}</h2>
    <p class="sessdur">${icon('clock')}<span>${num(defDur(t, s))} دقيقة</span></p>
    <div class="segbar" role="img" aria-label="أجزاء الحصة">
      ${parts.map(p => `<i style="flex:${p.min / total};background:${p.color}"></i>`).join('')}
    </div>
    <div class="seglabels">${parts.map(p => `<span>${p.label}</span>`).join('')}</div>
    <button class="btn primary" id="sessGo">${done ? 'أنهيته ✓' : 'ابدأ التمرين'}</button>
  </section>`;
  $('sessGo').onclick = () => openDay(t);
}

/* ---------- next match line ---------- */
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
  const badge = days === 0 ? 'اليوم' : days === 1 ? 'بكرة' : '';
  // Arabic counts the dual separately, and 11+ takes the singular
  const away = days === 2 ? 'بعد يومين'
    : days <= 10 ? `بعد ${num(days)} أيام`
    : `بعد ${num(days)} يوم`;
  const teams = next.home || next.away ? `${next.home || '؟'} × ${next.away || '؟'}` : 'مباراة';
  box.innerHTML = `<button class="matchline" id="goMatch">
    <span class="mic">${icon('flag')}</span>
    <span class="mtx"><b>${teams}</b>
      <small>${fDm.format(parse(next.date))}${next.time ? ' · ' + clock12(next.time) : ''}</small></span>
    ${badge ? `<span class="mbadge">${badge}</span>` : `<span class="mdays">${away}</span>`}
  </button>`;
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

      <section class="sgroup">
        <h3>المدينة</h3>
        <p class="snote">تُستخدم لتوقّع الطقس واقتراح أنسب وقت للتمرين.</p>
        <select class="in" id="citySel">${CITIES_OPT.map(([v,l]) =>
          `<option value="${v}">${l}</option>`).join('')}</select>
      </section>

      <section class="sgroup" id="healthPanel">
        <h3>ربط الساعة</h3>
        <p class="snote">بيانات النوم والتمارين تجي من ساعتك عن طريق اختصار آيفون.</p>
        <p class="snote" id="healthLast"></p>
        <button class="btn ghost" id="healthTest">${icon('refresh')} اختبر الربط</button>
        <p class="snote" id="healthMsg" hidden></p>
        <label class="flabel" for="maxHr">أقصى نبض</label>
        <input class="in sm" id="maxHr" type="number" inputmode="numeric" min="120" max="230" step="1">
        <p class="snote">مناطق النبض تنحسب منه. إذا ما تعرفه: 220 ناقص عمرك. يطبّق على التمارين اللي توصل بعد التغيير.</p>
      </section>

      <section class="sgroup" id="notifPanel">
        <h3>التنبيهات</h3>
        <p class="snote" id="notifState">…</p>
        <div class="srow">
          <button class="btn primary sm" id="notifOn">فعّل التنبيهات</button>
          <button class="btn ghost sm" id="notifTest" hidden>جرّب تنبيه</button>
        </div>
        <div id="notifOpts" hidden>
          <label class="sw"><input type="checkbox" id="nReady"><span>فحص الجاهزية الصباحي</span></label>
          <input class="in sm" type="time" id="nReadyT">
          <label class="sw"><input type="checkbox" id="nTrain"><span>تذكير التمرين</span></label>
          <input class="in sm" type="time" id="nTrainT">
          <label class="sw"><input type="checkbox" id="nMatch"><span>قبل المباراة</span></label>
          <select class="in sm" id="nMatchB"><option value="60">بساعة</option><option value="120">بساعتين</option><option value="180">بثلاث ساعات</option></select>
          <label class="sw"><input type="checkbox" id="nWeek"><span>ملخص الأسبوع</span></label>
          <div class="srow">
            <select class="in sm" id="nWeekD"><option value="5">الجمعة</option><option value="6">السبت</option><option value="0">الأحد</option></select>
            <input class="in sm" type="time" id="nWeekT">
          </div>
          <p class="snote">التنبيه يكتبه المدرب حسب جدولك والطقس. تذكير التمرين يتخطى أيام الراحة والمباريات تلقائيًا.</p>
        </div>
        <button class="btn ghost sm" id="vapidBtn">أظهر مفاتيح التنبيهات الثابتة</button>
        <div id="vapidBox" hidden></div>
      </section>

      <section class="sgroup">
        <h3>نسخة احتياطية</h3>
        <p class="snote">بياناتك محفوظة على هذا الجهاز. صدّر نسخة من وقت لآخر، أو استورد نسخة من جهاز ثاني.</p>
        <div class="srow">
          <button class="btn ghost sm" id="expBtn">تصدير نسخة</button>
          <button class="btn ghost sm" id="impBtn">استيراد نسخة</button>
        </div>
        <input type="file" id="impFile" accept="application/json,.json" hidden>
      </section>`;

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
  renderTiles();
  renderWatchCard();
  renderSessionCard();
  renderNextMatch();
}
