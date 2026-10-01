// coach.js — the readiness check, the alert stack, the weekly report, and chat.
//
// All four are the same thing wearing different clothes: they read the state, hand
// Claude a snapshot, and write back either a sentence or a set of session edits.
//
// The readiness check is the one with teeth. Three 1-5 answers average into a
// score, and a score under 2.5 on a hard day rewrites that day on the spot -
// stashing the original under sessions[d].orig so it can be put back.
//
// send() is the only place that applies the coach's edits, and applyChanges()
// refuses anything dated before today, so the coach can never rewrite history.
import { state, save, num, parse, addDays, todayISO, fWd, fDm, $ } from './state.js';
import { rt } from './storage-sync.js';
import { TYPES, HARD, defDur, applyMatch, removeMatch, openDay } from './schedule.js';
import { loadStatus, dayLoad, getWX, hr12 } from './progress.js';
import { switchTab, renderAll } from './main.js';
import { sleepTo5, stampReadiness, healthContext } from './health.js';

/* ---------- readiness ---------- */
const RQ=[['sleep','النوم',['سيء جدًا','سيء','عادي','زين','ممتاز']],['sore','ألم العضلات',['شديد','واضح','خفيف','بسيط','ما فيه']],['energy','الطاقة',['منهك','تعبان','عادي','نشيط','ممتاز']]];
const readyScore = r => (r.sleep+r.sore+r.energy)/3;
// readyScore() above is left exactly as it was: every stored entry, the weekly
// summary and the monthly average still go through it, so no past number moves.
// readyNow() is what today's decisions use. When the entry carries the watch's
// sleep score (stamped by health.js), the sleep answer becomes the mean of what
// the referee said and what the watch measured, both on the same 1-5 axis, and
// the result is still a 1-5 mean of three. Without a watch score it IS readyScore.
const readyNow = r => r.sleep_watch == null ? readyScore(r)
  : ((r.sleep + sleepTo5(r.sleep_watch))/2 + r.sore + r.energy)/3;
// The gauge has always been shown as a percentage of 5, so its floor is 20%, not
// 0%. Kept in one place now that both the Today tile and the card draw it.
const readyPct = sc => Math.round(sc/5*100);
const readyLabel = sc => sc>=4?['جاهز تمامًا','var(--pitch)']:sc>=3?['جاهزية متوسطة','#C99A1E']:['جاهزية منخفضة','var(--red)'];
function lighten(d, toRecovery){
  const s=state.sessions[d]; if(!s||!HARD.has(s.type)||s.type==='test') return;
  const orig={type:s.type,title:s.title,details:s.details};
  state.sessions[d] = toRecovery
    ? {type:'recovery',title:'استشفاء (جاهزيتك منخفضة)',details:'مشي ٢٠–٣٠ دقيقة وإطالات خفيفة بجهد أقل من ٥٠٪. جسمك يحتاج راحة اليوم.',orig}
    : {type:'light',title:'نسخة خفيفة: '+orig.title,details:'جاهزيتك اليوم متوسطة، فخففنا الحمل:\n• نص العدد أو المدة\n• الجهد لا يتعدى ٧٠٪\n• وقّف إذا حسيت ثقل بالرجلين\n\nالتمرين الأصلي:\n'+orig.details,orig};
}
function restoreOrig(d){ const s=state.sessions[d]; if(s&&s.orig) state.sessions[d]={...s.orig}; }
let readyEdit=false, rStep={};
function setReadyEdit(v){ readyEdit = v; if (!v) rStep = {}; }
const NAME='سعود';
const RQ2=[
  ['sleep', h => h<12?'كيف كان نومك البارح؟':'كيف نمت البارح؟', [['😫','سيء جدًا'],['😕','سيء'],['😐','عادي'],['🙂','زين'],['😴','نمت عدل']]],
  ['sore', ()=>'ورجولك اليوم؟ فيها شد أو ألم؟', [['🥵','توجعني'],['😣','فيها شد'],['😐','خفيف'],['🙂','بسيط'],['💪','ولا شي']]],
  ['energy', ()=>'وطاقتك؟ كيف تحس نفسك؟', [['🪫','منهك'],['😮‍💨','تعبان'],['😐','عادي'],['⚡','نشيط'],['🔥','مولّع']]]
];
function greet(hr){
  if (hr>=4 && hr<12) return `صباح الخير يا ${NAME} ☀️`;
  if (hr>=12 && hr<17) return `هلا ${NAME} 👋 كيف يومك ماشي؟`;
  if (hr>=17 && hr<23) return `مساء الخير يا ${NAME} 🌙`;
  return `سهران يا ${NAME}؟ 😅 ترى النوم أهم تمرين`;
}
function coachReply(t, r){
  const sc=readyNow(r), s=state.sessions[t], tm=addDays(t,1);
  const mToday=state.matches.find(m=>m.date===t), mTom=state.matches.find(m=>m.date===tm);
  let msg = sc>=4 ? 'ممتاز، جسمك جاهز 👌' : sc>=3 ? 'تمام، بس خذها بهدوء اليوم.' : 'واضح إنك تعبان شوي، ولا يهمك 🙏';
  if (mToday) msg += ` وعندك مباراة اليوم${mToday.time?' الساعة '+mToday.time:''}، الله يوفقك! اشرب ماء كفاية من الحين.`;
  else if (s && s.orig) msg += s.type==='recovery' ? ' حوّلت تمرين اليوم لاستشفاء خفيف، جسمك يستاهل راحة.' : ' خففت لك تمرين اليوم.';
  else if (!s || s.type==='rest') msg += ' واليوم راحة، استمتع فيه 😌';
  else if (sc>=4) msg += ` اليوم عندك «${s.title}»، يلا وريني شغلك 💪`;
  else if (sc>=3) msg += ` اليوم عندك «${s.title}»، إذا حسيت ثقل خففه من الزر تحت.`;
  if (r.sleep<=2) msg += ' وحاول تنام بدري الليلة.';
  if (r.sore<=2 && !mToday) msg += ' ورجولك تحتاج مشي خفيف وإطالة.';
  if (mTom && !mToday) msg += ` وبكرة عندك مباراة، نومك الليلة مهم 👀`;
  return msg;
}
function bubble(txt, me){ const b=document.createElement('div'); b.className='cb '+(me?'me':'ai'); b.textContent=txt; return b; }
function renderReady(){
  // #ready only exists while the readiness sheet is open, so this is a no-op the
  // rest of the time and renderAll() can keep calling it unconditionally.
  const box=$('ready'); if(!box) return;
  const t=todayISO(), hr=new Date().getHours(), r=state.readiness[t], s=state.sessions[t];
  box.innerHTML='';
  const c=document.createElement('div'); c.className='rcard coach';
  const head=document.createElement('div'); head.className='chead'; head.innerHTML='<span class="cav">🟨</span><b>مدربك</b>'; c.appendChild(head);
  box.appendChild(c);
  if (!r || readyEdit){
    c.appendChild(bubble(greet(hr)));
    const tmp=rStep;
    let i=0; for(; i<RQ2.length; i++){ const [k,q,opts]=RQ2[i];
      c.appendChild(bubble(q(hr)));
      if (tmp[k]){ c.appendChild(bubble(opts[tmp[k]-1].join(' '), true)); continue; }
      const w=document.createElement('div'); w.className='copts';
      opts.forEach(([e,l],j)=>{ const b=document.createElement('button'); b.innerHTML=`<span>${e}</span>${l}`; b.onclick=()=>{ tmp[k]=j+1; if (RQ2.every(([kk])=>tmp[kk])){ state.readiness[t]={sleep:tmp.sleep,sore:tmp.sore,energy:tmp.energy}; stampReadiness(); rStep={}; readyEdit=false; if (readyNow(state.readiness[t])<2.5 && s && HARD.has(s.type)) lighten(t,true); save(); renderAll(); } else renderReady(); }; w.appendChild(b); });
      c.appendChild(w); break;
    }
    if (i===0 && r){ const cl=document.createElement('button'); cl.className='lnk'; cl.textContent='إلغاء'; cl.onclick=()=>{readyEdit=false; rStep={}; renderReady();}; c.appendChild(cl); }
    return;
  }
  const sc=readyNow(r), [lbl,col]=readyLabel(sc);
  c.appendChild(bubble(coachReply(t,r)));
  const meta=document.createElement('div'); meta.className='rtop'; meta.innerHTML=`<span class="rdot" style="background:${col}"></span><span class="rpct">${lbl} ${num(Math.round(sc/5*100))}٪${r.sleep_watch!=null?`<small class="rwatch">مع نومك من الساعة ${num(r.sleep_watch)}</small>`:''}</span><button class="lnk">غيّر إجاباتي</button>`;
  meta.querySelector('.lnk').onclick=()=>{ readyEdit=true; rStep={}; renderReady(); }; c.appendChild(meta);
  if (s && s.orig){ const b=document.createElement('button'); b.className='btn ghost sm'; b.textContent='رجّع التمرين الأصلي'; b.onclick=()=>{ restoreOrig(t); save(); renderAll(); }; c.appendChild(b); }
  else if (s && HARD.has(s.type) && s.type!=='test' && sc<4){ const b=document.createElement('button'); b.className='btn primary sm'; b.textContent=sc<2.5?'حوّل اليوم لاستشفاء':'خفّف تمرين اليوم'; b.onclick=()=>{ lighten(t, sc<2.5); save(); renderAll(); }; c.appendChild(b); }
  // evening follow-up on today's session
  const lg=state.logs[t];
  if (hr>=18 && s && !['rest','match'].includes(s.type) && !(lg&&lg.done) && !r.skipped){
    c.appendChild(bubble(`وش صار على تمرين اليوم؟ خلصته؟ 😄`));
    const w=document.createElement('div'); w.className='copts';
    const y=document.createElement('button'); y.innerHTML='<span>✅</span>إيه خلصته'; y.onclick=()=>openDay(t);
    const n=document.createElement('button'); n.innerHTML='<span>🙈</span>ما لحقت'; n.onclick=()=>{ r.skipped=true; save(); renderReady(); };
    w.append(y,n); c.appendChild(w);
  } else if (r.skipped && !(lg&&lg.done)) c.appendChild(bubble('ولا يهمك، بكرة يوم جديد 👍 ولا تحاول تعوّضه كله مرة وحدة.'));
  else if (lg && lg.done && s && s.type!=='match') c.appendChild(bubble(['عاش! تمرين اليوم خلص 🔥','كفو، التزامك يفرق 👏','ممتاز، ارتاح الحين واشرب ماء 💧'][new Date(t).getDate()%3]));
  // yesterday's match not evaluated
  const y=addDays(t,-1), my=state.matches.find(m=>m.date===y);
  if (my && !(state.logs[y]&&state.logs[y].done)){
    c.appendChild(bubble('كيف كانت مباراة أمس؟ طمّني عن رجولك 👀'));
    const b=document.createElement('button'); b.className='btn primary sm'; b.textContent='قيّم المباراة'; b.onclick=()=>openDay(y); c.appendChild(b);
  }
}

/* ---------- alerts + report prompt ---------- */
function renderAlerts(){
  const box=$('alerts'); if(!box) return; box.innerHTML='';
  { const t0=todayISO(), s0=state.sessions[t0], WX=getWX();
    if (WX && WX.hot && s0 && HARD.has(s0.type) && s0.type!=='test' && !(state.logs[t0]&&state.logs[t0].done)){
      const a=document.createElement('div'); a.className='alert yel';
      a.innerHTML=`<p>🔥 الجو حار اليوم (تحسها ${num(Math.round(WX.at18.f))}° الساعة ٦ م). أنسب وقت للتمرين ${hr12(WX.best)}، أو خفّف التمرين.</p>`;
      if (!s0.orig){ const b=document.createElement('button'); b.className='btn primary sm'; b.style.marginTop='0'; b.textContent='خفّفه'; b.onclick=()=>{ lighten(t0,false); save(); renderAll(); }; a.appendChild(b); }
      box.appendChild(a); } }
  const L=loadStatus();
  if (L.enough && L.ratio>1.3){
    const a=document.createElement('div'); a.className='alert '+L.cls;
    a.innerHTML=`<p>${L.ratio>1.5?'حملك آخر ٧ أيام أعلى بكثير من معدلك. خطر إرهاق أو إصابة.':'حملك هالأسبوع مرتفع عن معدلك. انتبه لتعب الرجلين.'}</p>`;
    if (rt.sample){ const b=document.createElement('button'); b.className='btn primary sm'; b.style.marginTop='0'; b.textContent='خفّف جدولي';
      b.onclick=()=>{ switchTab('chat'); send('حمل التدريب عندي مرتفع عن معدلي. خفّف الأيام الجاية بشكل مناسب.'); }; a.appendChild(b); }
    box.appendChild(a);
  }
  const t=todayISO(), dow=parse(t).getDay(), lastWs=addDays(t,-dow-7);
  if (dow<=2 && !state.reports[lastWs] && weekSummary(lastWs).done>0){
    const a=document.createElement('div'); a.className='alert grn';
    a.innerHTML='<p>تقرير الأسبوع الماضي جاهز للإنشاء.</p>';
    const b=document.createElement('button'); b.className='btn primary sm'; b.style.marginTop='0'; b.textContent='اعرضه';
    b.onclick=()=>{ switchTab('prog'); genReport(lastWs); }; a.appendChild(b); box.appendChild(a);
  }
}

/* ---------- weekly report ---------- */
function weekSummary(ws){
  let planned=0,done=0,load=0,matches=[],ready=[],efforts=[];
  for(let i=0;i<7;i++){ const d=addDays(ws,i), s=state.sessions[d], l=state.logs[d];
    if (s && !['rest','match'].includes(s.type)){ planned++; if(l&&l.done){done++; if(l.effort) efforts.push(l.effort);} }
    if (s && s.type==='match') matches.push({date:d, ...(l||{})});
    load+=dayLoad(d); if(state.readiness[d]) ready.push(readyScore(state.readiness[d])); }
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return {planned,done,load,matches,ready:avg(ready),effort:avg(efforts)};
}
let reportBusy=false, reportWeek=null;
async function genReport(ws){
  reportWeek=ws;
  if (!rt.sample || reportBusy){ renderReport(); return; }
  reportBusy=true; renderReport();
  const sum=weekSummary(ws), days={};
  for(let i=0;i<7;i++){ const d=addDays(ws,i); days[d]={session:state.sessions[d]?.title, type:state.sessions[d]?.type, log:state.logs[d]||null, readiness:state.readiness[d]||null}; }
  const next={}; for(let i=7;i<14;i++){ const d=addDays(ws,i); if(state.sessions[d]) next[d]=state.sessions[d].title; }
  const prompt=`أنت مدرب لياقة لحكم كرة قدم مساعد في السعودية. اكتب له تقرير أسبوعي قصير بالعربي بلهجة سعودية بسيطة، أقل من ١٢٠ كلمة، بدون مقدمة، بثلاثة أقسام بعناوين قصيرة:
وش أنجزت
وش انتبه له
تركيزك هالأسبوع (نقطتين عمليتين)
الجهد من ١ إلى ٥، والجاهزية من ١ إلى ٥، والحمل = المدة × الجهد. حالة الرجلين بالمباريات من ١ (مرتاحة) إلى ٥ (منهكة)، والشوط ٣ يعني تعب بالشوط الثاني.
الملخص: ${JSON.stringify(sum)}
الأيام: ${JSON.stringify(days)}
الأسبوع الجاي: ${JSON.stringify(next)}
حالة الحمل: ${JSON.stringify(loadStatus())}`;
  try { const r=await rt.sample(prompt,{cache:false}); state.reports[ws]={text:r.text.trim(),at:todayISO()}; save(); }
  catch(e){ state.reports[ws]=state.reports[ws]||null; reportErr = e?.code==='rate_limited'?'وصلت الحد المسموح، جرّب بعد شوي.':'تعذّر إنشاء التقرير، جرّب مرة ثانية.'; }
  finally { reportBusy=false; renderAll(); }
}
let reportErr='';
function renderReport(){
  const box=$('reportPanel'), t=todayISO(), dow=parse(t).getDay();
  const ws = reportWeek || addDays(t,-dow-7);
  const sum=weekSummary(ws), rep=state.reports[ws];
  box.innerHTML=`<h3>تقرير أسبوع ${fDm.format(parse(ws))}</h3>
    <p class="note">${num(sum.done)} من ${num(sum.planned)} تمارين، ${num(sum.matches.length)} ${sum.matches.length===1?'مباراة':'مباريات'}، الحمل ${num(Math.round(sum.load))}${sum.ready?`، متوسط الجاهزية ${num(Math.round(sum.ready/5*100))}٪`:''}</p>`;
  if (reportBusy){ box.insertAdjacentHTML('beforeend','<div class="report">المدرب يكتب التقرير…</div>'); return; }
  if (rep && rep.text){ const r=document.createElement('div'); r.className='report'; r.textContent=rep.text; box.appendChild(r); }
  if (reportErr){ const e=document.createElement('p'); e.className='note'; e.style.color='var(--red)'; e.textContent=reportErr; box.appendChild(e); reportErr=''; }
  const row=document.createElement('div'); row.className='row'; row.style.marginTop='10px';
  if (rt.sample){ const b=document.createElement('button'); b.className='btn primary sm'; b.style.marginTop='0'; b.textContent=rep?'حدّث التقرير':'أنشئ التقرير'; b.onclick=()=>genReport(ws); row.appendChild(b); }
  const prev=document.createElement('button'); prev.className='btn ghost sm'; prev.style.marginTop='0'; prev.textContent='الأسبوع اللي قبله'; prev.onclick=()=>{ reportWeek=addDays(ws,-7); renderReport(); }; row.appendChild(prev);
  if (ws < addDays(t,-dow)){ const nx=document.createElement('button'); nx.className='btn ghost sm'; nx.style.marginTop='0'; nx.textContent='اللي بعده'; nx.onclick=()=>{ reportWeek=addDays(ws,7); renderReport(); }; row.appendChild(nx); }
  box.appendChild(row);
}

/* ---------- chat ---------- */
let busy = false, ctl = null;
const RULES = `أنت مدرب لياقة شخصي وصديق لحكم كرة قدم مساعد (حكم خط) في السعودية اسمه سعود. تكلم بلهجة سعودية دافئة ومشجعة مثل صديق يهتم فيه: رحّب فيه حسب الوقت، اسأله أحيانًا عن حاله ويومه، امدح التزامه، وطمّنه إذا تعبان. لا تطوّل ولا تكون رسمي، وإيموجي واحد أو اثنين بالرد يكفي. حركته بالمباراة: خطوات جانبية على خط التماس، سرعات قصيرة ١٠–٣٠ م، ركض للخلف، وتغيير اتجاه سريع مع خط التسلل. معلومات ثابتة عنه:
- يتمرن ٤ أيام بالأسبوع في البيت والشارع، بدون نادي ولا أوزان.
- مبارياته متغيرة: أحيانًا وحدة بالأسبوع، أحيانًا ولا وحدة، وأحيانًا اثنتين، غالبًا الجمعة أو السبت.
- أكثر شي يتعبه: الرجلين والعضلات، خصوصًا بالحر.
- لا توجد إصابات.
- الهدف: يحافظ على لياقته طول الموسم ويحكم المباريات وينهيها بدون تعب. ما عنده اختبار لياقة قادم.

قواعد التعديل:
- اليوم اللي بعد المباراة استشفاء، واليوم اللي قبلها خفيف. لا تحط يومين صعبين ورا بعض.
- حافظ على ٤ تمارين بالأسبوع قدر الإمكان، وأولوية التمارين: سرعات الحكم المساعد والخطوات الجانبية، ثم الارتدادات ورد الفعل، ثم قوة الرجلين، ثم التحمل.
- الخطة مستمرة: كل رابع أسبوع خفيف للاستشفاء. إذا تراكمت مباريات كثيرة، خفّف أكثر.
- إذا قال إنه تعبان أو رجوله ثقيلة، خفّف ولا تضغط. خذ بعين الاعتبار سجل إحساسه بالتمارين، وجاهزيته الصباحية (١ سيء إلى ٥ ممتاز)، وتقييم مبارياته، ونسبة الحمل (فوق ١٫٥ يعني خطر إرهاق).
- عدّل فقط الأيام اللي تحتاج تعديل، ولا تغيّر أيام مضت.
- اذكر نسبة الجهد في كل تمرين: تحمّل ٦٠–٧٠٪، سرعات ٩٠٪، تحمّل المساعد ٨٠–٨٥٪، تنشيط واستشفاء ٥٠٪ أو أقل.
- التمارين بوزن الجسم فقط، وقابلة للتنفيذ بالشارع أو البيت.

ردّك دائمًا كائن JSON واحد فقط بهذا الشكل:
{"reply":"رد قصير بالعربي يوضح وش غيّرت وليش","sessions":[{"date":"YYYY-MM-DD","type":"run|strength|intervals|yoyo|light|rest|recovery|test|match","title":"عنوان قصير","details":"تفاصيل التمرين"}],"addMatches":[{"date":"YYYY-MM-DD","time":"HH:MM أو فارغ","note":""}],"removeMatchDates":["YYYY-MM-DD"]}
اترك المصفوفات فارغة إذا ما فيه تغيير. إذا ذكر مباراة جديدة، ضعها في addMatches. التاريخ بالأرقام الإنجليزية دائمًا.`;

function context(){
  const t = todayISO(), from = addDays(t,-3), to = addDays(t,28);
  const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([d])=>d>=from&&d<=to).sort());
  const logs = Object.fromEntries(Object.entries(state.logs).filter(([d])=>d>=addDays(t,-14)));
  const WX = getWX();
  return JSON.stringify({today:t, weekday:fWd.format(parse(t)), now:new Date().toTimeString().slice(0,5), sessions, matches:state.matches.filter(m=>m.date>=addDays(t,-14)), recentLogs:logs, tests:state.tests, readiness:Object.fromEntries(Object.entries(state.readiness).filter(([d])=>d>=addDays(t,-7))), load:loadStatus(), sleep:healthContext(), weather:WX?{city:WX.city,feelsAt18:WX.at18.f,bestHour:WX.best,bestFeels:WX.H[WX.best].f}:null});
}
function renderChat(){
  const box = $('msgs'); box.innerHTML='';
  if (!state.chat.length){
    const p=document.createElement('p'); p.className='empty';
    p.textContent = rt.sample ? greet(new Date().getHours())+'\nقولي وش عندك اليوم، مباراة؟ تعب؟ أي شي، وأنا أرتب جدولك على حسبه.' : 'المدرب غير متاح حاليًا. تأكد من الاتصال بالإنترنت.';
    box.appendChild(p);
  }
  state.chat.forEach(m => {
    const d=document.createElement('div'); d.className='msg '+(m.role==='user'?'me':'ai')+(m.err?' err':'');
    d.textContent = m.content;
    if (m.changes){ const c=document.createElement('span'); c.className='chg'; c.textContent=m.changes; d.appendChild(c); }
    box.appendChild(d);
  });
  // an animated three-dot bubble, so a slow reply reads as "working" rather than "stuck"
  if (busy){ const d=document.createElement('div'); d.className='msg ai typing';
    d.setAttribute('aria-label','المدرب يكتب');
    d.innerHTML='<i></i><i></i><i></i>'; box.appendChild(d); }
  $('sendBtn').textContent = busy ? 'إيقاف' : 'إرسال';
  $('composer').hidden = $('chat').hidden || !rt.sample;
  if (!$('chat').hidden) requestAnimationFrame(()=>window.scrollTo(0,document.body.scrollHeight));
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function applyChanges(r){
  let n = 0;
  (Array.isArray(r.removeMatchDates)?r.removeMatchDates:[]).forEach(d=>{ if (DATE_RE.test(d)){ removeMatch(d); n++; } });
  (Array.isArray(r.addMatches)?r.addMatches:[]).forEach(m=>{ if (m && DATE_RE.test(m.date) && !state.matches.some(x=>x.date===m.date)){ applyMatch(m.date,String(m.time||''),String(m.note||'')); n++; } });
  const t = todayISO();
  (Array.isArray(r.sessions)?r.sessions:[]).forEach(s=>{
    if (!s || !DATE_RE.test(s.date) || s.date < t || !TYPES[s.type]) return;
    state.sessions[s.date] = {type:s.type, title:String(s.title||TYPES[s.type].l).slice(0,80), details:String(s.details||'').slice(0,800)}; n++;
  });
  return n;
}
async function send(text){
  if (!rt.sample || busy || !text.trim()) return;
  state.chat.push({role:'user', content:text.trim()});
  busy = true; renderChat();
  const hist = state.chat.slice(-11,-1).filter(m=>!m.err).map(m=>({role:m.role, content:m.content}));
  const turns = [...hist, {role:'user',content:`بيانات الجدول الحالية:\n${context()}\n\nرسالة الحكم: ${text.trim()}`}];
  ctl = new AbortController();
  try {
    const r = await rt.sample.json(turns, {cache:false, signal:ctl.signal, system:RULES});
    const n = applyChanges(r || {});
    state.chat.push({role:'assistant', content:String(r?.reply||'تم.'), changes: n?`عدّلت ${num(n)} ${n===1?'يوم':'أيام'} في الجدول`:''});
  } catch(e){
    const msg = {
      cancelled:'أوقفت الرد.',
      rate_limited:'وصلت الحد المسموح حاليًا. جرّب بعد شوي.',
      upstream_rate:'المدرب مشغول حاليًا من كثرة الطلبات. جرّب بعد دقيقة.',
      not_granted:'ما تم السماح للصفحة باستخدام Claude.',
      invalid_json:'الرد وصل بشكل غير مفهوم. أعد الإرسال.',
      truncated:'الرد طلع أطول من اللازم وانقطع. أعد الإرسال برسالة أقصر.',
      session_expired:'سجّل دخولك مرة ثانية.',
      no_api_key:'مفتاح Claude مو مضبوط على الخادم. أضفه في إعدادات الخدمة باسم ANTHROPIC_API_KEY.',
      bad_api_key:'مفتاح Claude مرفوض. تأكد من المفتاح في إعدادات الخادم.',
      bad_key_format:'مفتاح Claude فيه حرف غير صالح. انسخه من جديد في إعدادات الخادم كسطر واحد.',
      bad_request:'الخادم رفض الطلب' + (e?.detail ? ': '+e.detail : '. راجع سجل الخدمة.'),
      upstream_down:'خدمة Claude متعثرة حاليًا. جرّب بعد شوي.',
      timeout:'الرد تأخر أكثر من اللازم. أعد الإرسال.',
      network:'ما قدر الخادم يوصل لـ Claude. تأكد من الاتصال.',
      server:'صار خطأ داخلي بالخادم. أعد الإرسال.'
    }[e?.code] || 'صار خطأ بالاتصال. أعد الإرسال.';
    state.chat.push({role:'assistant', content:msg, err:true});
    if (e?.code==='not_granted' || e?.code==='sampling_disabled') rt.sample = null;
  } finally {
    busy=false; ctl=null; save();
    // paint the reply first, then catch the rest of the app up on the next frame:
    // applyChanges() may have rewritten a week of sessions, and re-rendering five
    // screens in the same task as the reply is what used to make it feel like a jolt
    renderChat();
    requestAnimationFrame(renderAll);
  }
}
// chat is busy while a request is open; main.js reads this for the send/stop button
export function chatBusy(){ return busy; }
export function abortChat(){ ctl?.abort(); }
export const CHAT_CHIPS = ['عندي مباراة بكرة','رجولي تعبانة اليوم','فاتني تمرين أمس','عندي مباراتين هالأسبوع','الجو حار جدًا اليوم','وش أسوي قبل المباراة؟'];

export { RQ, RQ2, readyScore, readyNow, readyPct, readyLabel, lighten, restoreOrig, greet, coachReply, bubble,
         renderReady, renderAlerts, weekSummary, genReport, renderReport, renderChat,
         applyChanges, send, context, RULES, setReadyEdit };
