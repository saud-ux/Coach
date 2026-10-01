// schedule.js — the training plan, the calendar, and the session sheet.
//
// The plan is generated, not stored: defaultSession(date) is a pure function of
// the date, and ensureHorizon() fills every day from PLAN_START to today+56 on
// every boot. That means the plan can never run out, and a day the user never
// touched is always regenerated rather than migrated.
//
// Imports from main.js (openSheet, closeSheet, switchTab) and coach.js (send)
// form a cycle with those modules. That is safe because all three are hoisted
// function declarations and nothing here calls them while the module is still
// evaluating — only inside event handlers, long after every module has loaded.
import { state, save, num, parse, addDays, todayISO, fWd, fDm, fFull, $, PLAN_START } from './state.js';
import { rt, inboxList, inboxRemove, hasInbox } from './storage-sync.js';
import { D, DOSE, MUS, IMG, DIAGRAMS, LEGEND, LEGEND_FOR, restHTML, flowHTML, nextHTML, ytLink, warmupHTML,
         startTimer, setHL, mediaHTML, applyView, rounds } from './figures.js';
import { matchFieldsHTML, bindMatchFields, ROLES, renderWx } from './progress.js';
import { openSheet, closeSheet, switchTab, renderAll } from './main.js';
import { icon } from './ui.js';
import { keepAwake } from './mobile.js';
import { watchWorkout, totalSec, clockOf, KIND, WATCH_NAME } from './garmin.js';
import { send } from './coach.js';

/* ---------- plan ---------- */
const TYPES = {
  run:{l:'تحمّل',c:'var(--run)'}, strength:{l:'قوة',c:'var(--strength)'}, intervals:{l:'سرعات',c:'var(--intervals)'},
  yoyo:{l:'ارتدادات ورد فعل',c:'var(--yoyo)'}, light:{l:'تنشيط',c:'var(--light)'}, rest:{l:'راحة',c:'var(--rest)'},
  recovery:{l:'استشفاء',c:'var(--recovery)'}, test:{l:'اختبار',c:'var(--test)'}, match:{l:'مباراة',c:'var(--match)'}
};
const HARD = new Set(['run','strength','intervals','yoyo','test']);
const STRENGTH = n => `${rounds(n)}، دقيقة راحة بين كل جولة:
• سكوات 15
• طعنات للخلف 10 لكل رجل
• سكوات برجل وحدة والثانية على كرسي 8 لكل رجل
• رفع السمانة على الدرج برجل وحدة 15 لكل رجل
• رفع الحوض برجل وحدة 12 لكل رجل
• العضلة الخلفية: رجلينك تحت الكنب وانزل ببطء 5
• بلانك جانبي 30 ثانية لكل جهة`;
// first 4 weeks build up, then a repeating 4-week cycle (3 steady weeks + 1 lighter week)
const BUILD = [
  {run:25,sp:5,ar:6,str:2},{run:30,sp:6,ar:8,str:3},
  {run:35,sp:6,ar:10,str:3},{run:40,sp:8,ar:12,str:3,slow:true}];
const CYCLE = [
  {run:40,sp:8,ar:12,str:3},{run:45,sp:8,ar:14,str:3},
  {run:45,sp:10,ar:15,str:3,slow:true},{run:25,sp:4,ar:6,str:2,light:true}];
function weekParams(date){
  const w = Math.floor((parse(date)-parse(PLAN_START))/(7*864e5));
  return w < 0 ? BUILD[0] : w < 4 ? BUILD[w] : CYCLE[(w-4)%4];
}
function defaultSession(date){
  const w = Math.floor((parse(date)-parse(PLAN_START))/(7*864e5));
  if (w < 0) return null;
  const p = weekParams(date);
  const dow = parse(date).getDay(); // 0 = Sunday
  if (date === PLAN_START) return {type:'test',title:'اختبار البداية: ركض 12 دقيقة',details:'إحماء 10 دقايق، ثم اركض 12 دقيقة بأعلى وتيرة تقدر تحافظ عليها. سجّل المسافة من صفحة التقدم.'};
  if (dow===6 && w>=5 && (w-5)%6===0) return {type:'test',title:'إعادة اختبار 12 دقيقة',details:'نفس طريقة اختبار البداية. إذا عندك مباراة اليوم، أجّله لبكرة. سجّل المسافة من صفحة التقدم.'};
  const tag = p.light ? ' (أسبوع خفيف)' : '';
  switch(dow){
    case 0: return {type:'run',title:`ركض تحمّل ${num(p.run)} دقيقة${tag}`,details:'بجهد 60–70%: وتيرة مريحة تقدر تتكلم فيها بجمل كاملة. نبضك في المنطقة الثانية بالساعة. بعد المغرب أفضل بسبب الحر.'};
    case 1: return {type:'strength',title:'قوة الرجلين'+tag,details:STRENGTH(p.str)+(p.slow?'\nهذا الأسبوع: انزل ببطء 3 ثواني بكل عدة.':'')};
    case 2: return {type:'rest',title:'راحة أو مشي 30 دقيقة',details:'مشي خفيف وإطالات.'};
    case 3: return {type:'intervals',title:'سرعات الحكم المساعد'+tag,details:`إحماء 10 دقايق مع خطوات جانبية خفيفة، ثم (دقيقتين راحة بين كل تمرين):
• سرعات قصيرة بجهد 90%: ${num(p.sp)} × 20 م، راحة 30ث مشي
• جانبي ثم انطلاق: ${num(p.sp)} × (8 م خطوات جانبية ثم 20 م سرعة للأمام)
• خلفي ثم انطلاق: ${num(p.sp)} × (5 م ركض للخلف ثم 10 م سرعة)
• تغيير اتجاه: 10 م أمام، 8 م جانبي، 8 م جانبي للجهة الثانية، 10 م أمام × ${num(p.light?2:4)}
كل الانطلاقات بجهد 90%، والجانبي والخلفي بسرعة مباراة. إذا نزلت جودة حركتك وقّف.
استخدم جوتي أو قوارير ماء كعلامات.`};
    case 4: return {type:'light',title:'تنشيط 20 دقيقة',details:'ركض هادي بجهد 50% + إطالات حركية. تجهيز للويكند.'};
    case 5: return {type:'rest',title:'راحة',details:'إذا عندك مباراة أضفها من زر المباراة.'};
    case 6: return {type:'yoyo',title:'ارتدادات ورد فعل'+tag,details:`إذا ما عندك مباراة. إحماء 10 دقايق، ثم:
• ارتدادات الكاحل (قفز خفيف مكانك على أطراف الأصابع) ${num(p.light?2:3)} × 20
• قفز جانبي فوق خط ${num(p.light?2:3)} × 10 لكل جهة
• قفزة طويلة من ثبات ${num(p.light?2:3)} × 5
• رد فعل: منبّه عشوائي أو أحد يصفق، وعند الإشارة غيّر اتجاهك وانطلق 5 م × 8
• تحمّل المساعد: 75 م ركض بجهد 80–85% ثم 25 م مشي × ${num(p.ar)}`};
  }
}
// keep the plan filled 8 weeks ahead, forever
function ensureHorizon(){
  let d = PLAN_START, end = addDays(todayISO(), 56), added = false;
  while (d <= end){ if (!state.sessions[d]){ const x = defaultSession(d); if (x){ state.sessions[d] = x; added = true; } } d = addDays(d,1); }
  return added;
}
function buildDefaults(){ return {}; }

/* ---------- matches ---------- */
function applyMatch(date, time, note){
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  state.matches = state.matches.filter(m => m.date !== date);
  state.matches.push({id,date,time:time||'',note:note||''});
  state.sessions[date] = {type:'match',title:'مباراة'+(time?` الساعة ${time}`:''),details:(note?note+'\n':'')+'اشرب 500 مل قبلها بساعتين، ورشفات بين الشوطين، وأملاح إذا الجو حار.'};
  const after = addDays(date,1), before = addDays(date,-1);
  const a = state.sessions[after];
  if (a && a.type!=='match' && a.type!=='test' && a.type!=='rest')
    state.sessions[after] = {type:'recovery',title:'استشفاء بعد المباراة',details:'مشي 20–30 دقيقة وإطالات. لا تمرين قوي.'};
  const b = state.sessions[before];
  if (b && HARD.has(b.type) && b.type!=='test')
    state.sessions[before] = {type:'light',title:'تنشيط قبل المباراة',details:'20 دقيقة ركض هادي + إطالات حركية.'};
}
function removeMatch(date){
  state.matches = state.matches.filter(m => m.date !== date);
  [addDays(date,-1),date,addDays(date,1)].forEach(d => {
    if (state.matches.some(m => m.date===d)) return;
    const x = defaultSession(d); if (x) state.sessions[d] = x; else delete state.sessions[d];
  });
}

/* ---------- render: schedule ---------- */
const TICON = {run:'🏃',strength:'🏋️',intervals:'⚡',yoyo:'🦘',light:'🌤️',rest:'😌',recovery:'🧘',test:'⏱️',match:'🟨'};
let viewWeek=null, slideDir=0;
function getViewWeek(){ return viewWeek; }
function setViewWeek(v){ viewWeek = v; }
function renderSchedule(){
  const dates = Object.keys(state.sessions).sort();
  const box = $('weeks'); box.innerHTML = '';
  if (!dates.length){ box.innerHTML = '<p class="empty">ما فيه جدول بعد. اطلب من المدرب يسوي لك واحد.</p>'; return; }
  const t = todayISO(), cur = addDays(t,-parse(t).getDay());
  const sun = s => addDays(s, -parse(s).getDay());
  const groups = {}; dates.forEach(d => (groups[sun(d)] ||= []).push(d));
  const weeks = Object.keys(groups).sort();
  if (!viewWeek || !groups[viewWeek]) viewWeek = groups[cur] ? cur : weeks[0];
  const wi = weeks.indexOf(viewWeek), ws = viewWeek, days = groups[ws];
  const train=days.filter(d=>!['rest','match'].includes(state.sessions[d].type)), done=train.filter(d=>state.logs[d]?.done).length;
  const pct = train.length ? Math.round(100*done/train.length) : 0;
  const rel = Math.round((parse(ws)-parse(cur))/(7*864e5));
  const name = rel===0?'هذا الأسبوع':rel===1?'الأسبوع الجاي':rel===-1?'الأسبوع الماضي':rel>1?`بعد ${num(rel)} أسابيع`:`قبل ${num(-rel)} أسابيع`;
  const light = weekParams(ws).light;
  const nav = document.createElement('div'); nav.className='wnav';
  nav.innerHTML = `<button class="wbtn" id="wPrev" ${wi<=0?'disabled':''} aria-label="الأسبوع السابق">→</button>
    <div class="wmid"><b>${name}</b><small>${fDm.format(parse(ws))} – ${fDm.format(parse(addDays(ws,6)))}${light?'، أسبوع خفيف':''}</small></div>
    <button class="wbtn" id="wNext" ${wi>=weeks.length-1?'disabled':''} aria-label="الأسبوع التالي">←</button>`;
  box.appendChild(nav);
  const strip=document.createElement('div'); strip.className='wstrip';
  for (let i=0;i<7;i++){ const d=addDays(ws,i), s=state.sessions[d], l=state.logs[d], ty=s?(TYPES[s.type]||TYPES.rest):TYPES.rest;
    const c=document.createElement('button'); c.className='wday'+(d===t?' now':'')+(l&&l.done?' dn':'')+(s&&s.type==='rest'?' rst':'');
    c.innerHTML=`<small>${['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'][i]}</small><b>${num(parse(d).getDate())}</b><i style="background:${s&&s.type!=='rest'?ty.c:'transparent'}"></i>`;
    c.onclick=()=>{ const row=box.querySelector(`.day[data-date="${d}"]`); if(row){ row.scrollIntoView({block:'center',behavior:'smooth'}); row.classList.add('flash'); setTimeout(()=>row.classList.remove('flash'),900);} };
    strip.appendChild(c); }
  box.appendChild(strip);
  const prog=document.createElement('div'); prog.className='wprog'; prog.innerHTML=`<div class="wkbar"><i style="width:${pct}%"></i></div><span>${num(done)} من ${num(train.length)} تمارين</span>`; box.appendChild(prog);
  const list=document.createElement('div'); list.className='wlist'+(slideDir?(slideDir>0?' in-next':' in-prev'):''); slideDir=0;
  days.forEach(d => {
    const s = state.sessions[d], ty = TYPES[s.type] || TYPES.rest, log = state.logs[d], isRest=s.type==='rest';
    const b = document.createElement('button');
    b.className = 'day' + (d===t?' today':'') + (d<t?' past':'') + (s.type==='match'?' match':'') + (s.type==='test'?' test':'') + (isRest?' restd':'') + (log&&log.done?' dn':'');
    b.dataset.date = d; if (d===t) b.id = 'todayRow';
    const dur = defDur(d,s);
    b.innerHTML = `<span class="dnum"><b>${num(parse(d).getDate())}</b><small></small></span>
      <span class="dic" style="--c:${ty.c}" aria-hidden="true"></span>
      <span class="t"><div class="ti"></div><div class="ty"></div></span>
      ${isRest?'':`<span class="tick ${log&&log.done?'on':''}">${log&&log.done?'✓':(d===t?'‹':'')}</span>`}`;
    b.querySelector('small').textContent = fWd.format(parse(d));
    b.querySelector('.ti').textContent = s.title;
    b.querySelector('.ty').textContent = isRest ? (s.title === ty.l ? 'جسمك يبني نفسه اليوم' : ty.l) : `${ty.l}${dur?'، '+num(dur)+' د':''}${d===t?'، اليوم':''}`;
    b.onclick = () => openDay(d);
    list.appendChild(b);
  });
  box.appendChild(list);
  const go = dir => { const n=weeks[wi+dir]; if(!n) return; viewWeek=n; slideDir=dir; renderSchedule(); };
  $('wPrev').onclick=()=>go(-1); $('wNext').onclick=()=>go(1);
  let sx=null, sy=null;
  list.addEventListener('touchstart',e=>{ sx=e.touches[0].clientX; sy=e.touches[0].clientY; },{passive:true});
  list.addEventListener('touchend',e=>{ if(sx==null) return; const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy; sx=null; if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) go(dx>0?1:-1); },{passive:true});
}

/* ---------- session shape, for the Today card ---------- */
// Warm-up / main / cool-down in minutes, so the Today card can draw a segmented
// bar. The split mirrors what FLOW already tells the user in the session sheet;
// it is presentational and nothing computes load from it.
const WARMCOOL = {
  intervals:[10,5], yoyo:[10,5], strength:[5,5], run:[5,5], test:[10,5],
  light:[0,0], recovery:[0,0], rest:[0,0], match:[0,0]
};
function sessionParts(date, s){
  const ty = TYPES[s.type] || TYPES.rest, c = ty.c;
  const total = defDur(date, s) || 0;
  const [w, cd] = WARMCOOL[s.type] || [0,0];
  const main = Math.max(1, total - w - cd);
  const out = [];
  if (w)  out.push({ label:'إحماء',  min:w,    color:`color-mix(in srgb, ${c} 40%, var(--track))` });
  out.push({ label:'التمرين', min:main, color:c });
  if (cd) out.push({ label:'تبريد', min:cd,   color:`color-mix(in srgb, ${c} 25%, var(--track))` });
  return out;
}

/* ---------- session sheet ---------- */
const EFFORT = ['سهل جدًا','سهل','متوسط','صعب','مرهق'];
function defDur(d,s){ if(!s) return 0; if(s.type==='run') return weekParams(d).run; return ({strength:35,intervals:35,yoyo:40,light:20,recovery:25,rest:0,test:25,match:105})[s.type] ?? 30; }

/* ---------- the session as a watch workout (js/garmin.js) ---------- */
// Steps to enter once in Garmin Connect; the watch then times each one and buzzes
// at every change. Shown folded, under the session's own diagrams.
function watchHTML(type, p){
  const w = watchWorkout(type, p);
  if (!w) return '';
  const zone = z => z ? `<em>منطقة ${num(z)}</em>` : '';
  const row = s => `<li class="gw-${s.k}"><span class="gwk">${KIND[s.k].ar}<small>${KIND[s.k].en}</small></span>
      <span class="gwl">${s.label}${zone(s.zone)}</span><b class="gwt">${clockOf(s.sec)}</b></li>`;
  const steps = w.steps.map(s => s.k === 'repeat'
    ? `<li class="gwrep"><div class="gwrh">كرر <b>${num(s.times)}</b> مرات<small>Repeat ${s.times}×</small></div><ol>${s.steps.map(row).join('')}</ol></li>`
    : row(s)).join('');
  return `<details class="gwatch"><summary><span class="gwic">${icon('timer')}</span><span><b>للساعة</b><small>${w.name} · حوالي ${num(Math.round(totalSec(w.steps) / 60))} دقيقة</small></span></summary>
    <p class="snote">الساعة تعدّ كل خطوة وتهتز مع كل تغيير: متى تسرع، ومتى تهدّي، وكم باقي.</p>
    <ol class="gwlist">${steps}</ol>
    <div class="gwhow"><b>تدخله مرة وحدة في قارمن كونكت:</b>
      <span>1. Training &amp; Planning ← Workouts ← Create Workout ← Run</span>
      <span>2. أضف الخطوات بالترتيب: النوع، المدة بالوقت (Time)، والهدف منطقة النبض إذا مكتوبة.</span>
      <span>3. «كرر» = Add Repeat، وحط الخطوتين داخله.</span>
      <span>4. احفظ باسم «${w.name}» بالضبط واضغط Send to Device.</span>
      <span>بعدها من الساعة: Run ← Training ← Workouts ← اسم التمرين. لو تغيّر العدد الأسبوع الجاي، عدّل رقم التكرار بس.</span></div>
  </details>`;
}

function openDay(d){
  const s = state.sessions[d]; const log = {...(state.logs[d]||{})};
  // following today's session on the phone: the screen stays on until the sheet closes
  if (d === todayISO() && s && !['rest','match'].includes(s.type)) setTimeout(() => keepAwake('session'), 0);
  openSheet(sh => {
    const ty0 = TYPES[s.type]||TYPES.rest, keys0 = DIAGRAMS[s.type]||[];
    const EFF = {run:'60–70%',intervals:'90%',yoyo:'80–90%',strength:'متوسط',light:'50%',recovery:'خفيف',test:'أقصى جهد',match:'مباراة',rest:'راحة'};
    sh.innerHTML = `<div class="shero ${s.type==='match'?'match':''}" style="--hc:${ty0.c}"><span class="sty">${ty0.l}</span><h2></h2><div class="sub"></div>
        <div class="schips">${defDur(d,s)?`<span>${icon('clock')} ${num(defDur(d,s))} دقيقة</span>`:''}${keys0.filter(k=>k!=='zones').length?`<span>${icon('scale')} ${num(keys0.filter(k=>k!=='zones').length)} تمارين</span>`:''}<span>${icon('bolt')} ${EFF[s.type]||''}</span>${WATCH_NAME[s.type]?`<span>${icon('timer')} ${WATCH_NAME[s.type]}</span>`:''}</div></div>
      <div id="dgs"></div>
      ${watchHTML(s.type, weekParams(d))}
      <details class="dtl" ${keys0.length?'':'open'}><summary>التفاصيل المكتوبة</summary><div class="details"></div></details>
      <div class="logcard"><h3 id="logH">${s.type==='match'?'قيّم المباراة':'سجّل تمرينك'}</h3>
      <label class="f" id="effL">كيف كان التمرين؟</label><div class="scale" id="sc"></div>
      <div id="mEval"></div>
      <div id="wWrap" hidden><button class="btn ghost sm" id="wImg" style="width:100%">📷 اقرأ البيانات من صورة ساعتك</button><input type="file" id="wFile" accept="image/*" hidden><div class="wres" id="wRes" hidden></div></div>
      <label class="f" for="du">المدة بالدقائق</label><input class="in" id="du" type="number" inputmode="numeric" min="0" max="240">
      <label class="f" for="nt">ملاحظة (اختياري)</label>
      <textarea class="in" id="nt" placeholder="مثلًا: السمانة شدّت علي آخر التمرين"></textarea>
      <div class="row"><button class="btn primary" id="done"></button><button class="btn ghost" id="cl">إغلاق</button></div>
      <div class="row" id="mrow"></div></div>`;
    sh.querySelector('h2').textContent = s.title;
    sh.querySelector('.sub').textContent = fFull.format(parse(d));
    sh.querySelector('.details').textContent = s.details || '';
    const keys = DIAGRAMS[s.type];
    if (keys){
      const wp = weekParams(d);
      const exList = keys.filter(k=>k!=='zones');
      sh.querySelector('#dgs').innerHTML = `${flowHTML(s.type, keys)}${warmupHTML(s.type)}${LEGEND_FOR.has(s.type)?LEGEND:''}` + keys.map(k => {
        setHL(MUS[k] ? MUS[k][0] : []);
        const art = D[k][1](); setHL([]);
        const body = mediaHTML(k, art);
        const nxt = nextHTML(s.type, keys, keys.indexOf(k));
        const exn = exList.indexOf(k);
        return `<div class="dgcard"><div class="dghead"><h4>${exn>=0&&exList.length>1?`<span class="exn">${num(exn+1)}</span>`:''}${D[k][0]}</h4>${DOSE[k]?`<span class="dose">${DOSE[k](wp)}</span>`:''}</div>${restHTML(k)}${body}${MUS[k]?`<div class="mus"><i></i>${MUS[k][1]}</div>`:''}<p>${D[k][2]}</p>${ytLink(k) ? `<a class="ytbtn" href="${ytLink(k)}" target="_blank" rel="noopener"><i>▶</i>شوف مقطع للتمرين</a>` : ''}${nxt}</div>`;
      }).join('');
      sh.querySelectorAll('.rbtn[data-s]').forEach(b => b.onclick = () => b.dataset.v
        ? startTimer(+b.dataset.s, b.dataset.l, b.dataset.v) : startTimer(+b.dataset.s, 'راحة: '+b.dataset.l));
      // switching style re-points the <img> that is already on the card instead of
      // revealing a second one that had been downloaded alongside it
      sh.querySelectorAll('.vsw button').forEach(b => b.onclick = () => applyView(sh, b.dataset.v));
    }
    const sc = sh.querySelector('#sc');
    EFFORT.forEach((l,i) => { const b=document.createElement('button'); b.textContent=l; b.setAttribute('aria-pressed', log.effort===i+1);
      b.onclick=()=>{ log.effort=i+1; sc.querySelectorAll('button').forEach((x,j)=>x.setAttribute('aria-pressed',j===i)); }; sc.appendChild(b); });
    const nt = sh.querySelector('#nt'); nt.value = log.note || '';
    const du = sh.querySelector('#du'); du.value = log.dur ?? defDur(d,s);
    let watch = log.watch || null;
    const wRes = sh.querySelector('#wRes');
    const showW = w => { if(!w){ wRes.hidden=true; return; } wRes.hidden=false; const parts=[w.duration_min&&`${num(w.duration_min)} د`, w.distance_km&&`${num(w.distance_km)} كم`, w.avg_hr&&`نبض ${num(w.avg_hr)}`, w.max_hr&&`أعلى ${num(w.max_hr)}`, w.calories&&`${num(w.calories)} سعرة`].filter(Boolean); wRes.textContent = '⌚ '+(parts.join('، ')||'ما قدرت أقرأ أرقام واضحة')+(w.summary?`\n${w.summary}`:''); };
    showW(watch);
    if (rt.sample){ (rt.sample.limits?rt.sample.limits():Promise.resolve(null)).then(c=>{ if(c&&c.images){ sh.querySelector('#wWrap').hidden=false; sh.querySelector('#wFile').accept=c.images.mediaTypes.join(','); } }).catch(()=>{}); }
    sh.querySelector('#wImg').onclick = () => sh.querySelector('#wFile').click();
    sh.querySelector('#wFile').onchange = async e => { const f=e.target.files[0]; if(!f) return; const btn=sh.querySelector('#wImg'); btn.disabled=true; btn.textContent='يقرأ الصورة…';
      try {
        const r = await rt.sample.json(`هذي صورة ملخص ${s.type==='match'?'مباراة':'تمرين'} من ساعة رياضية أو تطبيق لياقة. استخرج القيم الموجودة بوضوح فقط، ولا تخمّن. رجّع JSON فقط بهذا الشكل:
{"duration_min":رقم أو null,"distance_km":رقم أو null,"avg_hr":رقم أو null,"max_hr":رقم أو null,"calories":رقم أو null,"summary":"جملة عربية قصيرة عن الجهد"}`, {images:[f], cache:false});
        watch = {duration_min:+r.duration_min||null, distance_km:+r.distance_km||null, avg_hr:+r.avg_hr||null, max_hr:+r.max_hr||null, calories:+r.calories||null, summary:String(r.summary||'').slice(0,200)};
        if (watch.duration_min) du.value = Math.round(watch.duration_min);
        if (!log.effort && watch.avg_hr){ const e2 = watch.avg_hr>=165?5:watch.avg_hr>=150?4:watch.avg_hr>=135?3:watch.avg_hr>=115?2:1; log.effort=e2; sc.querySelectorAll('button').forEach((x,j)=>x.setAttribute('aria-pressed',j===e2-1)); }
        showW(watch);
      } catch(err){ wRes.hidden=false; wRes.textContent = err&&err.code==='rate_limited' ? 'وصلت الحد المسموح، جرّب بعد شوي.' : 'ما قدرت أقرأ الصورة. جرّب صورة أوضح لشاشة الملخص.'; }
      finally { btn.disabled=false; btn.textContent='📷 اقرأ البيانات من صورة ساعتك'; e.target.value=''; } };
    const isMatch = s.type==='match';
    let readMF = null;
    if (isMatch){
      const mObj = state.matches.find(x=>x.date===d);
      if (mObj){ sh.querySelector('#mEval').insertAdjacentHTML('beforebegin', matchFieldsHTML(mObj)); readMF = bindMatchFields(sh, mObj); }
      sh.querySelector('#effL').textContent = 'كيف كان جهد المباراة؟';
      const me = sh.querySelector('#mEval');
      const groups = [['legs','حالة رجولك بعد المباراة',['مرتاحة','خفيفة','متوسطة','ثقيلة','منهكة']],['weather','الجو',['معتدل','حار','حار ورطب']],['half','وين تعبت أكثر؟',['ما تعبت','الشوط الأول','الشوط الثاني']]];
      groups.forEach(([key,lab,opts]) => {
        const l=document.createElement('label'); l.className='f'; l.textContent=lab; me.appendChild(l);
        const w=document.createElement('div'); w.className='opts'; me.appendChild(w);
        opts.forEach((o,i)=>{ const b=document.createElement('button'); b.textContent=o; b.setAttribute('aria-pressed', log[key]===i+1);
          b.onclick=()=>{ log[key]=i+1; w.querySelectorAll('button').forEach((x,j)=>x.setAttribute('aria-pressed',j===i)); }; w.appendChild(b); });
      });
    }
    const done = sh.querySelector('#done');
    done.textContent = isMatch ? (log.done ? 'حفظ التعديل' : 'حفظ التقييم') : (log.done ? 'حفظ التعديل' : 'أنهيته ✓');
    done.onclick = () => { if (readMF) readMF(); const dv = Math.max(0, Math.min(240, parseInt(du.value,10)||defDur(d,s)));
      state.logs[d] = {done:true, effort:log.effort||null, dur:dv, note:nt.value.trim(), ...(watch?{watch}:{}), ...(isMatch?{legs:log.legs||null, weather:log.weather||null, half:log.half||null}:{})};
      save(); renderAll(); closeSheet(); };
    sh.querySelector('#cl').onclick = closeSheet;
    const mrow = sh.querySelector('#mrow');
    if (log.done){ const u=document.createElement('button'); u.className='btn ghost'; u.textContent='إلغاء الإنهاء';
      u.onclick=()=>{ delete state.logs[d]; save(); renderAll(); closeSheet(); }; mrow.appendChild(u); }
    if (s.type==='match'){ const r=document.createElement('button'); r.className='btn danger'; r.textContent='حذف المباراة';
      r.onclick=()=>{ removeMatch(d); save(); renderAll(); closeSheet(); }; mrow.appendChild(r); }
  });
}

function parseAssignText(t){
  const s=String(t||'').replace(/\s+/g,' ').trim(), link=(s.match(/https?:\/\/\S+/)||[])[0]||'';
  const body=s.replace(/https?:\/\/\S+/g,' ').replace(/\s+/g,' ').trim(), m=body.match(/مباراة\s+(.+?)\s*[Xx×]\s*(.+)$/);
  return {home:m?m[1].trim():'', away:m?m[2].trim():'', link};
}
function openAddMatch(pre){
  pre = pre || {};
  openSheet(sh => {
    sh.innerHTML = `<h2>مباراة جديدة</h2><div class="sub">أضيفها للجدول، والمدرب يعيد ترتيب الأيام اللي حولها.</div>
      <div class="imp"><b>📩 من التكليف</b>
        <textarea class="in" id="aTxt" placeholder="الصق رسالة التكليف هنا"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="aFill">عبّي من الرسالة</button><button class="btn ghost sm" id="aImg" hidden>📷 صورة صفحة التكليف</button></div>
        <input type="file" id="aFile" accept="image/*" hidden><p class="note" id="aMsg"></p></div>
      <label class="f" for="md">التاريخ</label><input class="in" type="date" id="md">
      <label class="f" for="mt">الوقت</label><input class="in" type="time" id="mt">
      ${matchFieldsHTML(pre)}
      <div class="row"><button class="btn card" id="ok">أضف المباراة</button><button class="btn ghost" id="cl">إلغاء</button></div>`;
    sh.querySelector('#md').value = pre.date || todayISO(); if (pre.time) sh.querySelector('#mt').value = pre.time;
    const mTmp={...pre}; delete mTmp.date; delete mTmp.time; delete mTmp.inboxId; let readM = bindMatchFields(sh, mTmp);
    const msg=sh.querySelector('#aMsg'), setV=(id,v)=>{ if(v) sh.querySelector(id).value=v; };
    if (pre.text) sh.querySelector('#aTxt').value = pre.text;
    sh.querySelector('#aFill').onclick = () => { const r=parseAssignText(sh.querySelector('#aTxt').value); setV('#mHome',r.home); setV('#mAway',r.away); if(r.link) mTmp.link=r.link;
      msg.textContent = r.home ? `✅ ${r.home} × ${r.away}. افتح رابط التكليف وحدد التاريخ والوقت، أو صوّر الصفحة.` : 'ما لقيت أسماء الفريقين في الرسالة.'; };
    if (rt.sample){ (rt.sample.limits?rt.sample.limits():Promise.resolve(null)).then(c=>{ if(c&&c.images) sh.querySelector('#aImg').hidden=false; }).catch(()=>{}); }
    sh.querySelector('#aImg').onclick = () => sh.querySelector('#aFile').click();
    sh.querySelector('#aFile').onchange = async e => { const f=e.target.files[0]; if(!f) return; msg.textContent='يقرأ صفحة التكليف…';
      try {
        const r = await rt.sample.json(`هذي صورة صفحة تكليف مباراة كرة قدم لحكم من الاتحاد السعودي. استخرج البيانات الموجودة بوضوح فقط ورجّع JSON فقط:
{"date":"YYYY-MM-DD بالأرقام الإنجليزية أو null","time":"HH:MM بنظام 24 ساعة أو null","home":"الفريق المستضيف أو null","away":"الفريق الضيف أو null","venue":"الملعب أو null","comp":"البطولة أو null","role":"واحد من: حكم مساعد أول، حكم مساعد ثاني، حكم رابع، حكم ساحة، أو null","crew":"أسماء بقية الطاقم أو null"}
السنة الحالية ${new Date().getFullYear()}.`, {images:[f], cache:false});
        if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) sh.querySelector('#md').value=r.date;
        if (r.time && /^\d{2}:\d{2}$/.test(r.time)) sh.querySelector('#mt').value=r.time;
        setV('#mHome',r.home); setV('#mAway',r.away); setV('#mVenue',r.venue); setV('#mComp',r.comp); setV('#mCrew',r.crew);
        const ri = ROLES.indexOf(r.role); if (ri>=0) sh.querySelector(`#mRole button[data-i="${ri}"]`)?.click();
        msg.textContent='✅ عبّيت البيانات من الصورة، راجعها قبل الإضافة.';
      } catch(err){ msg.textContent='ما قدرت أقرأ الصورة، جرّب صورة أوضح.'; }
      e.target.value=''; };
    sh.querySelector('#cl').onclick = closeSheet;
    sh.querySelector('#ok').onclick = () => {
      const d = sh.querySelector('#md').value; if (!d) return;
      readM(); const t = sh.querySelector('#mt').value, n = [mTmp.comp, mTmp.home&&mTmp.away?mTmp.home+' × '+mTmp.away:'', mTmp.venue].filter(Boolean).join('، ');
      applyMatch(d,t,n); const mm=state.matches.find(x=>x.date===d); if(mm) Object.assign(mm,mTmp); save();
      if (pre.inboxId && hasInbox()){ inboxRemove(pre.inboxId).then(loadInbox).catch(()=>{}); INBOX=INBOX.filter(x=>x.id!==pre.inboxId); }
      renderAll(); closeSheet();
      if (rt.sample) { switchTab('chat'); send(`أضفت مباراة يوم ${fFull.format(parse(d))}${t?` الساعة ${t}`:''}${n?` (${n})`:''}. رتّب لي الأيام اللي حولها.`); }
    };
  });
}

/* ---------- assignment inbox (standalone site, fed by an iOS Shortcut) ---------- */
let INBOX=[];
async function loadInbox(){ if(!hasInbox()) return; try { INBOX = await inboxList() || []; } catch(e){ INBOX=[]; } renderInbox(); }
function renderInbox(){
  const box=$('inbox'); if(!box) return; box.innerHTML='';
  INBOX.forEach(it=>{ const c=document.createElement('div'); c.className='rcard inb';
    c.innerHTML=`<span class="cav">${icon('inbox')}</span><div><b>تكليف جديد</b><small></small></div><button class="chip card">أضفه</button><button class="chip">تجاهل</button>`;
    c.querySelector('small').textContent = it.home ? `${it.home} × ${it.away}` : it.text.slice(0,60);
    const [add,skip]=c.querySelectorAll('.chip');
    add.onclick=()=>openAddMatch({home:it.home,away:it.away,link:it.link,text:it.text,inboxId:it.id});
    skip.onclick=()=>{ inboxRemove(it.id).catch(()=>{}); INBOX=INBOX.filter(x=>x.id!==it.id); renderInbox(); };
    box.appendChild(c); });
}


function openAddTest(){
  openSheet(sh => {
    sh.innerHTML = `<h2>نتيجة اختبار 12 دقيقة</h2>
      <label class="f" for="td">التاريخ</label><input class="in" type="date" id="td">
      <label class="f" for="tv">المسافة بالمتر</label><input class="in" id="tv" inputmode="decimal" placeholder="مثلًا 2500">
      <div class="row"><button class="btn primary" id="ok">حفظ</button><button class="btn ghost" id="cl">إلغاء</button></div>`;
    sh.querySelector('#td').value = todayISO();
    sh.querySelector('#cl').onclick = closeSheet;
    sh.querySelector('#ok').onclick = () => {
      const raw = sh.querySelector('#tv').value.trim().replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫,]/g,'.');
      const v = parseFloat(raw); if (!isFinite(v)) { sh.querySelector('#tv').focus(); return; }
      state.tests.push({id:'t'+Date.now().toString(36), kind:'cooper', date:sh.querySelector('#td').value||todayISO(), value:v});
      save(); renderAll(); closeSheet();
    };
  });
}


export { TYPES, HARD, TICON, EFFORT, weekParams, defaultSession, ensureHorizon, defDur,
         sessionParts, applyMatch, removeMatch, renderSchedule, openDay, openAddMatch,
         openAddTest, loadInbox, parseAssignText, getViewWeek, setViewWeek };
