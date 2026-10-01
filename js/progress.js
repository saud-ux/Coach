// progress.js — everything that measures what happened.
//
// Training load (the ACWR), the Cooper chart, the career log, the monthly report
// image, and the weather lookup that the hero line and the heat alert both read.
//
// Load is deliberately simple: load = minutes x RPE[effort], where effort is the
// 1-5 answer from the session sheet. RPE maps that onto the even numbers of a
// 0-10 axis, so changing either the table or the 1-5 input changes every past
// figure the ACWR compares against.
import { state, save, num, iso, parse, addDays, todayISO, fDm, fMon, $ } from './state.js';
import { defDur, openDay } from './schedule.js';
import { quizState } from './quiz.js';
import { readyScore, renderAlerts } from './coach.js';
import { renderAll } from './main.js';
import { rt } from './storage-sync.js';

/* ---------- progress ---------- */
function chart(points, unit){
  if (points.length < 2) return `<p class="note">${points.length? 'سجّل نتيجة ثانية عشان يظهر الرسم.' : 'ما فيه نتائج بعد.'}</p>`;
  const W=560,H=160,P=28, vals=points.map(p=>p.value), mn=Math.min(...vals), mx=Math.max(...vals), span=(mx-mn)||1;
  const xs=i=>P+(W-2*P)*i/(points.length-1), ys=v=>H-P-(H-2*P)*(v-mn)/span;
  // RTL: newest on the left
  const pts=points.map((p,i)=>`${W-xs(i)},${ys(p.value)}`).join(' ');
  const dots=points.map((p,i)=>`<circle cx="${W-xs(i)}" cy="${ys(p.value)}" r="5" fill="var(--pitch)"/><text x="${W-xs(i)}" y="${ys(p.value)-10}" text-anchor="middle" font-size="13" fill="var(--ink)">${num(p.value)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="تطور ${unit}"><polyline points="${pts}" fill="none" stroke="var(--pitch)" stroke-width="3" stroke-linejoin="round"/>${dots}</svg>`;
}
function renderProgress(){
  const t = todayISO(), sun = addDays(t,-parse(t).getDay());
  const trainDays = Object.entries(state.sessions).filter(([d,s]) => d<=t && !['rest','match'].includes(s.type));
  const doneAll = trainDays.filter(([d]) => state.logs[d]?.done).length;
  const wk = trainDays.filter(([d]) => d>=sun);
  const wkDone = wk.filter(([d]) => state.logs[d]?.done).length;
  const played = state.matches.filter(m => m.date<=t).length;
  const pct = trainDays.length ? Math.round(100*doneAll/trainDays.length) : 0;
  $('stats').innerHTML = `
    <div class="stat"><b>${num(wkDone)}/${num(wk.length)}</b><span>تمارين هذا الأسبوع</span></div>
    <div class="stat"><b>${num(pct)}%</b><span>الالتزام منذ البداية</span></div>
    <div class="stat"><b>${num(doneAll)}</b><span>تمارين أنهيتها</span></div>
    <div class="stat"><b>${num(played)}</b><span>مباريات حكمتها</span></div>`;
  ['cooper'].forEach(k => {
    const list = state.tests.filter(x=>x.kind===k).sort((a,b)=>a.date.localeCompare(b.date));
    const id = k==='cooper'?'Cooper':'Yoyo';
    $('chart'+id).innerHTML = chart(list, k==='cooper'?'المسافة':'المستوى');
    const ul = $('list'+id); ul.innerHTML='';
    list.slice().reverse().forEach(x => {
      const li=document.createElement('li'); const sp=document.createElement('span');
      sp.textContent = `${fDm.format(parse(x.date))}: ${num(x.value)}${k==='cooper'?' م':''}`;
      const del=document.createElement('button'); del.textContent='حذف';
      del.onclick=()=>{ state.tests=state.tests.filter(y=>y.id!==x.id); save(); renderAll(); };
      li.append(sp,del); ul.appendChild(li);
    });
  });
}

/* ---------- training load ---------- */
const RPE = [0,2,4,6,8,10];
// A session measured by the watch carries hr_load, already in minutes x RPE units
// (health.js hrLoad), and that wins over the felt effort. Everything else is
// minutes x RPE[effort], as it always was.
function dayLoad(d){ const l=state.logs[d]; if(!l||!l.done) return 0;
  if (Number.isFinite(l.hr_load) && l.hr_load > 0) return l.hr_load;
  const dur = l.dur ?? defDur(d,state.sessions[d]); return dur*RPE[l.effort||3]; }
function sumLoad(from,to){ let s=0,d=from; while(d<=to){ s+=dayLoad(d); d=addDays(d,1);} return s; }
function loadStatus(){
  const t=todayISO(), acute=sumLoad(addDays(t,-6),t), chronic=sumLoad(addDays(t,-27),t)/4;
  const first=Object.keys(state.logs).filter(d=>state.logs[d].done).sort()[0];
  const enough=!!first && (parse(t)-parse(first))/864e5>=14;
  const ratio=chronic>0?acute/chronic:null;
  let lbl='بيانات غير كافية', cls='grn';
  if (enough && ratio!=null){ if(ratio>1.5){lbl='خطر إرهاق';cls='red';} else if(ratio>1.3){lbl='انتبه';cls='yel';} else if(ratio>=0.8){lbl='منطقة آمنة';cls='grn';} else {lbl='حمل منخفض';cls='yel';} }
  return {acute,chronic,ratio,enough,lbl,cls};
}
const LEGS=['','مرتاحة','خفيفة','متوسطة','ثقيلة','منهكة'], WEA=['','معتدل','حار','حار ورطب'], HALF=['','ما تعبت','تعب بالشوط الأول','تعب بالشوط الثاني'];

/* ---------- career log ---------- */
const ROLES=['حكم مساعد أول','حكم مساعد ثاني','حكم رابع','حكم ساحة'];
const seasonOf = d => { const x=parse(d), y=x.getFullYear(); return x.getMonth()>=7 ? `${y}/${y+1}` : `${y-1}/${y}`; };
let careerSeason=null;
function renderCareer(){
  const box=$('careerPanel'); if(!box) return; const t=todayISO();
  const played=state.matches.filter(m=>m.date<=t);
  const seasons=[...new Set(played.map(m=>seasonOf(m.date)).concat([seasonOf(t)]))].sort().reverse();
  if (!careerSeason || !seasons.includes(careerSeason)) careerSeason=seasons[0];
  const ms=played.filter(m=>seasonOf(m.date)===careerSeason).sort((a,b)=>b.date.localeCompare(a.date));
  const scores=ms.map(m=>parseFloat(m.score)).filter(x=>isFinite(x));
  const avg=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length):null;
  const byRole={}; ms.forEach(m=>{ if(m.role) byRole[m.role]=(byRole[m.role]||0)+1; });
  const byComp={}; ms.forEach(m=>{ if(m.comp) byComp[m.comp]=(byComp[m.comp]||0)+1; });
  const topComp=Object.entries(byComp).sort((a,b)=>b[1]-a[1])[0];
  box.innerHTML=`<div class="wkh"><div><b>مسيرتي التحكيمية</b><small>موسم ${careerSeason.split('/').map(x=>Number(x).toLocaleString('ar-SA-u-nu-latn',{useGrouping:false})).reverse().join(' – ')}</small></div>${seasons.length>1?'<select class="in sm" id="seasonSel" style="width:auto"></select>':''}</div>
    <div class="stats" style="margin-top:10px"><div class="stat"><b>${num(ms.length)}</b><span>مباريات</span></div><div class="stat"><b>${avg!=null?num(avg.toFixed(1)):'–'}</b><span>متوسط التقييم</span></div></div>
    ${Object.keys(byRole).length?`<p class="note" style="margin-top:10px">${Object.entries(byRole).map(([r,n])=>`${ROLES[r]}: ${num(n)}`).join('، ')}</p>`:''}
    ${topComp?`<p class="note">أكثر بطولة: ${topComp[0]} (${num(topComp[1])})</p>`:''}`;
  const sel=box.querySelector('#seasonSel'); if(sel){ seasons.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s.split('/').map(x=>Number(x).toLocaleString('ar-SA-u-nu-latn',{useGrouping:false})).reverse().join(' – '); if(s===careerSeason) o.selected=true; sel.appendChild(o); }); sel.onchange=()=>{ careerSeason=sel.value; renderCareer(); }; }
  const ul=document.createElement('ul'); ul.className='mlist';
  if (!ms.length){ box.insertAdjacentHTML('beforeend','<p class="note">لما تضيف مباراة وتقيّمها، تطلع هنا مع بيانات البطولة والفريقين وتقييم المقيّم.</p>'); return; }
  ms.forEach(m=>{ const li=document.createElement('li'); li.className='cm'; li.onclick=()=>openDay(m.date);
    const teams = m.home||m.away ? `${m.home||'؟'} × ${m.away||'؟'}` : 'مباراة';
    li.innerHTML=`<div><b></b><small></small></div>${m.score?`<span class="sc">${num(m.score)}</span>`:'<span class="sc none">قيّم</span>'}`;
    li.querySelector('b').textContent=teams;
    li.querySelector('small').textContent=[fDm.format(parse(m.date)), m.comp, m.role!=null&&m.role!==''?ROLES[m.role]:''].filter(Boolean).join('، ');
    ul.appendChild(li); });
  box.appendChild(ul);
}
function matchFieldsHTML(m){
  return `<div class="mf"><h4>بيانات المباراة</h4>
    <label class="f" for="mComp">البطولة</label><input class="in" id="mComp" placeholder="مثلًا: دوري الدرجة الثانية">
    <div class="two"><div><label class="f" for="mHome">المستضيف</label><input class="in" id="mHome"></div><div><label class="f" for="mAway">الضيف</label><input class="in" id="mAway"></div></div>
    <label class="f">دورك</label><div class="opts" id="mRole">${ROLES.map((r,i)=>`<button data-i="${i}" aria-pressed="${String(m&&String(m.role)===String(i))}">${r}</button>`).join('')}</div>
    <label class="f" for="mVenue">الملعب</label><input class="in" id="mVenue" placeholder="مثلًا: ملعب نادي الزلفي">
    <label class="f" for="mCrew">طاقم التحكيم (اختياري)</label><input class="in" id="mCrew" placeholder="الحكم والمساعد الثاني">
    <div class="two"><div><label class="f" for="mScore">تقييم المقيّم</label><input class="in" id="mScore" inputmode="decimal" placeholder="مثلًا 8.4"></div><div></div></div>
    <label class="f" for="mAssess">ملاحظات المقيّم</label><textarea class="in" id="mAssess" placeholder="وش قال عن تمركزك وقراراتك"></textarea>
    <div class="evbox">
      <button class="btn ghost evbtn" id="evBtn" type="button">📷 استورد تقييم المقيّم من موقع الاتحاد</button>
      <p class="snote">صوّر صفحة التقييم من «ماي ساف». إذا الصفحة طويلة اختر كذا صورة مرة وحدة.</p>
      <input type="file" id="evFile" accept="image/*" multiple hidden>
      <div id="evOut"></div>
    </div></div>`;
}

/* ---------- the assessor's evaluation, read from MySAFF screenshots ----------
   The federation's assessor report (cp.saff.sa) lists positive points and points
   to improve, each with the match minutes it happened in, written "85*52*15*2".
   Claude reads one screenshot at a time (the runtime takes one image per call)
   and the results are merged, so a long page can come in several pictures.
   Stored on the match as m.eval = { title, score, positives:[{t, min:[...]}],
   improve:[{t, min:[...]}], at }. */
const EVAL_PROMPT = `هذي صورة من صفحة تقييم حكم كرة قدم في منصة الاتحاد السعودي (ماي ساف). استخرج الموجود بوضوح فقط ولا تخمّن.
النقاط مقسومة لقسمين: «النقاط الإيجابية»، و«النقاط السلبية» أو «نقاط للتطوير» أو «الملاحظات». كل نقطة معها «التوقيت»: دقائق المباراة مفصولة بنجمة، مثل 85*52*15*2 تعني الدقائق 85 و52 و15 و2.
رجّع JSON فقط بهذا الشكل:
{"title":"عنوان التقييم إن وجد أو فارغ","score":رقم الدرجة إن ظهرت أو null,"positives":[{"t":"نص النقطة كما هو","min":[أرقام الدقائق]}],"improve":[{"t":"نص النقطة كما هو","min":[أرقام الدقائق]}]}
إذا ما فيه قسم في الصورة رجّعه قائمة فاضية. الأرقام بالإنجليزي.`;

const cleanMin = a => (Array.isArray(a) ? a : String(a || '').split(/[*×x,، ]+/))
  .map(n => parseInt(String(n).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)), 10))
  .filter(n => n >= 0 && n <= 130);
const cleanPts = a => (Array.isArray(a) ? a : []).map(x => ({ t: String((x && x.t) || '').trim().slice(0, 160), min: cleanMin(x && x.min) }))
  .filter(x => x.t);
function mergeEval(a, b){
  const add = (list, more) => { for (const p of more){ const hit = list.find(x => x.t === p.t);
    if (hit) hit.min = [...new Set([...hit.min, ...p.min])]; else list.push(p); } return list; };
  return {
    title: a.title || b.title || '',
    score: a.score ?? b.score ?? null,
    positives: add([...(a.positives || [])], b.positives || []),
    improve: add([...(a.improve || [])], b.improve || []),
    at: todayISO()
  };
}
function evalHTML(ev){
  if (!ev || (!ev.positives.length && !ev.improve.length)) return '';
  const list = (pts, cls) => pts.map(p => `<li class="${cls}"><span>${esc(p.t)}</span>${p.min.length
    ? `<span class="evmin">${[...p.min].sort((x, y) => x - y).map(n => `<i>${num(n)}'</i>`).join('')}</span>` : ''}</li>`).join('');
  return `<div class="eval">
    ${ev.title ? `<p class="evtitle">${esc(ev.title)}${ev.score != null ? ` · <b>${num(ev.score)}</b>` : ''}</p>` : ''}
    ${ev.positives.length ? `<h5 class="evh good">النقاط الإيجابية (${num(ev.positives.length)})</h5><ul>${list(ev.positives, 'good')}</ul>` : ''}
    ${ev.improve.length ? `<h5 class="evh fix">نقاط للتطوير (${num(ev.improve.length)})</h5><ul>${list(ev.improve, 'fix')}</ul>` : ''}
  </div>`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Across every evaluated match: which points come back. What the coach builds on.
function assessorTrends(){
  const count = key => { const m = new Map();
    for (const x of state.matches) for (const p of ((x.eval && x.eval[key]) || [])) m.set(p.t, (m.get(p.t) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ t, n })); };
  const n = state.matches.filter(x => x.eval).length;
  return n ? { matches: n, improve: count('improve'), positives: count('positives') } : null;
}
function bindMatchFields(sh, m){
  const set=(id,v)=>{ const el=sh.querySelector(id); if(el&&v!=null) el.value=v; };
  set('#mComp',m.comp); set('#mVenue',m.venue); set('#mHome',m.home); set('#mAway',m.away); set('#mCrew',m.crew); set('#mScore',m.score); set('#mAssess',m.assess);
  let ev = m.eval || null;
  const out = sh.querySelector('#evOut'), btn = sh.querySelector('#evBtn'), file = sh.querySelector('#evFile');
  out.innerHTML = evalHTML(ev);
  if (!rt.sample){ btn.disabled = true; btn.textContent = 'قراءة الصور تحتاج اتصال بالمدرب'; }
  btn.onclick = () => file.click();
  file.onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    btn.disabled = true;
    let got = { positives: [], improve: [] }, failed = 0;
    for (let i = 0; i < files.length; i++){
      btn.textContent = `يقرأ الصورة ${num(i + 1)} من ${num(files.length)}…`;
      try {
        const r = await rt.sample.json(EVAL_PROMPT, { images: [files[i]], cache: false });
        const sc = parseFloat(String(r.score ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫,]/, '.'));
        got = mergeEval(got, { title: String(r.title || '').slice(0, 80), score: isFinite(sc) && sc > 0 && sc <= 10 ? sc : null,
                               positives: cleanPts(r.positives), improve: cleanPts(r.improve) });
      } catch (err){ failed++; }
    }
    // a second import of the same match adds to what is there
    ev = ev ? mergeEval(ev, got) : mergeEval(got, {});
    out.innerHTML = evalHTML(ev) || '<p class="snote">ما لقيت نقاط واضحة في الصورة. جرّب صورة أوضح لجدول النقاط.</p>';
    if (failed) out.insertAdjacentHTML('beforeend', `<p class="snote" style="color:var(--max)">ما قدرت أقرأ ${num(failed)} من الصور.</p>`);
    const scEl = sh.querySelector('#mScore');
    if (ev.score != null && scEl && !scEl.value) scEl.value = ev.score;
    btn.disabled = false; btn.textContent = '📷 أضف صور ثانية للتقييم'; e.target.value = '';
  };
  let role = m.role;
  sh.querySelectorAll('#mRole button').forEach(b=>b.onclick=()=>{ role=b.dataset.i; sh.querySelectorAll('#mRole button').forEach(x=>x.setAttribute('aria-pressed',x===b)); });
  return () => { const v=id=>(sh.querySelector(id)?.value||'').trim(); const sc=v('#mScore').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫,]/g,'.');
    Object.assign(m,{venue:v('#mVenue'),comp:v('#mComp'),home:v('#mHome'),away:v('#mAway'),crew:v('#mCrew'),assess:v('#mAssess'),role:role??'',score:isFinite(parseFloat(sc))?String(parseFloat(sc)):''});
    if (ev) m.eval = ev; };
}

/* ---------- weather (Open-Meteo, works on the standalone site) ---------- */
const CITIES={zulfi:{n:'الزلفي',lat:26.2994,lon:44.8154},riyadh:{n:'الرياض',lat:24.7136,lon:46.6753},majmaah:{n:'المجمعة',lat:25.9038,lon:45.3456}};
let WX=null;
async function loadWeather(){
  const c=CITIES[(state.settings&&state.settings.city)||'zulfi']||CITIES.zulfi;
  try {
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m&forecast_days=2&timezone=Asia%2FRiyadh`);
    if(!r.ok) throw 0; const d=await r.json(); const t=todayISO(); const H={};
    d.hourly.time.forEach((tm,i)=>{ if(tm.startsWith(t)) H[+tm.slice(11,13)]={t:d.hourly.temperature_2m[i],f:d.hourly.apparent_temperature[i],h:d.hourly.relative_humidity_2m[i]}; });
    const win=[16,17,18,19,20,21,22,23].filter(x=>H[x]); if(!win.length) throw 0;
    const best=win.reduce((a,b)=>H[b].f<H[a].f?b:a), at18=H[18]||H[win[0]];
    WX={city:c.n,H,best,at18,hot:at18.f>=38};
  } catch(e){ WX=null; }
  renderWx(); renderAlerts();
}
const hr12 = h => `${num(h>12?h-12:h)} ${h>=12?'م':'ص'}`;
function renderWx(){
  const el=$('wxLine'); if(!el) return; if(!WX){ el.hidden=true; return; }
  el.hidden=false; const b=WX.H[WX.best];
  // no emoji in the chrome: the line is plain text and the heat warning, when it
  // matters, is the coloured alert on المدرب
  el.textContent=`${WX.city}: الساعة 6 م ${num(Math.round(WX.at18.t))}° (تحسها ${num(Math.round(WX.at18.f))}°)، أنسب وقت ${hr12(WX.best)} (${num(Math.round(b.f))}°)`;
}

/* ---------- monthly report (shareable image) ---------- */
let monthSel=null;
function monthStats(ym){
  const [y,m]=ym.split('-').map(Number), start=`${ym}-01`, end=iso(new Date(y,m,0)), t=todayISO(), last = end<t?end:t;
  let planned=0, done=0, mins=0; const weeks={};
  for (let d=start; d<=last; d=addDays(d,1)){ const s=state.sessions[d], l=state.logs[d];
    if (s && !['rest','match'].includes(s.type)){ planned++; if(l&&l.done) done++; }
    if (l&&l.done){ const mn=l.dur ?? defDur(d,s); mins+=mn; const ws=addDays(d,-parse(d).getDay()); weeks[ws]=(weeks[ws]||0)+mn; } }
  const ms=state.matches.filter(x=>x.date>=start&&x.date<=last), sc=ms.map(x=>parseFloat(x.score)).filter(isFinite);
  const rd=Object.entries(state.readiness||{}).filter(([d])=>d>=start&&d<=last).map(([,r])=>readyScore(r));
  const Q=quizState(), qa=Object.values(Q.answers).filter(a=>a.date>=start&&a.date<=last), ex=(Q.exams||[]).filter(e=>e.date>=start&&e.date<=last);
  const coop=state.tests.filter(x=>x.kind==='cooper'&&x.date<=last).sort((a,b)=>a.date.localeCompare(b.date));
  return {ym, start, end, planned, done, adh: planned?Math.round(100*done/planned):0, mins, matches:ms.length, score: sc.length?sc.reduce((a,b)=>a+b,0)/sc.length:null,
    ready: rd.length?Math.round(rd.reduce((a,b)=>a+b,0)/rd.length/5*100):null, qn:qa.length, qacc: qa.length?Math.round(100*qa.filter(a=>a.ok).length/qa.length):null,
    exam: ex.length?Math.max(...ex.map(e=>Math.round(100*e.right/e.total))):null, cooper: coop.length?coop[coop.length-1].value:null, weeks};
}
function renderMonth(){
  const box=$('monthPanel'); if(!box) return; const t=todayISO(), cur=t.slice(0,7);
  const months=[...new Set([cur, ...Object.keys(state.logs).map(d=>d.slice(0,7)), ...state.matches.map(x=>x.date.slice(0,7))])].filter(x=>x<=cur).sort().reverse();
  if (!monthSel || !months.includes(monthSel)) monthSel=months[0];
  const S=monthStats(monthSel);
  box.innerHTML=`<div class="phead"><h3>تقرير الشهر</h3><select class="in sm" id="monSel" style="width:auto"></select></div>
    <p class="note">التزامك ${num(S.adh)}%، ${num(S.done)} من ${num(S.planned)} تمارين، ${num(S.matches)} ${S.matches===1?'مباراة':'مباريات'}، ${num(Math.round(S.mins))} دقيقة تدريب.</p>
    <button class="btn primary" id="monBtn" style="width:100%;margin-top:10px">🖼️ أنشئ صورة التقرير للمشاركة</button><div id="monOut"></div>`;
  const sel=box.querySelector('#monSel'); months.forEach(mo=>{ const o=document.createElement('option'); o.value=mo; o.textContent=fMon.format(parse(mo+'-01')); if(mo===monthSel) o.selected=true; sel.appendChild(o); });
  sel.onchange=()=>{ monthSel=sel.value; renderMonth(); };
  box.querySelector('#monBtn').onclick=async()=>{ const out=box.querySelector('#monOut'); out.innerHTML='<p class="note">يجهز الصورة…</p>';
    try { const url=await drawMonth(S); out.innerHTML=`<img class="mrimg" alt="تقرير الشهر" src="${url}"><p class="note" style="margin-top:8px">اضغط مطولًا على الصورة لحفظها أو مشاركتها.</p>`;
      if (navigator.canShare){ const blob=await (await fetch(url)).blob(), file=new File([blob],`report-${S.ym}.png`,{type:'image/png'});
        if (navigator.canShare({files:[file]})){ const b=document.createElement('button'); b.className='btn card'; b.style.width='100%'; b.style.marginTop='8px'; b.textContent='مشاركة'; b.onclick=()=>navigator.share({files:[file],title:'تقريري الشهري'}).catch(()=>{}); out.appendChild(b); } }
    } catch(e){ out.innerHTML='<p class="note">تعذّر إنشاء الصورة.</p>'; } };
}
async function drawMonth(S){
  try { await Promise.all(['400','600','700'].map(w=>document.fonts.load(`${w} 40px "IBM Plex Sans Arabic"`))); } catch(e){}
  const W=1080,H=1350,c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'); x.direction='rtl';
  const F=(w,s)=>`${w} ${s}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const rr=(X,Y,w,h,r)=>{ x.beginPath(); x.moveTo(X+r,Y); x.arcTo(X+w,Y,X+w,Y+h,r); x.arcTo(X+w,Y+h,X,Y+h,r); x.arcTo(X,Y+h,X,Y,r); x.arcTo(X,Y,X+w,Y,r); x.closePath(); };
  // the shareable image follows the app: near-black page, one surface panel per tile
  x.fillStyle='#07080A'; x.fillRect(0,0,W,H);
  const g=x.createLinearGradient(0,0,0,520); g.addColorStop(0,'#14171C'); g.addColorStop(1,'#101216'); x.fillStyle=g; rr(0,-40,W,560,60); x.fill();
  x.globalAlpha=.05; x.fillStyle='#9B8CFF'; for(let i=0;i<8;i++) x.fillRect(0,i*70,W,35); x.globalAlpha=1;
  // flag
  x.save(); x.translate(90,90); x.rotate(-.12); x.fillStyle='#EDEDED'; x.fillRect(0,0,10,120); x.fillStyle='#FFD21F'; x.fillRect(10,4,80,60); x.fillStyle='#E0301E'; x.fillRect(10,4,40,30); x.fillRect(50,34,40,30); x.restore();
  x.textAlign='right'; x.fillStyle='#F2F4F7';
  x.font=F(600,68); x.fillText('تقريري الشهري',W-70,130);
  x.font=F(400,40); x.fillStyle='#C9CED6'; x.fillText(fMon.format(parse(S.ym+'-01')),W-70,190);
  x.font=F(400,32); x.fillStyle='#8B93A1'; x.fillText('سعود، حكم مساعد',W-70,240);
  // big adherence
  x.fillStyle='#F2F4F7'; x.font=F(600,150); x.fillText(num(S.adh)+'%',W-70,420);
  x.font=F(400,36); x.fillStyle='#8B93A1'; x.fillText('التزام بالتمارين',W-70,470);
  // ring
  const cx=230,cy=340,R=110; x.lineWidth=26; x.strokeStyle='#1E232B'; x.beginPath(); x.arc(cx,cy,R,0,Math.PI*2); x.stroke();
  x.strokeStyle='#3DDC84'; x.lineCap='round'; x.beginPath(); x.arc(cx,cy,R,-Math.PI/2,-Math.PI/2+Math.PI*2*S.adh/100); x.stroke();
  x.textAlign='center'; x.fillStyle='#F2F4F7'; x.font=F(600,52); x.fillText(`${num(S.done)}/${num(S.planned)}`,cx,cy+10); x.font=F(400,26); x.fillStyle='#8B93A1'; x.fillText('تمرين',cx,cy+50);
  // tiles
  // no emoji: each tile is labelled, and a small colour bar carries the meaning
  const tiles=[['#4AA3FF','دقائق التدريب',num(Math.round(S.mins))],['#F2C230','مباريات',num(S.matches)],['#9B8CFF','متوسط التقييم',S.score!=null?num(S.score.toFixed(1)):'–'],
    ['#3DDC84','متوسط الجاهزية',S.ready!=null?num(S.ready)+'%':'–'],['#FF7A45','دقة القانون',S.qacc!=null?num(S.qacc)+'%':'–'],['#FF4D5E','أفضل اختبار',S.exam!=null?num(S.exam)+'%':'–']];
  tiles.forEach((tl,i)=>{ const col=i%2, row=Math.floor(i/2), tw=450, th=150, X=W-70-tw-col*(tw+40), Y=560+row*(th+26);
    x.fillStyle='#101216'; rr(X,Y,tw,th,30); x.fill();
    x.fillStyle=tl[0]; rr(X+tw-34,Y+30,6,36,3); x.fill();
    x.textAlign='right'; x.fillStyle='#8B93A1'; x.font=F(400,30); x.fillText(tl[1],X+tw-52,Y+60);
    x.fillStyle='#F2F4F7'; x.font=F(600,60); x.fillText(tl[2],X+tw-52,Y+125); });
  // weekly minutes bars
  const wk=Object.entries(S.weeks).sort(), mx=Math.max(60,...wk.map(w=>w[1])); const bx0=70, bw=W-140, by=1255, bh=100;
  x.textAlign='right'; x.fillStyle='#8B93A1'; x.font=F(400,28); x.fillText('دقائق التدريب كل أسبوع',W-70,by-bh-24); if(!wk.length){ x.textAlign='center'; x.fillStyle='#6E7684'; x.fillText('ما فيه تمارين مسجلة هالشهر',W/2,by-40); }
  const n=Math.max(wk.length,1), gap=24, w1=(bw-gap*(n-1))/n;
  wk.forEach(([ws,v],i)=>{ const X=W-70-(i+1)*w1-i*gap, hh=Math.max(8,bh*v/mx); x.fillStyle='#4AA3FF'; rr(X,by-hh,w1,hh,10); x.fill(); x.textAlign='center'; x.fillStyle='#8B93A1'; x.font=F(400,22); x.fillText(num(Math.round(v)),X+w1/2,by+30); });
  x.textAlign='center'; x.fillStyle='#6E7684'; x.font=F(400,24); x.fillText('جدول الحكم',W/2,H-30);
  return c.toDataURL('image/png');
}

/* ---------- load + matches panels ---------- */
function renderLoad(){
  const box=$('loadPanel'), t=todayISO(), sun=addDays(t,-parse(t).getDay()), L=loadStatus();
  const weeks=[]; for(let i=5;i>=0;i--){ const ws=addDays(sun,-7*i); weeks.push({ws,v:sumLoad(ws,addDays(ws,6))}); }
  const mx=Math.max(1,...weeks.map(w=>w.v)), W=560,H=150,bw=60,gap=(W-6*bw)/7;
  const bars=weeks.map((w,i)=>{ const x=W-gap-(i+1)*bw-i*gap, hgt=Math.max(2,(H-40)*w.v/mx); return `<rect x="${x}" y="${H-22-hgt}" width="${bw}" height="${hgt}" rx="6" fill="${i===5?'var(--pitch)':'var(--line)'}"/><text x="${x+bw/2}" y="${H-6}" text-anchor="middle" font-size="13" fill="var(--muted)">${fDm.format(parse(w.ws))}</text>${w.v?`<text x="${x+bw/2}" y="${H-28-hgt}" text-anchor="middle" font-size="12" fill="var(--ink)">${num(Math.round(w.v))}</text>`:''}`; }).join('');
  box.innerHTML=`<h3>حمل التدريب</h3>
    <div class="gauge"><b style="color:${L.cls==='red'?'var(--red)':L.cls==='yel'?'#C99A1E':'var(--pitch)'}">${L.enough&&L.ratio!=null?num(L.ratio.toFixed(2)):'–'}</b><span>${L.lbl}</span></div>
    <p class="note">${L.enough?'نسبة حمل آخر 7 أيام إلى معدل آخر 4 أسابيع. المنطقة الآمنة بين 0.8 و1.3.':'يحتاج أسبوعين من تسجيل التمارين عشان تظهر النسبة.'} الحمل = مدة التمرين × الجهد.</p>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="الحمل الأسبوعي">${bars}</svg>`;
}
function renderMatches(){
  const box=$('matchPanel'), t=todayISO();
  const ms=state.matches.filter(m=>m.date<=t).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  box.innerHTML='<h3>تقييم المباريات</h3>';
  if (!ms.length){ box.insertAdjacentHTML('beforeend','<p class="note">بعد كل مباراة، افتحها من الجدول وقيّمها.</p>'); return; }
  const ul=document.createElement('ul'); ul.className='mlist';
  let secondHalf=0, heavy=0;
  ms.forEach(m=>{ const l=state.logs[m.date]; const li=document.createElement('li');
    if (l&&l.done){ if(l.half===3) secondHalf++; if(l.legs>=4) heavy++;
      li.textContent=`${fDm.format(parse(m.date))}: رجولك ${LEGS[l.legs]||'—'}، ${WEA[l.weather]||'—'}، ${HALF[l.half]||'—'}`; }
    else { li.textContent=`${fDm.format(parse(m.date))}: ما تقيّمت بعد`; li.style.color='var(--muted)'; li.style.cursor='pointer'; li.onclick=()=>openDay(m.date); }
    ul.appendChild(li); });
  box.appendChild(ul);
  const tr = assessorTrends();
  if (tr && (tr.improve.length || tr.positives.length)){
    const d=document.createElement('div'); d.className='trends';
    d.innerHTML = `<h4>من تقييمات المقيّمين (${num(tr.matches)} ${tr.matches===1?'مباراة':'مباريات'})</h4>
      ${tr.improve.length?`<p class="evh fix">يتكرر للتطوير</p><ul>${tr.improve.slice(0,3).map(x=>`<li class="fix"><span>${esc(x.t)}</span><span class="evn">${num(x.n)}×</span></li>`).join('')}</ul>`:''}
      ${tr.positives.length?`<p class="evh good">نقاط قوتك</p><ul>${tr.positives.slice(0,3).map(x=>`<li class="good"><span>${esc(x.t)}</span><span class="evn">${num(x.n)}×</span></li>`).join('')}</ul>`:''}`;
    box.appendChild(d);
  }
  if (secondHalf>=2 || heavy>=2){ const p=document.createElement('p'); p.className='note'; p.style.marginTop='8px';
    p.textContent = secondHalf>=2 ? 'تتعب بالشوط الثاني بشكل متكرر. تمارين تحمّل الحكم المساعد يوم السبت هي أهم شي لك.' : 'رجولك تطلع ثقيلة بعد أكثر من مباراة. ركّز على تمرين القوة والاستشفاء بعد المباريات.'; box.appendChild(p); }
}

// WX is reassigned on every weather fetch, so readers take it through a getter.
export function getWX(){ return WX; }

export { chart, renderProgress, RPE, dayLoad, sumLoad, loadStatus, LEGS, WEA, HALF,
         ROLES, seasonOf, renderCareer, matchFieldsHTML, bindMatchFields,
         CITIES, loadWeather, hr12, renderWx, monthStats, renderMonth, drawMonth,
         renderLoad, renderMatches, assessorTrends, evalHTML };
