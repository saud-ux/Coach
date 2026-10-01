// main.js — the entry point: shared sheet UI, tab routing, renderAll, and boot.
//
// This is the only module with top-level side effects. Everything else exports
// functions and constants and waits to be called, which is what keeps the import
// cycles between today/schedule/coach/progress/quiz harmless: by the time any
// handler here fires, every module has finished evaluating.
//
// Boot is two-phase on purpose. Phase one is synchronous and offline: read the
// device copy, fill the plan, paint. Phase two goes to the network in the
// background. A sleeping Render instance now delays the «يتم التحديث…» line and
// nothing else.

import { state, hooks, todayISO, addDays, parse, $ } from './state.js';
import { initRuntime, bootLocal, syncRemote, rt } from './storage-sync.js';
import { stopTimer, precacheSelectedStyle } from './figures.js';
import { ensureHorizon, renderSchedule, openAddMatch, openAddTest,
         loadInbox, getViewWeek, setViewWeek } from './schedule.js';
import { renderToday, openSettings } from './today.js';
import { renderReady, renderAlerts, renderReport, renderChat, send, chatBusy, abortChat,
         CHAT_CHIPS } from './coach.js';
import { renderQuiz, renderLaw } from './quiz.js';
import { renderProgress, renderCareer, renderMonth, renderLoad, renderMatches,
         loadWeather } from './progress.js';
import { renderNotif } from './notifications.js';
import { syncHealth } from './health.js';
import { icon, latinDigits, applyTheme } from './ui.js';

/* ---------- sheets ---------- */
// `bare` suppresses the corner close button for sheets that carry their own
// back control, so a screen never offers two ways to dismiss it.
// While a sheet is open the page behind it must not move. iOS ignores
// overflow:hidden on the body, so the body is pinned with position:fixed at its
// current offset and put back exactly there on close. Called directly from
// openSheet/closeSheet (so a switchTab() right after a close scrolls the
// unlocked page), with an observer on #scrim as a net for any other path.
let lockedY = null;
function lockScroll(on){
  const b = document.body;
  if (on && lockedY == null){
    lockedY = window.scrollY;
    Object.assign(b.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', width: '100%' });
  } else if (!on && lockedY != null){
    Object.assign(b.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, lockedY);
    lockedY = null;
  }
}

function openSheet(build, { bare = false } = {}){
  const sh = $('sheet');
  lockScroll(true);
  sh.innerHTML = '';
  build(sh);
  if (bare){ $('scrim').hidden = false; sh.scrollTop = 0; return; }
  const x = document.createElement('button');
  x.className = 'xclose';
  x.setAttribute('aria-label', 'إغلاق');
  x.innerHTML = icon('close');
  x.onclick = closeSheet;
  const bar = document.createElement('div');
  bar.className = 'xbar';
  bar.appendChild(x);
  sh.prepend(bar);
  $('scrim').hidden = false;
  sh.scrollTop = 0;
}
function closeSheet(){
  $('scrim').hidden = true;
  lockScroll(false);
  // Sheets own their markup, and some of them host live ids (#ready, #notifState).
  // Clearing on close keeps renderAll() from writing into detached nodes.
  $('sheet').innerHTML = '';
}

/* ---------- tabs ---------- */
const TABS = ['today','sched','chat','prog'];

function switchTab(id){
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
  TABS.forEach(s => { const el = $(s); if (el) el.hidden = s !== id; });
  renderChat();
  if (id === 'sched') scrollToday();
  else window.scrollTo(0, id === 'chat' ? document.body.scrollHeight : 0);
}

function scrollToday(){
  const t = todayISO(), cur = addDays(t, -parse(t).getDay());
  if (getViewWeek() !== cur){ setViewWeek(cur); renderSchedule(); }
  const r = $('todayRow');
  if (r) r.scrollIntoView({ block: 'center' });
}

/* ---------- render everything ---------- */
function renderAll(){
  renderToday();
  renderSchedule();
  renderReady();        // no-op unless the readiness sheet is open
  renderAlerts();
  renderQuiz();
  renderLaw();
  renderCareer();
  renderMonth();
  renderProgress();
  renderReport();
  renderLoad();
  renderMatches();
  renderChat();
  renderNotif();        // no-op unless the settings sheet is open
}

/* ---------- wiring: every DOM listener in the app, in one place ---------- */
function wire(){
  // stroke icons into the chrome. No emoji anywhere in the frame.
  const TABIC = { today:'today', sched:'calendar', chat:'chat', prog:'chart' };
  document.querySelectorAll('nav.tabs button').forEach(b => {
    b.querySelector('.tabic').innerHTML = icon(TABIC[b.dataset.tab]);
    b.onclick = () => switchTab(b.dataset.tab);
  });
  $('gearBtn').innerHTML = icon('gear');
  $('gearBtn').onclick = () => openSettings();
  $('addMatchBtn').innerHTML = icon('plus');
  $('addMatchBtn').onclick = () => openAddMatch();
  $('addTestBtn').onclick = openAddTest;

  document.querySelectorAll('#progSeg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#progSeg button').forEach(x => x.setAttribute('aria-pressed', x === b));
    document.querySelectorAll('#prog .pg').forEach(g => g.hidden = g.dataset.g !== b.dataset.g);
    window.scrollTo({ top: 0 });
  });

  $('timer').querySelector('button').onclick = () => stopTimer(false);

  // sheet dismissal
  $('scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });
  new MutationObserver(() => lockScroll(!$('scrim').hidden)).observe($('scrim'), { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('scrim').hidden) closeSheet(); });

  // coach composer
  $('sendBtn').onclick = () => { if (chatBusy()){ abortChat(); return; } const v = $('chatIn').value; $('chatIn').value = ''; send(v); };
  $('chatIn').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches){ e.preventDefault(); $('sendBtn').click(); }
  });
  CHAT_CHIPS.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t;
    b.onclick = () => { $('chatIn').value = t; $('chatIn').focus(); };
    $('chips').appendChild(b);
  });

  // a new assignment, or last night from the watch, may have landed while the app
  // was in the background. syncHealth() throttles itself to once a minute.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    loadInbox(); syncHealth();
    applyTheme(state.settings && state.settings.theme);
    renderAll();          // the greeting and the week strip follow the clock
  });
}

// a tapped reminder opens straight to its tab
function openDeepLinkTab(){
  const t = new URLSearchParams(location.search).get('tab');
  // 'sched' and 'prog' are what the push payloads have always used
  if (t && TABS.includes(t)) setTimeout(() => switchTab(t), 0);
}

/* ---------- no zoom ---------- */
// The app should behave like an app, not a page. Zoom comes from four places and
// each needs its own fix:
//   pinch                    user-scalable=no in the viewport tag (index.html)
//   pinch on iOS Safari      Safari ignores that tag, so its gesture events are cancelled here
//   double tap               touch-action:manipulation on html (css/tokens.css)
//   tapping a field          iPhone zooms into text under 16px, so every field is 16px (css/app.css)
// The cost is that nobody can pinch to enlarge text. To undo it, remove all four.
function blockZoom(){
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}

/* ---------- boot ---------- */
hooks.rerender = renderAll;
blockZoom();
initRuntime();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

// phase one: offline, synchronous, paints immediately
latinDigits(document.body);
bootLocal();
applyTheme(state.settings && state.settings.theme);
setInterval(() => applyTheme(state.settings && state.settings.theme), 5 * 60e3);
wire();
renderAll();
requestAnimationFrame(scrollToday);
openDeepLinkTab();

// phase two: the network, in the background. Each piece is independent, so a slow
// or sleeping server delays only itself.
// Health waits for the state row: syncHealth() saves when something new arrives,
// and a save while syncRemote() is in flight counts as an edit and makes it skip
// the server copy. Both talk to the same server, so waiting costs nothing.
syncRemote().then(() => { requestAnimationFrame(scrollToday); syncHealth(); });
loadWeather();
loadInbox();
precacheSelectedStyle();
claude.use('sample').then(s => { rt.sample = s; renderChat(); renderReport(); renderAlerts(); }).catch(()=>{});

export { openSheet, closeSheet, switchTab, scrollToday, renderAll };
