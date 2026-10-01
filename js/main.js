// main.js — the entry point: shared sheet UI, tab routing, renderAll, and boot.
//
// This is the only module with top-level side effects. Everything else exports
// functions and constants and waits to be called, which is what keeps the import
// cycles between schedule/coach/progress/quiz harmless: by the time any handler
// here fires, every module has finished evaluating.
//
// Boot is two-phase on purpose. Phase one is synchronous and offline: read the
// device copy, fill the plan, paint. Phase two goes to the network in the
// background. A sleeping Render instance now delays the «يتم التحديث…» line and
// nothing else.
import { state, save, hooks, num, parse, addDays, todayISO, fFull, $, LS } from './state.js';
import { initRuntime, bootLocal, syncRemote, adopt, rt } from './storage-sync.js';
import { stopTimer, precacheSelectedStyle } from './figures.js';
import { ensureHorizon, renderSchedule, renderHero, openAddMatch, openAddTest,
         loadInbox, getViewWeek, setViewWeek } from './schedule.js';
import { renderReady, renderAlerts, renderReport, renderChat, send, chatBusy, abortChat,
         CHAT_CHIPS } from './coach.js';
import { renderQuiz, renderLaw } from './quiz.js';
import { renderProgress, renderCareer, renderMonth, renderLoad, renderMatches,
         loadWeather } from './progress.js';
import { renderNotif, initNotifications } from './notifications.js';
import { syncHealth, renderSleep } from './health.js';

/* ---------- sheets ---------- */
function openSheet(build){ const sh = $('sheet'); sh.innerHTML=''; build(sh);
  const x=document.createElement('button'); x.className='xclose'; x.setAttribute('aria-label','إغلاق'); x.innerHTML='✕'; x.onclick=closeSheet;
  const bar=document.createElement('div'); bar.className='xbar'; bar.appendChild(x); sh.prepend(bar);
  $('scrim').hidden=false; sh.scrollTop=0; }
function closeSheet(){ $('scrim').hidden = true; }


/* ---------- tabs ---------- */
function switchTab(id){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===id));
  ['sched','chat','prog'].forEach(s=>$(s).hidden = s!==id);
  renderChat(); if (id==='sched') scrollToday(); else window.scrollTo(0, id==='chat'?document.body.scrollHeight:0);
}
function scrollToday(){ const t=todayISO(), cur=addDays(t,-parse(t).getDay()); if (getViewWeek()!==cur){ setViewWeek(cur); renderSchedule(); } const r=$('todayRow'); if (r) r.scrollIntoView({block:'center'}); }

/* ---------- render everything ---------- */
function renderAll(){
  const t = todayISO();
  const next = state.matches.filter(m=>m.date>=t).sort((a,b)=>a.date.localeCompare(b.date))[0];
  const nm=$('nextm'); $('hiDate').textContent = fFull.format(parse(t));
  if (next){
    const days = Math.round((parse(next.date)-parse(t))/864e5);
    nm.className='nextm'; nm.innerHTML = `<span class="card-ic"></span>${days===0?'<span class="big">اليوم</span>':`<span class="big">${num(days)}</span>`}<span class="tx">${days===0?'عندك مباراة':(days===1?'يوم على مباراتك':'أيام على مباراتك')}<small>${fFull.format(parse(next.date))}${next.time?' الساعة '+next.time:''}</small></span>`;
  } else { nm.className='nextm none'; nm.innerHTML = '<span class="card-ic"></span><span class="tx">ما فيه مباراة قادمة<small>إذا نزلت لك مباراة أضفها من الزر تحت</small></span>'; }
  renderHero(); renderSleep();
  renderReady(); renderQuiz(); renderAlerts(); renderSchedule(); renderCareer(); renderLaw(); renderMonth(); renderProgress(); renderReport(); renderLoad(); renderMatches(); renderChat(); renderNotif();
}

/* ---------- wiring: every DOM listener in the app, in one place ---------- */
function wire(){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $('todayBtn').onclick = scrollToday;
  document.querySelectorAll('#progSeg button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('#progSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b)); document.querySelectorAll('#prog .pg').forEach(g=>g.hidden=g.dataset.g!==b.dataset.g); window.scrollTo({top:0}); });
  $('timer').querySelector('button').onclick = () => stopTimer(false);
  $('addMatchBtn').onclick = openAddMatch;
  $('addTestBtn').onclick = openAddTest;
  $('expBtn').onclick = () => { const blob=new Blob([JSON.stringify(state)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='referee-backup-'+todayISO()+'.json'; document.body.appendChild(a); a.click(); a.remove(); };
  $('impBtn').onclick = () => $('impFile').click();
  $('impFile').onchange = async e => { const f=e.target.files[0]; if(!f) return; try { const d=JSON.parse(await f.text()); if(!d.sessions) throw 0; adopt(d); ensureHorizon(); save(); renderAll(); alert('تم استيراد بياناتك ✅'); } catch(_){ alert('الملف غير صالح'); } e.target.value=''; };
  $('citySel').onchange = e => { state.settings = {...(state.settings||{}), city:e.target.value}; save(); loadWeather(); };

  // sheet dismissal
  $('scrim').addEventListener('click', e => { if (e.target.id==='scrim') closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key==='Escape') closeSheet(); });

  // coach composer
  $('sendBtn').onclick = () => { if (chatBusy()){ abortChat(); return; } const v=$('chatIn').value; $('chatIn').value=''; send(v); };
  $('chatIn').addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches){ e.preventDefault(); $('sendBtn').click(); } });
  CHAT_CHIPS.forEach(t => {
    const b=document.createElement('button'); b.textContent=t; b.onclick=()=>{ $('chatIn').value=t; $('chatIn').focus(); }; $('chips').appendChild(b);
  });

  // a new assignment may have landed while the app was in the background
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadInbox(); });
}

// a tapped reminder opens straight to its tab
function openDeepLinkTab(){
  const t = new URLSearchParams(location.search).get('tab');
  if (t && ['sched','chat','prog'].includes(t)) setTimeout(() => switchTab(t), 0);
}

/* ---------- boot ---------- */
hooks.rerender = renderAll;
initRuntime();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

// phase one: offline, synchronous, paints immediately
bootLocal();
wire();
initNotifications();
renderAll();
$('citySel').value = (state.settings && state.settings.city) || 'zulfi';
requestAnimationFrame(scrollToday);
openDeepLinkTab();

// phase two: the network, in the background. Each piece is independent, so a slow
// or sleeping server delays only itself.
syncRemote().then(() => {
  $('citySel').value = (state.settings && state.settings.city) || 'zulfi';
  requestAnimationFrame(scrollToday);
});
loadWeather();
loadInbox();
syncHealth();
precacheSelectedStyle();
claude.use('sample').then(s => { rt.sample = s; renderChat(); renderReport(); renderAlerts(); }).catch(()=>{});

export { openSheet, closeSheet, switchTab, scrollToday, renderAll };
