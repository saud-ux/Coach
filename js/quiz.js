// quiz.js — the laws-of-the-game question bank and everything that drills it.
//
// The bank is the law app's: 350 questions from the 2026/27 IFAB laws, copied
// into js/lawbank.js by scripts/export-law-bank.py, each with an article, a page,
// a difficulty and a type. Alongside them sit 26 questions of this app's own on
// the assistant referee's positioning and signals (the book's practical
// guidelines, pp. 212-229), which the law app does not cover, and 13 asked on a
// drawing of the pitch (js/pitch.js): where to stand, and offside or not.
//
// It works the way the law app does:
//   - one question a day, chosen by review priority and fixed for the day, with
//     the answer and the explanation revealed at once;
//   - a test: pick the law (or all of them), how many questions, the difficulty,
//     how they are chosen, and whether there is a clock (a minute a question).
//     It runs like an exam: nothing is revealed until the end, you can move back
//     and forth, change an answer or clear it by tapping it again;
//   - spaced review: a wrong answer brings the question back after a day or two,
//     and it counts as mastered after three correct answers in a row.
//
// PROGRESS IS KEYED BY QUESTION ID ('L11-04', 'G-07'), never by position, so the
// bank can grow or be re-exported without moving anyone's answers. Before v3 it
// was keyed by position in the old 92-question list; migrateV2() converts that,
// and migrateV3() turns v3's two-strike wrong bank into the law app's scheduling.
//
// Which question is "today's" is derived from the date by dayHash(), so it is the
// same question all day and across devices without storing a schedule.
import { state, save, num, parse, addDays, todayISO, fDm, $ } from './state.js';
import { openSheet, closeSheet } from './main.js';
import { LAW_BANK, LAW_CATS } from './lawbank.js';
import { PITCH_QS, pitchSVG } from './pitch.js';

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
const QCAT = { ...LAW_CATS, g: 'التمركز والإشارات', p: 'على رسم الملعب' };
const QUIZ = [...LAW_BANK, ...AR_GUIDE, ...PITCH_QS];
const QBY = new Map(QUIZ.map(x => [x.id, x]));
const DIFF = { 1: 'سهل', 2: 'متوسط', 3: 'صعب' };
const qRef = x => x.c === 'g' ? `الإرشادات العملية، صفحة ${num(x.p)}` : `${x.r}، صفحة ${num(x.p)}`;
// the pitch drawing for a question that has one; after the answer, the right letter is lit
function figBlock(x, reveal){
  const d = document.createElement('div'); d.className = 'pfig';
  d.innerHTML = pitchSVG(x.fig, reveal ? x.a : null);
  return d;
}
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

/* ---------- progress: v3 -> v4 ---------- */
// v4 keeps, per question, what the law app keeps per user and question:
//   prog[id] = { seen, ok, wrong, streak, mastered, due }
// and drops v3's `wrong` bank, which prog replaces. A v3 wrong-bank entry becomes
// a question due for review today, with its correct answers since as the streak.
const SPACING = [2, 5, 9];          // days to the next review after 1, 2, 3 right in a row
const CFG0 = { scope: 'all', count: 20, diff: 0, mode: 'mixed', timer: true };
function migrateV3(old){
  const t = todayISO(), prog = {}, days = {};
  for (const [id, a] of Object.entries(old.answers || {})){
    if (a && a.date) days[a.date] = (days[a.date] || 0) + 1;
    if (!QBY.has(id)) continue;
    const w = (old.wrong || {})[id];
    prog[id] = {
      seen: 1, ok: a.ok ? 1 : 0,
      wrong: w ? (w.n || 1) : (a.ok ? 0 : 1),
      streak: w ? (w.fix || 0) : (a.ok ? 1 : 0),
      mastered: !!a.ok && !w,
      due: (w || !a.ok) ? t : null
    };
  }
  return { v: 4, answers: old.answers || {}, daily: old.daily || {}, prog, days,
           exams: old.exams || [], cfg: { ...CFG0 } };
}

function dayHash(s){ let h=0; for (const c of s) h=(h*31+c.charCodeAt(0))>>>0; return h; }
function shuffle(a, seed){
  let s = seed == null ? Math.floor(Math.random() * 2**31) : seed;
  for (let i = a.length - 1; i > 0; i--){ s = (s*1103515245 + 12345) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function quizState(){
  if (state.quiz && state.quiz.v === 2) state.quiz = migrateV2(state.quiz);
  if (state.quiz && state.quiz.v === 3) state.quiz = migrateV3(state.quiz);
  if (!state.quiz || state.quiz.v !== 4) state.quiz = { v: 4, answers: {}, daily: {}, prog: {}, days: {}, exams: [], cfg: { ...CFG0 } };
  const Q = state.quiz;
  Q.prog ||= {}; Q.days ||= {}; Q.exams ||= [];
  // filled in place, never replaced: the panel holds a reference to this object
  // while its handlers change it
  Q.cfg ||= {};
  for (const k in CFG0) if (!(k in Q.cfg)) Q.cfg[k] = CFG0[k];
  return Q;
}

// The law app's record_answer(), step for step.
function recordAnswer(id, pick, extra){
  const Q = quizState(), x = QBY.get(id), t = todayISO();
  const ok = pick != null && pick === x.a;
  Q.answers[id] = { pick: pick == null ? -1 : pick, ok, date: t, extra: !!extra };
  Q.days[t] = (Q.days[t] || 0) + 1;
  const p = Q.prog[id] ||= { seen: 0, ok: 0, wrong: 0, streak: 0, mastered: false, due: null };
  p.seen++;
  if (ok){
    p.ok++; p.streak++;
    if (!p.wrong || p.streak >= 3){ p.mastered = true; p.due = null; }
    else p.due = addDays(t, SPACING[Math.min(p.streak - 1, 2)]);
  } else {
    p.wrong++; p.streak = 0; p.mastered = false;
    p.due = addDays(t, p.wrong >= 2 ? 1 : 2);
  }
  return ok;
}

// Smaller comes first: due for review, never seen, got wrong, seen, mastered.
function priority(p, t){
  if (!p || !p.seen) return 1;
  if (p.mastered) return 4;
  if (p.due && p.due <= t) return 0;
  return p.wrong ? 2 : 3;
}
const isMistake = p => p && !p.mastered && p.wrong > 0;

// Chosen once from the most urgent tier and then fixed for the day, so it does not
// change as the day's answers move other questions around.
function quizOf(date){
  const Q = quizState();
  if (Q.daily[date] != null && QBY.has(Q.daily[date])) return Q.daily[date];
  const ranked = QUIZ.map(x => [x.id, priority(Q.prog[x.id], date)]);
  const best = Math.min(...ranked.map(r => r[1]));
  const pool = ranked.filter(r => r[1] === best).map(r => r[0]);
  const id = pool[dayHash(date) % pool.length];
  Q.daily[date] = id;
  return id;
}

/* ---------- stats ---------- */
function lawStats(){
  const Q = quizState(), t = todayISO();
  let seen = 0, ok = 0, mastered = 0, mistakes = 0, due = 0;
  for (const [id, p] of Object.entries(Q.prog)){
    if (!QBY.has(id)) continue;
    seen += p.seen; ok += p.ok;
    if (p.mastered) mastered++;
    if (isMistake(p)) mistakes++;
    if (!p.mastered && p.due && p.due <= t) due++;
  }
  // answers to questions that left the bank still count towards accuracy
  for (const [id, a] of Object.entries(Q.answers)) if (!QBY.has(id)){ seen++; if (a.ok) ok++; }
  const days = new Set([...Object.keys(Q.days), ...Object.values(Q.answers).map(a => a.date)]);
  let streak = 0, d = t;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)){ streak++; d = addDays(d, -1); }
  return { seen, ok, acc: seen ? Math.round(100 * ok / seen) : null, mastered, mistakes, due, streak };
}

/* ---------- one question, revealed ---------- */
const SCOPES = () => ['all', ...Object.keys(LAW_CATS).sort((a, b) => a - b), 'g', 'p'];
const scopeName = s => s === 'all' ? 'كل المواد' : s === 'mistakes' ? 'مراجعة الأخطاء' : QCAT[s];
const tagOf = x => `${QCAT[x.c]}${x.d ? ' · ' + DIFF[x.d] : ''}`;
function optButtons(x, { reveal = null, sel = null, onPick = null } = {}){
  const w = document.createElement('div'); w.className = 'qopts';
  x.o.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="qk"></span><span class="qo"></span>`;
    b.querySelector('.qk').textContent = reveal && i === x.a ? '✓' : num(i + 1);
    b.querySelector('.qo').textContent = o;
    if (reveal){ b.disabled = true; if (i === x.a) b.className = 'ok'; else if (i === reveal.pick) b.className = 'no'; }
    else if (sel === i){ b.className = 'sel'; b.setAttribute('aria-pressed', 'true'); }
    if (onPick) b.onclick = () => onPick(i);
    w.appendChild(b);
  });
  return w;
}
function whyBlock(x, ok){
  const p = document.createElement('p'); p.className = 'qwhy';
  p.innerHTML = `${ok == null ? '' : ok ? '✅ صح! ' : '❌ الإجابة الصحيحة بالأخضر. '}<span></span><small class="qref">📖 ${qRef(x)}</small>`;
  p.querySelector('span').textContent = x.w;
  return p;
}
function qBlock(id, onAnswer, answered){
  const x = QBY.get(id), wrap = document.createElement('div');
  wrap.innerHTML = `<span class="qtag"></span><p class="qq"></p>`;
  wrap.querySelector('.qtag').textContent = tagOf(x);
  wrap.querySelector('.qq').textContent = x.q;
  if (x.fig) wrap.appendChild(figBlock(x, !!answered));
  wrap.appendChild(optButtons(x, answered ? { reveal: answered } : { onPick: onAnswer }));
  if (answered) wrap.appendChild(whyBlock(x, answered.ok));
  return wrap;
}

/* ---------- the daily question ---------- */
let quizExtra = null, quizOpen = false;
function pickAnother(Q){
  const t = todayISO();
  const ranked = QUIZ.filter(x => x.id !== quizOf(t) && !(Q.answers[x.id] && Q.answers[x.id].date === t))
    .map(x => [x.id, priority(Q.prog[x.id], t)]);
  if (!ranked.length) return QUIZ[Math.floor(Math.random() * QUIZ.length)].id;
  const best = Math.min(...ranked.map(r => r[1]));
  const pool = ranked.filter(r => r[1] === best);
  return pool[Math.floor(Math.random() * pool.length)][0];
}
function renderQuiz(){
  const box = $('quiz'); if (!box) return; const Q = quizState();
  const t = todayISO(), qi = quizExtra ?? quizOf(t), a = Q.answers[qi];
  const answered = a && a.date === t && (quizExtra != null ? a.extra : true) ? a : null;
  const S = lawStats();
  if (answered && quizExtra == null && !quizOpen){
    const c = document.createElement('div'); c.className = 'rcard qmini';
    c.innerHTML = `<span class="cav">⚖️</span><div><b>سؤال اليوم</b><small>${answered.ok ? '✅ جاوبت صح' : '❌ راجع الإجابة'}، ${QCAT[QBY.get(qi).c]}</small></div><button class="chip">عرض</button><button class="chip">سؤال ثاني</button>`;
    const [v, m] = c.querySelectorAll('.chip');
    v.onclick = () => { quizOpen = true; renderQuiz(); };
    m.onclick = () => { quizExtra = pickAnother(Q); renderQuiz(); };
    box.innerHTML = ''; box.appendChild(c); return;
  }
  const c = document.createElement('div'); c.className = 'rcard qcard';
  c.innerHTML = `<div class="chead"><span class="cav">⚖️</span><b>${quizExtra != null ? 'سؤال إضافي' : 'سؤال اليوم'}</b><span class="rpct" style="margin-inline-start:auto">${num(S.mastered)}/${num(QUIZ.length)} أتقنتها</span></div>`;
  c.appendChild(qBlock(qi, i => { recordAnswer(qi, i, quizExtra != null); save(); renderQuiz(); renderLaw(); }, answered));
  if (answered){
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '10px';
    const more = document.createElement('button'); more.className = 'btn ghost sm'; more.textContent = 'سؤال ثاني';
    more.onclick = () => { quizExtra = pickAnother(Q); renderQuiz(); };
    row.appendChild(more);
    if (quizExtra == null){ const n = document.createElement('span'); n.className = 'note'; n.textContent = 'ارجع بكرة لسؤال جديد.'; n.style.alignSelf = 'center'; row.appendChild(n); }
    c.appendChild(row);
  }
  box.innerHTML = ''; box.appendChild(c);
}

/* ---------- the test: setup ---------- */
const MODES = {
  mixed:  ['ذكي', 'يبدأ باللي ما حليته، ثم اللي غلطت فيه، ثم اللي حان موعد مراجعته.'],
  random: ['عشوائي', 'أسئلة بدون ترتيب من المادة اللي اخترتها.'],
  hard:   ['الأصعب أولًا', 'أصعب أسئلة المادة أولًا.']
};
const COUNTS = [5, 10, 20, 30, 50];
const DIFFS = [[0, 'الكل'], [1, 'سهل'], [2, 'متوسط'], [3, 'صعب']];
const minutesFor = n => n;                       // a minute a question, as in the law app
let cfgOpen = false;

function poolFor(cfg){
  return QUIZ.filter(x => (cfg.scope === 'all' || x.c === cfg.scope) && (!cfg.diff || x.d === cfg.diff));
}
function pickQuestions(cfg, mistakes){
  const Q = quizState(), t = todayISO();
  let pool = mistakes ? QUIZ.filter(x => isMistake(Q.prog[x.id])) : poolFor(cfg);
  shuffle(pool);
  if (mistakes) pool.sort((a, b) => Q.prog[b.id].wrong - Q.prog[a.id].wrong);
  else if (cfg.mode === 'hard') pool.sort((a, b) => (b.d || 2) - (a.d || 2));
  else if (cfg.mode === 'mixed') pool.sort((a, b) => priority(Q.prog[a.id], t) - priority(Q.prog[b.id], t));
  return shuffle(pool.slice(0, cfg.count).map(x => x.id));
}
function cfgSummary(c){
  const n = Math.min(c.count, poolFor(c).length);
  return [scopeName(c.scope), `${num(n)} سؤال`, c.diff ? DIFF[c.diff] : 'كل المستويات', MODES[c.mode][0],
          c.timer ? `${num(minutesFor(n))} دقيقة` : 'بدون مؤقت'];
}
function cfgFields(c){
  return `<div class="qcfg">
    <label class="f" for="cfgScope">المادة</label>
    <select class="in" id="cfgScope">${SCOPES().map(s => `<option value="${s}" ${s === c.scope ? 'selected' : ''}>${scopeName(s)} (${num(QUIZ.filter(x => s === 'all' || x.c === s).length)})</option>`).join('')}</select>
    <label class="f">عدد الأسئلة</label>
    <div class="chiprow">${COUNTS.map(n => `<button class="chip ${c.count === n ? 'on' : ''}" data-k="count" data-v="${n}">${num(n)}</button>`).join('')}</div>
    <label class="f">الصعوبة</label>
    <div class="chiprow">${DIFFS.map(([v, l]) => `<button class="chip ${c.diff === v ? 'on' : ''}" data-k="diff" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="f">طريقة الاختيار</label>
    <div class="chiprow">${Object.entries(MODES).map(([k, v]) => `<button class="chip ${c.mode === k ? 'on' : ''}" data-k="mode" data-v="${k}">${v[0]}</button>`).join('')}</div>
    <p class="note" style="margin-top:6px">${MODES[c.mode][1]}</p>
    <label class="f">المؤقت</label>
    <div class="chiprow">
      <button class="chip ${c.timer ? 'on' : ''}" data-k="timer" data-v="1">مؤقت (دقيقة لكل سؤال)</button>
      <button class="chip ${!c.timer ? 'on' : ''}" data-k="timer" data-v="0">بدون مؤقت</button>
    </div>
  </div>`;
}

/* ---------- the test: running it ---------- */
// Runs like an exam: nothing is revealed until the end. Tapping the chosen answer
// again clears it, so a question can be left blank. Unanswered counts as wrong.
function runTest(ids, meta){
  const n = ids.length, ans = new Array(n).fill(null), useTimer = meta.timer;
  let pos = 0, left = useTimer ? minutesFor(n) * 60 : 0, tick = null, done = false;
  const started = Date.now();
  openSheet(sh => {
    const clock = () => { const el = sh.querySelector('#exT'); if (!el) return;
      el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left <= 60); };
    const finish = (auto) => {
      if (done) return;
      const blank = ans.filter(a => a == null).length;
      if (!auto){
        if (blank && !confirm(`باقي ${blank} سؤال بدون إجابة وبتنحسب غلط. تقدر ترجع تكملها. تنهي الاختبار؟`)) return;
        if (!blank && !confirm('بيظهر التصحيح الحين. تنهي الاختبار؟')) return;
      }
      done = true; clearInterval(tick);
      const secs = Math.round((Date.now() - started) / 1000);
      let right = 0;
      ids.forEach((id, i) => { if (ans[i] != null && recordAnswer(id, ans[i], true)) right++; });
      const Q = quizState();
      Q.exams.push({ date: todayISO(), right, total: n, secs, scope: meta.scope, mode: meta.mode, diff: meta.diff || 0 });
      save(); renderQuiz(); renderLaw();
      showResult(right, secs);
    };
    const showResult = (right, secs) => {
      const pct = Math.round(100 * right / n);
      const mood = pct >= 90 ? 'نتيجة ممتازة 👏' : pct >= 70 ? 'نتيجة جيدة' : pct >= 50 ? 'نتيجة متوسطة' : 'تحتاج مراجعة';
      sh.innerHTML = `<div class="exres ${pct >= 70 ? 'pass' : 'fail'}"><b>${num(right)} <span style="display:inline;font-size:20px;color:var(--muted)">من ${num(n)}</span></b>
        <span>${mood}</span><small>${scopeName(meta.scope)} · ${num(pct)}% · الوقت ${num(Math.floor(secs / 60))}:${String(secs % 60).padStart(2, '0')}</small></div>
        <div class="row"><button class="btn primary" id="exAgain">اختبار جديد</button><button class="btn ghost" id="exBack">العودة</button></div>`;
      sh.querySelector('#exAgain').onclick = () => { closeSheet(); startTest(meta.scope === 'mistakes'); };
      sh.querySelector('#exBack').onclick = closeSheet;
      const wrong = ids.map((id, i) => [id, ans[i]]).filter(([id, a]) => a !== QBY.get(id).a);
      const h = document.createElement('h3'); h.style.margin = '18px 0 6px';
      h.textContent = wrong.length ? `راجع أخطاءك (${num(wrong.length)})` : 'ولا خطأ! 🔥';
      sh.appendChild(h);
      wrong.forEach(([id, a]) => { const x = QBY.get(id); const d = document.createElement('div'); d.className = 'exrev';
        d.innerHTML = `<span class="qtag"></span><p class="qq"></p><p class="exa">❌ ${a != null ? 'إجابتك: <span class="y"></span><br>' : 'ما جاوبت<br>'}✅ الصحيحة: <span class="c"></span></p>`;
        d.querySelector('.qtag').textContent = tagOf(x); d.querySelector('.qq').textContent = x.q;
        if (x.fig) d.querySelector('.qq').after(figBlock(x, true));
        if (a != null) d.querySelector('.y').textContent = x.o[a];
        d.querySelector('.c').textContent = x.o[x.a];
        d.appendChild(whyBlock(x, null)); sh.appendChild(d); });
      sh.scrollTop = 0;
    };
    const draw = () => {
      const id = ids[pos], x = QBY.get(id), answered = ans.filter(a => a != null).length;
      sh.innerHTML = `<div class="exhead"><div><span class="qtag" style="margin:0">${scopeName(meta.scope)}</span>
          <p class="note" style="margin-top:4px">السؤال ${num(pos + 1)} من ${num(n)}</p></div>
          ${useTimer ? '<span class="extime" id="exT"></span>' : '<span class="extime">بدون مؤقت</span>'}</div>
        <div class="pbar"><i style="width:${Math.round(100 * answered / n)}%"></i></div>
        <p class="note">جاوبت ${num(answered)} من ${num(n)}</p>
        <div class="exdots">${ids.map((_, i) => `<button data-i="${i}" class="${i === pos ? 'cur' : ''} ${ans[i] != null ? 'ans' : ''}">${num(i + 1)}</button>`).join('')}</div>
        <span class="qtag"></span><p class="qq"></p><div id="exOpts"></div>
        <div class="row"><button class="btn ghost" id="exP" ${pos === 0 ? 'disabled' : ''}>السابق</button>
          <button class="btn primary" id="exN" style="flex:1">${pos < n - 1 ? 'التالي' : 'إظهار النتيجة'}</button></div>
        <button class="btn ghost sm" id="exEnd" style="width:100%;margin-top:10px">إنهاء الاختبار الآن</button>`;
      sh.querySelector('.qq').textContent = x.q;
      sh.querySelectorAll('.qtag')[1].textContent = tagOf(x);
      if (x.fig) sh.querySelector('#exOpts').before(figBlock(x, false));
      sh.querySelector('#exOpts').appendChild(optButtons(x, { sel: ans[pos], onPick: i => { ans[pos] = ans[pos] === i ? null : i; draw(); } }));
      sh.querySelectorAll('.exdots button').forEach(b => b.onclick = () => { pos = +b.dataset.i; draw(); });
      sh.querySelector('#exP').onclick = () => { if (pos > 0){ pos--; draw(); } };
      sh.querySelector('#exN').onclick = () => { if (pos < n - 1){ pos++; draw(); } else finish(false); };
      sh.querySelector('#exEnd').onclick = () => finish(false);
      clock();
    };
    if (useTimer) tick = setInterval(() => {
      if (!sh.isConnected || $('scrim').hidden){ clearInterval(tick); return; }
      left--; clock(); if (left <= 0) finish(true);
    }, 1000);
    draw();
  }, { bare: true });
}
function startTest(mistakes){
  const c = quizState().cfg;
  const ids = pickQuestions(c, mistakes);
  if (!ids.length){ alert(mistakes ? 'ما عندك أخطاء تحتاج مراجعة 👌' : 'ما فيه أسئلة بهذا الاختيار. جرّب صعوبة ثانية أو مادة ثانية.'); return; }
  runTest(ids, { scope: mistakes ? 'mistakes' : c.scope, mode: mistakes ? 'mistakes' : c.mode, diff: mistakes ? 0 : c.diff, timer: c.timer });
}

/* ---------- the law panel ---------- */
function renderLaw(){
  const box = $('lawPanel'); if (!box) return;
  const Q = quizState(), c = Q.cfg, S = lawStats();
  const cats = SCOPES().filter(s => s !== 'all').map(s => {
    const ids = QUIZ.filter(x => x.c === s).map(x => x.id);
    const seen = ids.filter(id => Q.prog[id] && Q.prog[id].seen);
    const tot = seen.reduce((a, id) => a + Q.prog[id].seen, 0), good = seen.reduce((a, id) => a + Q.prog[id].ok, 0);
    const mast = ids.filter(id => Q.prog[id] && Q.prog[id].mastered).length;
    return { s, n: ids.length, seen: seen.length, acc: tot ? Math.round(100 * good / tot) : null, mast };
  });
  box.innerHTML = `<h3>اختبر نفسك</h3>
    <div class="cfgline">${cfgSummary(c).map(x => `<span>${x}</span>`).join('')}</div>
    <button class="btn primary" id="tStart" style="width:100%;margin-top:12px">▶ ابدأ الآن</button>
    <div class="row" style="margin-top:8px">
      ${S.mistakes ? `<button class="btn ghost sm" id="tMist" style="flex:1">🔁 أخطائي (${num(S.mistakes)})</button>` : ''}
      <button class="btn ghost sm" id="tCfg" style="flex:1">${cfgOpen ? 'إخفاء الإعدادات' : 'تخصيص'}</button>
    </div>
    ${cfgOpen ? cfgFields(c) : ''}

    <h3 style="margin-top:22px">تقدّمك</h3>
    <div class="stats" style="margin-top:8px">
      <div class="stat"><b>${S.acc == null ? '–' : num(S.acc) + '%'}</b><span>الدقة</span></div>
      <div class="stat"><b>${num(S.streak)}</b><span>أيام متتالية</span></div>
      <div class="stat"><b>${num(S.mastered)}<small style="font-size:14px;color:var(--muted)"> / ${num(QUIZ.length)}</small></b><span>أتقنتها</span></div>
      <div class="stat"><b>${num(S.due)}</b><span>حان موعد مراجعتها</span></div>
    </div>

    <p class="note" style="margin:16px 0 6px">اختر مادة تختبر فيها:</p>
    <div class="qcats">${cats.map(k => `<button data-c="${k.s}"><b>${QCAT[k.s]}</b><small>${num(k.mast)}/${num(k.n)} أتقنتها${k.acc != null ? `، دقة ${num(k.acc)}%` : ''}</small><i style="width:${Math.round(100 * k.mast / k.n)}%"></i></button>`).join('')}</div>

    ${Q.exams.length ? `<p class="note" style="margin:16px 0 6px">آخر نتائجك:</p><div class="exhist">${Q.exams.slice(-6).reverse().map(e => { const p = Math.round(100 * e.right / e.total);
      return `<span class="${p >= 70 ? 'pass' : 'fail'}">${num(e.right)}/${num(e.total)}<small>${e.scope ? scopeName(e.scope) + ' · ' : ''}${fDm.format(parse(e.date))}</small></span>`; }).join('')}</div>` : ''}

    <a class="btn ghost" id="lawApp" href="${LAW_APP}" target="_blank" rel="noopener" style="width:100%;margin-top:16px">📚 افتح منصة القانون</a>
    <p class="note" style="margin-top:8px">${num(QUIZ.length)} سؤال من كتاب قانون كرة القدم 2026/2027، وكل إجابة معها رقم المادة والصفحة. البنك نفسه اللي في منصة القانون، ومعه أسئلة تمركز الحكم المساعد وأسئلة على رسم الملعب.</p>`;

  box.querySelector('#tStart').onclick = () => startTest(false);
  const tm = box.querySelector('#tMist'); if (tm) tm.onclick = () => startTest(true);
  box.querySelector('#tCfg').onclick = () => { cfgOpen = !cfgOpen; renderLaw(); };
  const sc = box.querySelector('#cfgScope');
  if (sc) sc.onchange = () => { c.scope = sc.value; save(); renderLaw(); };
  box.querySelectorAll('.qcfg .chip').forEach(b => b.onclick = () => {
    const k = b.dataset.k, v = b.dataset.v;
    c[k] = k === 'mode' ? v : k === 'timer' ? v === '1' : Number(v);
    save(); renderLaw();
  });
  box.querySelectorAll('.qcats button').forEach(b => b.onclick = () => {
    c.scope = b.dataset.c; cfgOpen = true; save(); renderLaw();
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

export { QUIZ, QBY, QCAT, quizState, migrateV2, migrateV3, recordAnswer, quizOf, priority,
         lawStats, pickQuestions, renderQuiz, renderLaw, startTest };
