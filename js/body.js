// body.js — looking after the body around a session: a pain check before
// training, and the referee's recovery routine.
//
// The pain check sits at the top of a training session's sheet. An answer marks
// the exercises that load the sore area (skip them, or halve them when it is
// mild), and a strong one offers to turn the day into recovery. It is kept on the
// day's log (logs[d].pain) so the coach sees it and the next days can take it
// into account.
//
// The recovery routine is foam rolling and stretches for the legs a referee uses
// most, each with a timer and a YouTube demonstration. It opens from rest and
// recovery days and from Today the morning after a match.

import { state, save, num } from './state.js';
import { icon } from './ui.js';
import { startTimer } from './figures.js';

export const AREAS = [
  ['calf', 'السمانة'], ['ham', 'الفخذ الخلفية'], ['quad', 'الفخذ الأمامية'], ['knee', 'الركبة'],
  ['ankle', 'الكاحل'], ['hip', 'الورك والحوض'], ['back', 'أسفل الظهر'],
];
const AREA = Object.fromEntries(AREAS);
const LEVELS = ['خفيف', 'متوسط', 'قوي'];

// Which exercises put load on each area (keys of D in js/figures.js).
const LOADS = {
  calf:  ['sprint', 'sideSprint', 'backSprint', 'coda', 'ariet', 'reaction', 'pogo', 'lateralHop', 'broadJump', 'calf', 'highKnees'],
  ham:   ['sprint', 'sideSprint', 'backSprint', 'coda', 'ariet', 'reaction', 'broadJump', 'nordic', 'bridge', 'legSwing'],
  quad:  ['squat', 'lunge', 'bulgarian', 'broadJump', 'backSprint', 'highKnees'],
  knee:  ['squat', 'lunge', 'bulgarian', 'broadJump', 'lateralHop', 'pogo', 'coda', 'reaction'],
  ankle: ['pogo', 'lateralHop', 'broadJump', 'coda', 'sideSprint', 'reaction', 'calf', 'ariet'],
  hip:   ['lunge', 'bulgarian', 'sideSprint', 'coda', 'lateralHop', 'legSwing'],
  back:  ['nordic', 'broadJump', 'squat', 'bridge'],
};

export function painFor(date){ return (state.logs[date] && state.logs[date].pain) || null; }

/* ---------- the pain check ---------- */
export function painCardHTML(date){
  const p = painFor(date);
  return `<div class="dgcard paincard" id="painCard">
    <div class="dghead"><h4>${icon('heart')} فيك ألم أو شد اليوم؟</h4></div>
    ${p ? painSummary(p) : `<div class="painopts" id="painAsk"><button data-a="no">لا، تمام</button><button data-a="yes">نعم</button></div>`}
    <div id="painForm" hidden>
      <p class="painq">وين؟</p><div class="painopts" id="painArea">${AREAS.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join('')}</div>
      <p class="painq">قد إيش؟</p><div class="painopts" id="painLevel">${LEVELS.map((l, i) => `<button data-l="${i + 1}">${l}</button>`).join('')}</div>
    </div>
  </div>`;
}
function painSummary(p){
  if (p.none) return `<p class="painok">✓ تمام، بالتوفيق في تمرينك.</p><button class="painredo" data-redo>غيّر</button>`;
  const lvl = LEVELS[p.level - 1];
  const advice = p.level >= 3
    ? 'ألم قوي: لا تتمرن اليوم. حوّله استشفاء، وإذا ما خف خلال يومين راجع مختص.'
    : p.level === 2 ? `تخطّ التمارين المعلّمة تحت لأنها تضغط على ${AREA[p.area]}، وكمّل الباقي بجهد أخف.`
    : `سوّ التمارين المعلّمة بنص العدد وجهد أقل، ووقّف إذا زاد الألم.`;
  return `<p class="painres lvl${p.level}"><b>${AREA[p.area]} · ${lvl}</b>${advice}</p>
    ${p.level >= 3 ? '<button class="btn primary sm" id="painRecover" style="width:100%">حوّل اليوم استشفاء</button>' : ''}
    <button class="painredo" data-redo>غيّر</button>`;
}

// Wires the card and marks the exercise cards. onRecover turns the day into recovery.
export function bindPain(sh, date, onRecover){
  const card = sh.querySelector('#painCard'); if (!card) return;
  const set = p => {
    state.logs[date] = { ...(state.logs[date] || {}), pain: p };
    save(); refresh();
  };
  const refresh = () => {
    card.outerHTML = painCardHTML(date);
    bindPain(sh, date, onRecover);
  };
  const ask = card.querySelector('#painAsk'), form = card.querySelector('#painForm');
  if (ask) ask.querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.dataset.a === 'no') set({ none: true });
    else { ask.hidden = true; form.hidden = false; }
  });
  let area = null;
  card.querySelectorAll('#painArea button').forEach(b => b.onclick = () => {
    area = b.dataset.k; card.querySelectorAll('#painArea button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  card.querySelectorAll('#painLevel button').forEach(b => b.onclick = () => {
    if (!area) { card.querySelector('#painArea').classList.add('need'); return; }
    set({ area, level: +b.dataset.l });
  });
  const redo = card.querySelector('[data-redo]');
  if (redo) redo.onclick = () => {
    const l = { ...(state.logs[date] || {}) }; delete l.pain;
    if (Object.keys(l).length) state.logs[date] = l; else delete state.logs[date];
    save(); refresh();
  };
  const rec = card.querySelector('#painRecover');
  if (rec) rec.onclick = onRecover;
  markCards(sh, painFor(date));
}

function markCards(sh, p){
  sh.querySelectorAll('.dgcard[data-k]').forEach(c => {
    c.classList.remove('painhit', 'painlight');
    const old = c.querySelector('.painflag'); if (old) old.remove();
    if (!p || p.none || !(LOADS[p.area] || []).includes(c.dataset.k)) return;
    c.classList.add(p.level >= 2 ? 'painhit' : 'painlight');
    c.querySelector('.dghead').insertAdjacentHTML('afterend',
      `<p class="painflag">${p.level >= 2 ? `⚠ تخطّاه اليوم: يضغط على ${AREA[p.area]}` : `⚠ بنص العدد: يضغط على ${AREA[p.area]}`}</p>`);
  });
}

/* ---------- the recovery routine ---------- */
const YT = q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
export const RECOVERY = [
  ['مشي هادي', 600, 'easy recovery walk after match'],
  ['فوم رولر للسمانة', 60, 'foam roll calves', 'لكل رجل'],
  ['فوم رولر للفخذ الخلفية', 60, 'foam roll hamstrings', 'لكل رجل'],
  ['فوم رولر للفخذ الأمامية', 60, 'foam roll quads', 'لكل رجل'],
  ['فوم رولر للمؤخرة', 60, 'foam roll glutes', 'لكل جهة'],
  ['إطالة السمانة على الجدار', 30, 'standing calf stretch wall', '× 2 لكل رجل'],
  ['إطالة الفخذ الخلفية', 30, 'seated hamstring stretch', '× 2 لكل رجل'],
  ['إطالة عضلة الورك الأمامية', 30, 'kneeling hip flexor stretch', '× 2 لكل جهة'],
  ['إطالة المؤخرة (رقم 4)', 30, 'figure four glute stretch lying', '× 2 لكل جهة'],
  ['رجولك على الجدار', 300, 'legs up the wall recovery'],
];
const clockOf = s => s >= 60 ? `${num(s / 60)} د` : `${num(s)} ث`;
export function recoveryHTML(){
  const total = Math.round(RECOVERY.reduce((a, r) => a + r[1] * (/× 2/.test(r[3] || '') ? 4 : /لكل/.test(r[3] || '') ? 2 : 1), 0) / 60);
  return `<div class="dgcard reccard"><div class="dghead"><h4>${icon('heart')} روتين الاستشفاء</h4><span class="dose">حوالي ${num(total)} دقيقة</span></div>
    <p class="warmwhy">يخفف الشد بعد المباراة والتمارين القوية، ويرجّع رجولك أسرع. ما عندك فوم رولر؟ استخدم قارورة ماء أو كرة تنس.</p>
    <ol class="recsteps">${RECOVERY.map(([t, s, q, x], i) => `<li><span class="rect">${t}<small>${clockOf(s)}${x ? ' ' + x : ''}</small></span>
      <a class="warmyt" href="${YT(q)}" target="_blank" rel="noopener"><i>▶</i>مقطع</a>
      <button class="rbtn" data-rec="${i}">⏱</button></li>`).join('')}</ol></div>`;
}
export function bindRecovery(root){
  root.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
    const [t, s] = RECOVERY[+b.dataset.rec];
    startTimer(s, t, t, 'خلص، روح للي بعده');
  });
}
