// quiz.js — the laws-of-the-game question bank and everything that drills it.
//
// The bank is the law app's: 350 questions from the 2026/27 IFAB laws, copied
// into js/lawbank.js by scripts/export-law-bank.py, each with an article, a page,
// a difficulty and a type. Alongside them sit 26 questions of this app's own on
// the assistant referee's positioning and signals (the book's practical
// guidelines, pp. 212-229), which the law app does not cover.
//
// Three ways in: one question a day, a 20-question mock exam on a 20-minute
// clock, and per-article practice including a bank of the ones answered wrong (a
// question leaves that bank after two correct answers).
//
// PROGRESS IS KEYED BY QUESTION ID ('L11-04', 'G-07'), never by position, so the
// bank can grow or be re-exported without moving anyone's answers. Before v3 it
// was keyed by position in the old 92-question list; migrateV2() below converts.
//
// Which question is "today's" is derived from the date by dayHash(), so it is the
// same question all day and across devices without storing a schedule.
import { state, save, num, parse, addDays, todayISO, fDm, $ } from './state.js';
import { openSheet, closeSheet } from './main.js';
import { LAW_BANK, LAW_CATS } from './lawbank.js';

/* ---------- the bank ---------- */
const AR_GUIDE = [
 {id:'G-01',c:'g',p:212,q:'بشكل عام، على مستوى مين يتمركز الحكم المساعد؟',o:['آخر مدافع دائمًا','ثاني آخر مدافع، أو الكرة إذا كانت أقرب لخط المرمى','الكرة دائمًا'],a:1,w:'يكون على خط واحد مع ثاني آخر مدافع، أو مع الكرة إذا كانت أقرب لخط المرمى منه، ويواجه الملعب دائمًا.'},
 {id:'G-02',c:'g',p:212,q:'في المسافات القصيرة، وش طريقة الجري المطلوبة من الحكم المساعد؟',o:['الجري الأمامي','الجري الجانبي ووجهه للملعب','الجري للخلف'],a:1,w:'يستخدم الجري الجانبي في المسافات القصيرة ووجهه للملعب، وهذا مهم جدًا للحكم على التسلل.'},
 {id:'G-03',c:'g',p:213,q:'وين يقف الحكم المساعد في الركلة الركنية؟',o:['عند تقاطع خط المرمى مع منطقة الجزاء','خلف الراية الركنية على خط واحد مع خط المرمى','عند خط المنتصف'],a:1,w:'يقف خلف الراية الركنية على خط واحد مع خط المرمى، بدون ما يتداخل مع المنفذ، ويتأكد إن الكرة داخل المنطقة الركنية.'},
 {id:'G-04',c:'g',p:221,q:'وين يتمركز الحكم المساعد في ركلة الجزاء أثناء المباراة (بدون تقنيات)؟',o:['عند تقاطع خط المرمى مع خط منطقة الجزاء','عند راية الركنية','عند خط المنتصف'],a:0,w:'يتمركز على نقطة تقاطع خط المرمى مع خط منطقة الجزاء.'},
 {id:'G-05',c:'g',p:221,q:'ركلة جزاء في مباراة فيها تقنية خط المرمى وحكم فيديو. وين الأفضل يكون الحكم المساعد؟',o:['على خط المرمى','على خط التماس مقابل علامة الجزاء (خط التسلل)'],a:1,w:'يُستحسن يكون على خط التماس مقابل علامة الجزاء، لأن التواجد على خط المرمى يمنعه من العودة لتقدير التسلل إذا ارتدت الكرة.'},
 {id:'G-06',c:'g',p:220,q:'في ركلات الترجيح، وين الحكمان المساعدان؟',o:['الاثنين عند المرمى','واحد عند تقاطع خط المرمى مع منطقة المرمى، والثاني في دائرة المنتصف','الاثنين في دائرة المنتصف'],a:1,w:'أحدهما على تقاطع خط المرمى مع خط منطقة المرمى، والآخر في دائرة المنتصف للسيطرة على اللاعبين.'},
 {id:'G-07',c:'g',p:219,q:'وين يتمركز الحكمان المساعدان عند ركلة البداية؟',o:['على خط المنتصف','على خط واحد مع ثاني آخر مدافع'],a:1,w:'يجب أن يكونا على نفس الخط مع ثاني آخر مدافع.'},
 {id:'G-08',c:'g',p:218,q:'الحارس يستعد يطلق الكرة. وين يكون الحكم المساعد؟',o:['على خط التسلل','على خط واحد مع حافة منطقة الجزاء','عند راية الركنية'],a:1,w:'يكون على خط واحد مع حافة منطقة الجزاء ليتأكد إن الحارس ما لمس الكرة بيده خارجها، وبعد ما يطلقها يرجع لخط التسلل.'},
 {id:'G-09',c:'g',p:217,q:'في ركلة المرمى، وش أول شي يتأكد منه الحكم المساعد؟',o:['خط التسلل','إن الكرة داخل منطقة المرمى','مكان الحارس'],a:1,w:'يتأكد أولًا إن الكرة داخل منطقة المرمى. إذا ما كانت في مكانها الصحيح، يبقى مكانه ويتواصل مع الحكم ويرفع الراية.'},
 {id:'G-10',c:'g',p:216,q:'هدف واضح بدون أي شك. وش يسوي الحكم المساعد؟',o:['يرفع الراية','يتواصل بالرؤية مع الحكم ويجري 25–30 م باتجاه المنتصف بدون رفع الراية','يأشر للمنتصف بالراية'],a:1,w:'يتواصل بالرؤية مع الحكم، ثم يجري بسرعة 25–30 م بطول خط التماس باتجاه خط المنتصف دون رفع الراية.'},
 {id:'G-11',c:'g',p:216,q:'هدف سُجل لكن الكرة تبدو كأنها ما زالت في اللعب. وش يسوي المساعد؟',o:['يجري للمنتصف مباشرة','يرفع الراية أولًا لجذب انتباه الحكم ثم يكمل إجراء الهدف','ينتظر قرار الحكم'],a:1,w:'يرفع رايته أولًا لجذب انتباه الحكم، ثم يكمل الإجراء العادي بالجري 25–30 م باتجاه المنتصف.'},
 {id:'G-12',c:'g',p:228,q:'بأي يد يرفع الحكم المساعد الراية للتسلل؟',o:['اليسرى','اليمنى','أي يد'],a:1,w:'أول فعل بعد قرار التسلل هو رفع الراية باليد اليمنى، لأنها تعطي أفضل خط رؤية.'},
 {id:'G-13',c:'g',p:228,q:'رفعت الراية للتسلل والحكم ما شافها. لين متى تستمر في الإشارة؟',o:['3 ثوانٍ فقط','حتى يراها الحكم أو تصبح الكرة تحت سيطرة الفريق المدافع بوضوح','حتى يخرج اللعب'],a:1,w:'يواصل الإشارة حتى يراها الحكم أو تصبح الكرة تحت سيطرة الفريق المدافع بشكل واضح.'},
 {id:'G-14',c:'g',p:226,q:'احتجت تنقل الراية لليد الثانية. كيف؟',o:['من فوق الرأس','من أسفل عند الخصر','خلف الظهر'],a:1,w:'يتم نقل الراية لليد الأخرى من أسفل عند الخصر.'},
 {id:'G-15',c:'g',p:226,q:'بأي يد يحمل المساعد الراية أثناء الجري؟',o:['اليمنى دائمًا','اليد القريبة من الحكم، وغير مطوية','اليسرى دائمًا'],a:1,w:'يجب أن تكون الراية مرئية للحكم وغير مطوية، فتُحمل باليد القريبة من الحكم.'},
 {id:'G-16',c:'g',p:226,q:'قبل رفع الراية، وش المطلوب من الحكم المساعد؟',o:['يرفعها وهو يجري','يتوقف عن الجري، يواجه الملعب، يتواصل بالرؤية مع الحكم ثم يرفعها بحركة مقصودة','يصفّر'],a:1,w:'يتوقف عن الجري ويواجه الملعب ويتواصل بالرؤية مع الحكم، ثم يرفع الراية بحركة مقصودة بدون استعجال أو مبالغة.'},
 {id:'G-17',c:'g',p:227,q:'مدافع ارتكب خطأ داخل منطقة الجزاء قريب منك، والحكم ما اتخذ قرار. وش تسوي؟',o:['تنتظر نهاية الهجمة','ترفع الراية، تستخدم جهاز التواصل، وتتحرك على خط التماس باتجاه الراية الركنية','تدخل الملعب'],a:1,w:'بعد التواصل بالرؤية، إذا لم يتخذ الحكم قرارًا يرفع المساعد رايته ويستخدم جهاز التواصل ويتحرك بوضوح على خط التماس باتجاه الراية الركنية.'},
 {id:'G-18',c:'g',p:228,q:'خطأ قرب حدود منطقة الجزاء لكنه خارجها. كيف توضح للحكم إنه خارج المنطقة؟',o:['تأشر للأرض','تتحرك على خط التماس باتجاه خط المنتصف','ترفع الراية للأعلى'],a:1,w:'يتحرك المساعد بوضوح على خط التماس باتجاه خط المنتصف ليوضح إن المخالفة خارج منطقة الجزاء.'},
 {id:'G-19',c:'g',p:227,q:'عند الإشارة لخطأ، كيف تحرك الراية؟',o:['تلوّح فيها بقوة','تحركها بصورة خفيفة ذهابًا وإيابًا','تثبتها بدون حركة'],a:1,w:'تحريك الراية بصورة خفيفة ذهابًا وإيابًا، وتجنب الحركة المبالغ فيها أو العدائية.'},
 {id:'G-20',c:'g',p:227,q:'شفت خطأ لكن الفريق المتضرر عنده هجمة مفيدة. وش الأسلوب الصحيح؟',o:['ترفع الراية فورًا','«شاهد وانتظر» وتتواصل بالرؤية مع الحكم'],a:1,w:'يستخدم المساعد أسلوب «شاهد وانتظر» ليسمح باستمرار اللعب عند إتاحة الفرصة، مع التواصل بالرؤية مع الحكم.'},
 {id:'G-21',c:'g',p:226,q:'الكرة عبرت خط المرمى بعيد عنك، والقرار (ركنية أو مرمى) مو واضح لك. وش تسوي؟',o:['تقرر بنفسك','تتواصل بالرؤية مع الحكم وتتبع قراره'],a:1,w:'إذا كانت قريبة يقرر المساعد، وإذا كانت بعيدة يتواصل بالرؤية مع الحكم ويتبع قراره.'},
 {id:'G-22',c:'g',p:229,q:'الكرة طلعت تماس بعيد عنك وعندك شك في اتجاه الرمية. وش تسوي؟',o:['تأشر لأي اتجاه','ترفع الراية لتبين إن الكرة خرجت، ثم تتواصل بالرؤية وتتبع إشارة الحكم'],a:1,w:'يرفع رايته ليبين للحكم خروج الكرة، ثم يتواصل بالرؤية ويتبع إشارة الحكم.'},
 {id:'G-23',c:'g',p:222,q:'طلب تبديل وما فيه حكم رابع. وش يسوي الحكم المساعد؟',o:['يكمل مكانه','يتحرك لخط المنتصف للمساعدة، والحكم ينتظر رجوعه قبل الاستئناف'],a:1,w:'إذا لم يوجد حكم رابع، يتحرك المساعد لخط المنتصف للمساعدة في التبديل، والحكم ينتظر رجوعه قبل استئناف اللعب.'},
 {id:'G-24',c:'g',p:213,q:'الحكم احتاج استشارة مباشرة معك. كيف تكون؟',o:['تجري له في وسط الملعب','تتقدم 2–3 م داخل الملعب ويواجه الاثنين الملعب','تصرخ له من الخط'],a:1,w:'يتقدم المساعد 2–3 م داخل الملعب إذا لزم، وعند الحديث يواجهان الملعب لتجنب سماعهم ولمراقبة اللاعبين.'},
 {id:'G-25',c:'g',p:226,q:'أشرت لخطأ يستوجب الطرد، والحكم ما انتبه إلا بعد استئناف اللعب. وش الممكن؟',o:['يرجع ويحتسب الركلة','يتخذ العقوبة الانضباطية فقط بدون الرجوع للركلة','ما يسوي شي'],a:1,w:'إذا استُؤنف اللعب، يمكن للحكم اتخاذ العقوبة الانضباطية المناسبة، لكنه لا يعود لاحتساب الركلة الحرة أو ركلة الجزاء.'},
 {id:'G-26',c:'g',p:225,q:'متى يستخدم المساعد جهاز التنبيه (البيب)؟',o:['لكل خروج للكرة','لجذب انتباه الحكم في حالات مثل التسلل والأخطاء خارج نظره','ما يُستخدم'],a:1,w:'جهاز التنبيه إشارة إضافية لجذب انتباه الحكم فقط، ومفيد في التسلل والأخطاء خارج نطاق رؤية الحكم.'},
];
const QCAT = { ...LAW_CATS, g: 'التمركز والإشارات' };
const QUIZ = [...LAW_BANK, ...AR_GUIDE];
const QBY = new Map(QUIZ.map(x => [x.id, x]));
const DIFF = { 1: 'سهل', 2: 'متوسط', 3: 'صعب' };
const qRef = x => x.c === 'g' ? `الإرشادات العملية، صفحة ${num(x.p)}` : `${x.r}، صفحة ${num(x.p)}`;
// the exam always includes some of each: offside, the assistant's own job, and
// this season's changes
const EXAM_MUST = ['11', 'g', '19'];
const LAW_APP = 'https://other-refereea.onrender.com';

/* ---------- progress: v2 -> v3 ---------- */
// v2 keyed answers, wrong and daily by position in the old 92-question list.
// Positions 62-87 were the assistant-referee questions, which survive as G-01..G-26
// with their answers and wrong-bank entries intact. The other 66 were replaced by
// the law app's bank: their answers are kept under 'old-<n>' so the accuracy
// figure, the streak and the monthly report still count them, but they no longer
// appear in the wrong bank or as today's question, because the questions are gone.
const legacyId = i => (i >= 62 && i <= 87) ? 'G-' + String(i - 61).padStart(2, '0') : 'old-' + i;
function migrateV2(old){
  const answers = {}, wrong = {}, daily = {};
  for (const [k, v] of Object.entries(old.answers || {})) answers[legacyId(+k)] = v;
  for (const [k, v] of Object.entries(old.wrong || {})){ const id = legacyId(+k); if (QBY.has(id)) wrong[id] = v; }
  for (const [d, v] of Object.entries(old.daily || {})){ const id = legacyId(+v); if (QBY.has(id)) daily[d] = id; }
  return { v: 3, answers, wrong, daily, ...(old.exams ? { exams: old.exams } : {}) };
}

function dayHash(s){ let h=0; for (const c of s) h=(h*31+c.charCodeAt(0))>>>0; return h; }
function quizState(){
  if (state.quiz && state.quiz.v === 2) state.quiz = migrateV2(state.quiz);
  if (!state.quiz || state.quiz.v !== 3) state.quiz = { v: 3, answers: {}, daily: {} };
  state.quiz.wrong ||= {};
  return state.quiz;
}
// answers to questions that are still in the bank
const liveAnswers = Q => Object.entries(Q.answers).filter(([id]) => QBY.has(id));
function pickAnother(Q){
  const left = QUIZ.filter(x => !Q.answers[x.id]);
  const x = left.length ? left[Math.floor(Math.random() * left.length)] : QUIZ[Math.floor(Math.random() * QUIZ.length)];
  if (!left.length) delete Q.answers[x.id];
  return x.id;
}
function recordAnswer(qi, pick, extra){ const Q=quizState(), ok=pick===QBY.get(qi).a; Q.answers[qi]={pick,ok,date:todayISO(),extra:!!extra};
  if (!ok) Q.wrong[qi]={n:((Q.wrong[qi]||{}).n||0)+1, fix:0};
  else if (Q.wrong[qi]){ Q.wrong[qi].fix=(Q.wrong[qi].fix||0)+1; if (Q.wrong[qi].fix>=2) delete Q.wrong[qi]; }
  return ok; }
function quizOf(date){ const q=quizState(); if (q.daily[date]!=null && QBY.has(q.daily[date])) return q.daily[date];
  // on alternate days, a question from the wrong bank comes back
  const wr=Object.keys(q.wrong||{}).filter(id=>QBY.has(id));
  if (wr.length && dayHash(date)%2===0){ const id=wr[dayHash(date+'w')%wr.length]; q.daily[date]=id; return id; }
  let i=dayHash(date)%QUIZ.length; for (let k=0;k<QUIZ.length && q.answers[QUIZ[i].id];k++) i=(i+1)%QUIZ.length; q.daily[date]=QUIZ[i].id; return QUIZ[i].id; }
function shuffled(qi){ const x=QBY.get(qi), n=x.o.length, idx=[...Array(n).keys()]; if (x.y==='tf') return idx;   // صح/خطأ keep their order
  let s=dayHash('q'+qi); for(let i=n-1;i>0;i--){ s=(s*1103515245+12345)>>>0; const j=s%(i+1); [idx[i],idx[j]]=[idx[j],idx[i]]; } return idx; }
function qBlock(qi, onAnswer, answered){
  const x=QBY.get(qi), order=shuffled(qi), wrap=document.createElement('div');
  wrap.innerHTML=`<span class="qtag">${QCAT[x.c]}${x.d?' · '+DIFF[x.d]:''}</span><p class="qq"></p>`; wrap.querySelector('.qq').textContent=x.q;
  const w=document.createElement('div'); w.className='qopts';
  order.forEach(i=>{ const b=document.createElement('button'); b.textContent=x.o[i];
    if (answered){ b.disabled=true; if(i===x.a) b.className='ok'; else if(i===answered.pick) b.className='no'; }
    b.onclick=()=>onAnswer(i); w.appendChild(b); });
  wrap.appendChild(w);
  if (answered){ const p=document.createElement('p'); p.className='qwhy'; p.innerHTML=`${answered.ok?'✅ صح! ':'❌ الإجابة الصحيحة مظللة بالأخضر. '}<span></span><small class="qref">📖 ${qRef(x)}</small>`; p.querySelector('span').textContent=x.w; wrap.appendChild(p); }
  return wrap;
}
let quizExtra=null, quizOpen=false;
function renderQuiz(){
  const box=$('quiz'); if(!box) return; const Q=quizState();
  const t=todayISO(), qi = quizExtra ?? quizOf(t), a=Q.answers[qi], answered = a && (quizExtra!=null ? a.date===t && a.extra : a.date===t) ? a : null;
  if (answered && quizExtra==null && !quizOpen){
    const c=document.createElement('div'); c.className='rcard qmini';
    c.innerHTML=`<span class="cav">⚖️</span><div><b>سؤال اليوم</b><small>${answered.ok?'✅ جاوبت صح':'❌ راجع الإجابة'}، ${QCAT[QBY.get(qi).c]}</small></div><button class="chip">عرض</button><button class="chip">سؤال ثاني</button>`;
    const [v,m]=c.querySelectorAll('.chip'); v.onclick=()=>{ quizOpen=true; renderQuiz(); };
    m.onclick=()=>{ quizExtra = pickAnother(Q); renderQuiz(); };
    box.innerHTML=''; box.appendChild(c); return;
  }
  const c=document.createElement('div'); c.className='rcard qcard';
  c.innerHTML=`<div class="chead"><span class="cav">⚖️</span><b>${quizExtra!=null?'سؤال إضافي':'سؤال اليوم'}</b><span class="rpct" style="margin-inline-start:auto">${num(liveAnswers(Q).filter(([,x])=>x.ok).length)}/${num(QUIZ.length)} صح</span></div>`;
  c.appendChild(qBlock(qi, i=>{ recordAnswer(qi,i,quizExtra!=null); save(); renderQuiz(); renderLaw(); }, answered));
  if (answered){ const more=document.createElement('button'); more.className='btn ghost sm'; more.textContent='سؤال ثاني';
    more.onclick=()=>{ quizExtra = pickAnother(Q); renderQuiz(); }; c.appendChild(more); }
  box.innerHTML=''; box.appendChild(c);
}
function openExam(){
  const Q=quizState(), N=Math.min(20,QUIZ.length), LIMIT=20*60;
  const pool=QUIZ.map(x=>x.id).sort(()=>Math.random()-.5);
  const pick=[]; EXAM_MUST.forEach(c=>pool.filter(id=>QBY.get(id).c===c).slice(0,4).forEach(id=>pick.push(id)));
  pool.forEach(i=>{ if(pick.length<N && !pick.includes(i)) pick.push(i); });
  const qs=pick.slice(0,N).sort(()=>Math.random()-.5), ans={}; let pos=0, left=LIMIT, tick=null, done=false;
  openSheet(sh=>{
    const finish=()=>{ if(done) return; done=true; clearInterval(tick);
      const right=qs.filter(qi=>ans[qi]===QBY.get(qi).a).length, pct=Math.round(100*right/qs.length);
      qs.forEach(qi=>{ if(ans[qi]!=null) recordAnswer(qi,ans[qi],true); });
      (Q.exams ||= []).push({date:todayISO(),right,total:qs.length,secs:LIMIT-left}); save(); renderLaw();
      sh.querySelectorAll('.pbody').forEach(e=>e.remove()); const b=document.createElement('div'); b.className='pbody';
      b.innerHTML=`<div class="exres ${pct>=80?'pass':'fail'}"><b>${num(pct)}%</b><span>${num(right)} من ${num(qs.length)} صح</span><small>${pct>=80?'ناجح 👏 مستوى ممتاز':'تحتاج مراجعة، النجاح من 80%'}، الوقت ${num(Math.floor((LIMIT-left)/60))}:${String((LIMIT-left)%60).padStart(2,'0')}</small></div><h3 style="margin:16px 0 6px">${right<qs.length?'راجع أخطاءك':'ولا خطأ! 🔥'}</h3>`;
      qs.filter(qi=>ans[qi]!==QBY.get(qi).a).forEach(qi=>{ const x=QBY.get(qi); const d=document.createElement('div'); d.className='exrev';
        d.innerHTML=`<span class="qtag"></span><p class="qq"></p><p class="exa">❌ ${ans[qi]!=null?'إجابتك: <span class="y"></span><br>':'ما جاوبت<br>'}✅ الصحيحة: <span class="c"></span></p><p class="qwhy"><span class="w"></span><small class="qref">📖 ${qRef(x)}</small></p>`;
        d.querySelector('.qtag').textContent=QCAT[x.c]; d.querySelector('.qq').textContent=x.q; if(ans[qi]!=null) d.querySelector('.y').textContent=x.o[ans[qi]]; d.querySelector('.c').textContent=x.o[x.a]; d.querySelector('.w').textContent=x.w; b.appendChild(d); });
      const c=document.createElement('button'); c.className='btn primary'; c.style.marginTop='14px'; c.textContent='إغلاق'; c.onclick=closeSheet; b.appendChild(c); sh.appendChild(b); sh.scrollTop=0; };
    const draw=()=>{ sh.querySelectorAll('.pbody').forEach(e=>e.remove()); const body=document.createElement('div'); body.className='pbody';
      const qi=qs[pos], x=QBY.get(qi), order=shuffled(qi);
      body.innerHTML=`<div class="exhead"><h2>اختبار تجريبي</h2><span class="extime" id="exT"></span></div>
        <div class="exdots">${qs.map((q,i)=>`<button data-i="${i}" class="${i===pos?'cur':''} ${ans[q]!=null?'ans':''}">${num(i+1)}</button>`).join('')}</div>
        <span class="qtag">${QCAT[x.c]}</span><p class="qq"></p><div class="qopts"></div>
        <div class="row"><button class="btn ghost" id="exP" ${pos===0?'disabled':''}>السابق</button><button class="btn primary" id="exN">${pos<qs.length-1?'التالي':'إنهاء وتصحيح'}</button></div>`;
      body.querySelector('.qq').textContent=x.q;
      const w=body.querySelector('.qopts'); order.forEach(i=>{ const b=document.createElement('button'); b.textContent=x.o[i]; if(ans[qi]===i) b.className='sel'; b.onclick=()=>{ ans[qi]=i; draw(); }; w.appendChild(b); });
      body.querySelectorAll('.exdots button').forEach(b=>b.onclick=()=>{ pos=+b.dataset.i; draw(); });
      body.querySelector('#exP').onclick=()=>{ pos--; draw(); };
      body.querySelector('#exN').onclick=()=>{ if(pos<qs.length-1){ pos++; draw(); } else { const un=qs.filter(q=>ans[q]==null).length; if(!un || confirm(`باقي ${un} سؤال بدون إجابة. تنهي الاختبار؟`)) finish(); } };
      sh.appendChild(body); upd(); };
    const upd=()=>{ const el=sh.querySelector('#exT'); if(el){ el.textContent=`⏱ ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`; el.classList.toggle('low',left<=120); } };
    tick=setInterval(()=>{ if(!sh.isConnected || $('scrim').hidden){ clearInterval(tick); return; } left--; upd(); if(left<=0) finish(); },1000);
    draw();
  });
}
function openPractice(cat){
  const Q=quizState(); const pool=QUIZ.filter(x=>cat==='all'||(cat==='wrong'?Q.wrong[x.id]:x.c===cat)).map(x=>x.id);
  const order=pool.sort((a,b)=>(Q.answers[a]?1:0)-(Q.answers[b]?1:0) || Math.random()-.5); let pos=0, right=0;
  openSheet(sh=>{
    const draw=(ans)=>{ sh.querySelectorAll('.pbody').forEach(e=>e.remove()); const body=document.createElement('div'); body.className='pbody';
      if (pos>=order.length || !order.length){ body.innerHTML=`<h2>${order.length?'خلصت! 🎉':'ما فيه أسئلة'}</h2><p class="sub">${num(right)} صح من ${num(order.length)}</p>`; const b=document.createElement('button'); b.className='btn primary'; b.textContent='إغلاق'; b.onclick=closeSheet; body.appendChild(b); sh.appendChild(body); return; }
      const qi=order[pos];
      body.innerHTML=`<h2>${cat==='all'?'كل المواد':cat==='wrong'?'بنك أخطائك':QCAT[cat]}</h2><div class="pbar"><i style="width:${Math.round(100*pos/order.length)}%"></i></div><p class="sub">سؤال ${num(pos+1)} من ${num(order.length)}</p>`;
      body.appendChild(qBlock(qi, i=>{ const ok=recordAnswer(qi,i,true); if(ok) right++; save(); draw({pick:i,ok}); renderLaw(); }, ans));
      if (ans){ const n=document.createElement('button'); n.className='btn primary'; n.style.marginTop='12px'; n.textContent=pos+1<order.length?'السؤال اللي بعده':'النتيجة'; n.onclick=()=>{ pos++; draw(null); sh.scrollTop=0; }; body.appendChild(n); }
      sh.appendChild(body); };
    draw(null);
  });
}
function renderQuizOnly(){ renderQuiz(); }

function renderLaw(){ const box=$('lawPanel'); if(!box) return; const Q=quizState(); const A=Object.entries(Q.answers); const ok=A.filter(([,a])=>a.ok).length;
  let streak=0, d=todayISO(); const days=new Set(A.map(([,a])=>a.date)); if(!days.has(d)) d=addDays(d,-1); while(days.has(d)){ streak++; d=addDays(d,-1); }
  const cats=Object.keys(QCAT).map(c=>{ const ids=QUIZ.filter(x=>x.c===c).map(x=>x.id); const ans=ids.filter(id=>Q.answers[id]); const good=ans.filter(id=>Q.answers[id].ok).length; return {c,n:ids.length,ans:ans.length,good}; });
  box.innerHTML=`<h3>أسئلة القانون 2026/2027</h3><div class="stats" style="margin-top:6px"><div class="stat"><b>${A.length?num(Math.round(100*ok/A.length))+'%':'–'}</b><span>نسبة الإجابات الصح</span></div><div class="stat"><b>${num(streak)}</b><span>أيام متتالية</span></div></div>
    <p class="note" style="margin:10px 0 6px">تدرّب على مادة معينة:</p><div class="qcats">${cats.map(k=>`<button data-c="${k.c}"><b>${QCAT[k.c]}</b><small>${num(k.ans)}/${num(k.n)}${k.ans?`، ${num(Math.round(100*k.good/k.ans))}% صح`:''}</small><i style="width:${Math.round(100*k.ans/k.n)}%"></i></button>`).join('')}<button data-c="all"><b>كل المواد</b><small>${num(QUIZ.length)} سؤال</small></button></div>
    ${Object.keys(Q.wrong).length?`<button class="wrongbtn" id="wrongBtn"><span>🔁</span><div><b>بنك أخطائك: ${num(Object.keys(Q.wrong).length)} سؤال</b><small>كل سؤال يطلع من البنك إذا جاوبته صح مرتين</small></div></button>`:''}
    <button class="btn primary" id="examBtn" style="width:100%;margin-top:12px">📝 اختبار تجريبي: 20 سؤال في 20 دقيقة</button>
    ${(Q.exams||[]).length?`<p class="note" style="margin:10px 0 4px">آخر نتائجك:</p><div class="exhist">${Q.exams.slice(-5).reverse().map(e=>{const p=Math.round(100*e.right/e.total); return `<span class="${p>=80?'pass':'fail'}">${num(p)}%<small>${fDm.format(parse(e.date))}</small></span>`;}).join('')}</div>`:''}
    <a class="btn ghost" id="lawApp" href="${LAW_APP}" target="_blank" rel="noopener" style="width:100%;margin-top:10px">📚 افتح منصة القانون</a>
    <p class="note" style="margin-top:8px">${num(QUIZ.length)} سؤال من كتاب قانون كرة القدم 2026/2027، وكل إجابة معها رقم المادة والصفحة. البنك نفسه اللي في منصة القانون، ومعه أسئلة تمركز الحكم المساعد.</p>`;
  box.querySelector('#examBtn').onclick=openExam; const wb=box.querySelector('#wrongBtn'); if(wb) wb.onclick=()=>openPractice('wrong');
  box.querySelectorAll('.qcats button').forEach(b=>b.onclick=()=>openPractice(b.dataset.c)); }

export { QUIZ, QBY, QCAT, quizState, migrateV2, recordAnswer, quizOf, qBlock, renderQuiz, renderLaw,
         openExam, openPractice, renderQuizOnly };
