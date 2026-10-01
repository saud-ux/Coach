// pitch.js — questions asked on a drawing of the pitch, and the drawing itself.
//
// Two kinds: "where do you stand" (letters marked on the pitch, pick one) and
// "offside or not" (a moment frozen as the ball is played). They join the quiz
// bank as their own category, 'p', and run through the same daily question, tests
// and spaced review as the rest; the quiz draws fig above the question.
//
// Coordinates are metres on a real pitch, seen from behind the goal:
//   a  across, 0 the far touchline to 68 the near one, the assistant's side
//   d  out from the goal line, 0 to 52.5 at halfway
// so the goal is at the top and the assistant runs down the right edge. The
// drawing shows depth 0..fig.h (36 unless a question needs more).
//
// fig: { h, gk:[a,d], def:[[a,d],...], att:[[a,d,'9'],...], ball:[a,d],
//        pass:[[a1,d1,a2,d2],...], marks:[[a,d,'أ'],...] }
// Every scenario was checked against Law 11 and the practical guidelines for the
// assistant referee; the second-last opponent is counted with the goalkeeper.

const OFF = ['تسلل، أرفع الراية', 'لا تسلل، اللعب مستمر'];
const POS = ['الموقع أ', 'الموقع ب', 'الموقع ج'];
const L11 = { r: 'المادة 11 التسلل', p: 109 };
const AR = 'الإرشادات العملية';

export const PITCH_QS = [
  { id: 'P-01', c: 'p', d: 1, r: AR, p: 212,
    q: 'اللعب مفتوح والكرة مع رقم 10. وين لازم تكون على الخط؟', o: POS, a: 0,
    w: 'على خط واحد مع ثاني آخر مدافع (الحارس هو الأخير)، لأن الكرة أبعد عن خط المرمى منه. ب مستوى الكرة، وج حافة منطقة الجزاء وما لها علاقة بالتسلل هنا.',
    fig: { gk: [34, 3], def: [[44, 24], [26, 27], [14, 28]], att: [[30, 32, '10'], [52, 21, '9'], [18, 25, '11']], ball: [30, 33.6],
           marks: [[71, 24, 'أ'], [71, 32, 'ب'], [71, 16.5, 'ج']] } },
  { id: 'P-02', c: 'p', d: 2, r: AR, p: 212,
    q: 'رقم 7 يجري بالكرة جهتك وصار أقرب لخط المرمى من كل المدافعين ما عدا الحارس. وين تكون؟', o: POS, a: 1,
    w: 'إذا كانت الكرة أقرب لخط المرمى من ثاني آخر مدافع، يكون المساعد على خط واحد مع الكرة. أ مستوى المدافع، وج خط المرمى.',
    fig: { gk: [36, 2], def: [[38, 13], [28, 14]], att: [[56, 6.4, '7'], [30, 18, '9']], ball: [56, 8],
           marks: [[71, 13, 'أ'], [71, 8, 'ب'], [71, 0, 'ج']] } },
  { id: 'P-03', c: 'p', d: 2, r: AR, p: 217,
    q: 'ركلة مرمى من جهتك. وين تقف أول شي؟', o: POS, a: 0,
    w: 'يبدأ على خط واحد مع خط منطقة المرمى ليتأكد إن الكرة داخلها. إذا ما كانت في مكانها يبقى مكانه ويتواصل مع الحكم ويرفع الراية، وبعدها يأخذ موقعه لمراقبة خط التسلل.',
    fig: { gk: [38, 2.5], def: [[20, 14], [50, 15]], att: [[30, 30, '9'], [46, 31, '11']], ball: [40, 4],
           marks: [[71, 5.5, 'أ'], [71, 16.5, 'ب'], [71, 30, 'ج']] } },
  { id: 'P-04', c: 'p', d: 1, r: AR, p: 213,
    q: 'ركنية من جهتك. وين تقف؟', o: POS, a: 0,
    w: 'خلف الراية الركنية على خط واحد مع خط المرمى، بدون ما يتداخل مع المنفذ، ويتأكد إن الكرة داخل المنطقة الركنية. ب تقاطع خط المرمى مع منطقة الجزاء، وهذا مكان ركلة الجزاء.',
    fig: { gk: [33, 1], def: [[30, 6], [38, 7], [47, 8]], att: [[64.6, -1.9, '7'], [34, 9.5, '9'], [41, 11, '5']], ball: [67.4, 0.6],
           marks: [[72, 0, 'أ'], [54.16, 0, 'ب'], [71, 16.5, 'ج']] } },
  { id: 'P-05', c: 'p', d: 1, r: AR, p: 221,
    q: 'ركلة جزاء، والمباراة بدون تقنية خط المرمى وبدون حكم فيديو. وين تتمركز؟', o: POS, a: 0,
    w: 'على نقطة تقاطع خط المرمى مع خط منطقة الجزاء، عشان يحكم إذا الكرة دخلت المرمى ويراقب تقدم الحارس عن خط المرمى.',
    fig: { gk: [34, 0.4], def: [[24, 19], [44, 19]], att: [[34, 14.6, '9'], [27, 20.5, '8']], ball: [34, 11],
           marks: [[54.16, 0, 'أ'], [72, 0, 'ب'], [71, 11, 'ج']] } },
  { id: 'P-06', c: 'p', d: 2, r: AR, p: 221,
    q: 'نفس ركلة الجزاء، بس المباراة فيها تقنية خط المرمى وحكم فيديو. وين الأفضل تكون؟', o: POS, a: 2,
    w: 'يُستحسن يكون على خط التماس مقابل علامة الجزاء، لأن التواجد على خط المرمى يمنعه من العودة لتقدير التسلل إذا ارتدت الكرة.',
    fig: { gk: [34, 0.4], def: [[24, 19], [44, 19]], att: [[34, 14.6, '9'], [27, 20.5, '8']], ball: [34, 11],
           marks: [[54.16, 0, 'أ'], [72, 0, 'ب'], [71, 11, 'ج']] } },
  { id: 'P-07', c: 'p', d: 1, ...L11,
    q: 'هذي اللحظة اللي مرر فيها رقم 8. رقم 9 استلم الكرة. القرار؟', o: OFF, a: 0,
    w: 'لحظة التمرير كان رقم 9 أقرب لخط المرمى من الكرة ومن ثاني آخر مدافع، ولعب الكرة، فيُعاقب. العبرة بموقعه لحظة لعب زميله للكرة، مو لحظة استلامها.',
    fig: { gk: [34, 2], def: [[24, 15], [42, 17]], att: [[30, 30, '8'], [50, 12, '9']], ball: [30, 31.6],
           pass: [[30, 31.6, 50, 13.6]] } },
  { id: 'P-08', c: 'p', d: 1, ...L11,
    q: 'رقم 9 كان على خط واحد مع المدافع لحظة تمرير رقم 8. القرار؟', o: OFF, a: 1,
    w: 'المهاجم على مستوى ثاني آخر مدافع مو في موقف تسلل. لازم يكون أقرب لخط المرمى من الكرة ومن ثاني آخر منافس معًا.',
    fig: { gk: [34, 2], def: [[44, 15], [24, 18]], att: [[30, 30, '8'], [50, 15, '9']], ball: [30, 31.6],
           pass: [[30, 31.6, 50, 13]] } },
  { id: 'P-09', c: 'p', d: 2, ...L11,
    q: 'رقم 10 وصل قريب من المرمى ومرر الكرة لورا لرقم 9. القرار؟', o: OFF, a: 1,
    w: 'لحظة التمرير كان رقم 9 خلف الكرة (أبعد منها عن خط المرمى)، فهو مو في موقف تسلل حتى لو كان متقدمًا على ثاني آخر مدافع.',
    fig: { gk: [34, 2], def: [[32, 16], [46, 18]], att: [[40, 8, '10'], [26, 12, '9']], ball: [40, 9.6],
           pass: [[40, 9.6, 27, 13.4]] } },
  { id: 'P-10', c: 'p', d: 3, ...L11,
    q: 'الحارس طالع من مرماه، والمدافع رجع يغطي على خط المرمى. رقم 7 مرر لرقم 9. القرار؟', o: OFF, a: 0,
    w: 'ما يلزم يكون الحارس هو الأخير. هنا المدافع اللي على خط المرمى هو آخر منافس، والحارس هو ثاني آخر منافس، ورقم 9 أقرب لخط المرمى منه ومن الكرة لحظة التمرير، فهو متسلل.',
    fig: { gk: [34, 24], def: [[38, 1.5], [16, 30]], att: [[54, 30, '7'], [30, 10, '9']], ball: [54, 31.6],
           pass: [[54, 31.6, 31, 11.6]] } },
  { id: 'P-11', c: 'p', d: 2, ...L11,
    q: 'ركنية لُعبت مباشرة لرقم 9، وهو أقرب لخط المرمى من كل المدافعين ما عدا الحارس. القرار؟', o: OFF, a: 1,
    w: 'ما فيه مخالفة تسلل إذا استلم اللاعب الكرة مباشرة من ركلة ركنية (ولا من ركلة مرمى ولا رمية تماس).',
    fig: { gk: [32, 1], def: [[28, 6], [40, 7], [46, 9]], att: [[64.6, -1.9, '7'], [36, 3, '9']], ball: [67.4, 0.6],
           pass: [[67.4, 0.6, 38, 2.9]] } },
  { id: 'P-12', c: 'p', d: 2, ...L11,
    q: 'رمية تماس من جهتك لرقم 9، وهو أقرب لخط المرمى من ثاني آخر مدافع. القرار؟', o: OFF, a: 1,
    w: 'ما فيه مخالفة تسلل إذا استلم اللاعب الكرة مباشرة من رمية تماس.',
    fig: { gk: [34, 2], def: [[30, 10], [40, 12]], att: [[68.6, 20, '7'], [46, 6, '9']], ball: [68.6, 18.6],
           pass: [[67, 18.6, 47.4, 7.4]] } },
  { id: 'P-13', c: 'p', d: 2, ...L11,
    q: 'رقم 8 مرر لرقم 11 في الطرف الثاني. رقم 9 واقف بعيد، ما تحرك ولا أثّر على أي مدافع. القرار؟',
    o: ['أرفع الراية على رقم 9', 'ما أرفع، رقم 9 ما شارك في اللعب'], a: 1,
    w: 'التواجد في موقف التسلل بحد ذاته مو مخالفة. يُعاقب فقط إذا تدخل في اللعب، أو تدخل مع منافس، أو استفاد من موقفه. ورقم 11 لحظة التمرير كان خلف ثاني آخر مدافع.',
    fig: { gk: [34, 2], def: [[16, 16], [30, 17]], att: [[34, 32, '8'], [10, 21, '11'], [56, 9, '9']], ball: [34, 33.6],
           pass: [[34, 33.6, 11.6, 19]] } },
];

const f1 = n => Math.round(n * 100) / 100;
// The drawing. Colours are classes, so the night theme can restyle it from CSS.
export function pitchSVG(fig, reveal){
  const h = fig.h || 36, W = 68;
  const top = -4.5, left = -3, right = W + 7, bottom = h + 2;
  const stripes = [];
  for (let d = 0, i = 0; d < h + 2; d += 5.5, i++) if (i % 2) stripes.push(`<rect class="pst" x="0" y="${d}" width="${W}" height="${Math.min(5.5, h + 2 - d)}"/>`);
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const lines = [
    line(0, 0, W, 0), line(0, 0, 0, h + 2), line(W, 0, W, h + 2),
    `<rect x="24.84" y="0" width="18.32" height="5.5"/>`, `<rect x="13.84" y="0" width="40.32" height="16.5"/>`,
    `<path d="M26.69 16.5 A9.15 9.15 0 0 0 41.31 16.5"/>`, `<path d="M${W - 1} 0 A1 1 0 0 0 ${W} 1"/>`, `<path d="M1 0 A1 1 0 0 1 0 1"/>`,
  ];
  if (h >= 52.5) lines.push(line(0, 52.5, W, 52.5));
  const dot = (cls, a, d, r, label) => `<g class="${cls}"><circle cx="${f1(a)}" cy="${f1(d)}" r="${r}"/>${label ? `<text x="${f1(a)}" y="${f1(d + 0.75)}">${label}</text>` : ''}</g>`;
  const pass = (fig.pass || []).map(([a1, d1, a2, d2]) => `<line class="ppass" x1="${a1}" y1="${d1}" x2="${a2}" y2="${d2}" marker-end="url(#pArrow)"/>`).join('');
  const marks = (fig.marks || []).map(([a, d, t], i) =>
    `<g class="pmark${reveal != null && i === reveal ? ' ok' : ''}"><circle cx="${a}" cy="${d}" r="2.3"/><text x="${a}" y="${f1(d + 0.85)}">${t}</text></g>`).join('');
  return `<svg class="pitch" viewBox="${left} ${top} ${right - left} ${bottom - top}" role="img" aria-label="رسم الملعب: المرمى فوق، وخط التماس اللي تركض عليه يمين">
    <defs><marker id="pArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" class="parrow"/></marker></defs>
    <rect class="pbg" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/>
    <rect class="pfield" x="0" y="0" width="${W}" height="${h + 2}"/>${stripes.join('')}
    <g class="plines">${lines.join('')}</g>
    <rect class="pgoal" x="30.34" y="-2" width="7.32" height="2"/>
    <rect class="parline" x="${W + 0.6}" y="${top}" width="0.5" height="${bottom - top}"/>
    ${pass}
    ${(fig.def || []).map(([a, d]) => dot('pdef', a, d, 1.5)).join('')}
    ${fig.gk ? dot('pgk', fig.gk[0], fig.gk[1], 1.5) : ''}
    ${(fig.att || []).map(([a, d, n]) => dot('patt', a, d, 1.9, n)).join('')}
    ${fig.ball ? `<circle class="pball" cx="${fig.ball[0]}" cy="${fig.ball[1]}" r="0.9"/>` : ''}
    ${marks}
  </svg>
  <div class="pkey"><span><i class="kd"></i>مدافع</span><span><i class="kg"></i>الحارس</span><span><i class="ka"></i>مهاجم</span><span><i class="kb"></i>الكرة</span></div>`;
}
