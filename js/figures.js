// figures.js — the exercise artwork and the rest timer.
//
// Three things live here:
//   1. the inline-SVG rig that draws every exercise (a side-view stick athlete
//      built from joint angles, plus top-down pitch drills),
//   2. the per-exercise metadata the session sheet reads: D (title, art, tip),
//      DOSE, MUS, IMG, REST, AFTER, FLOW, DIAGRAMS,
//   3. the rest-countdown bar at the bottom of the screen.
//
// Nothing here touches app state, so it has no cycle with any other module.
import { num, $ } from './state.js';

/* ---------- diagrams ---------- */
let _sid = 0;
const K = {sprint:{c:'#FF8A3D',d:''}, side:{c:'#8CCBFF',d:'9 6'}, back:{c:'#E0B3FF',d:'1 7'}, walk:{c:'rgba(255,255,255,.9)',d:'5 5',w:2.2}, jump:{c:'#FFD34D',d:''}, move:{c:'var(--pitch)',d:'',w:2.5}, dash:{c:'var(--pitch)',d:'4 5',w:2.2}};
function svg(inner, hgt, mode){
  const id = ++_sid;
  let defs = Object.entries(K).map(([k,s]) => `<marker id="m-${k}-${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" style="fill:${s.c}"/></marker>`).join('');
  defs += `<linearGradient id="cg-${id}" x1="0" x2="1"><stop offset="0" stop-color="#FFA24A"/><stop offset=".55" stop-color="#F26B12"/><stop offset="1" stop-color="#B84A06"/></linearGradient><clipPath id="cl-${id}"><rect width="340" height="${hgt}" rx="10"/></clipPath>`;
  let bg = '';
  if (mode==='field'){ bg = `<rect width="340" height="${hgt}" fill="#3B8A4B"/>`; for (let x=0;x<340;x+=68) bg += `<rect x="${x}" width="34" height="${hgt}" fill="#449659"/>`; }
  else if (mode==='street'){ bg = `<rect width="340" height="${hgt}" fill="#4B524E"/>`; }
  else { bg = `<rect width="340" height="${hgt}" style="fill:var(--surface)"/><rect y="${hgt-18}" width="340" height="18" style="fill:var(--line)"/><line x1="0" x2="340" y1="${hgt-18}" y2="${hgt-18}" style="stroke:var(--muted)" stroke-opacity=".35"/>`; }
  return `<svg class="dg" viewBox="0 0 340 ${hgt}" role="img"><defs>${defs}</defs><g clip-path="url(#cl-${id})">${bg}${inner.replace(/\{ID\}/g,id)}</g></svg>`;
}
const ln = (x1,y1,x2,y2,k,both) => { const s=K[k]; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${s.c}" stroke-width="${s.w||3.5}" stroke-dasharray="${s.d}" stroke-linecap="round" marker-end="url(#m-${k}-{ID})"${both?` marker-start="url(#m-${k}-{ID})"`:''}/>`; };
const cv = (d,k) => { const s=K[k]; return `<path d="${d}" fill="none" style="stroke:${s.c}" stroke-width="${s.w||3}" stroke-dasharray="${s.d}" stroke-linecap="round" marker-end="url(#m-${k}-{ID})"/>`; };
const cone = (x,y) => `<ellipse cx="${x+2}" cy="${y+7}" rx="10" ry="3.5" fill="rgba(0,0,0,.3)"/><path d="M${x-8} ${y+6} Q${x} ${y+9} ${x+8} ${y+6} L${x+2} ${y-11} Q${x} ${y-13} ${x-2} ${y-11} Z" fill="url(#cg-{ID})"/><path d="M${x-4.6} ${y-3} L${x+4.6} ${y-3} L${x+3.4} ${y-6.5} L${x-3.4} ${y-6.5} Z" fill="#fff" opacity=".9"/>`;
const me = (x,y,a=0,flag) => `<g transform="translate(${x} ${y}) rotate(${a})"><ellipse cx="3" cy="4" rx="9" ry="15" fill="rgba(0,0,0,.25)"/>${flag?'<line x1="4" y1="12" x2="14" y2="24" stroke="#222" stroke-width="1.6"/><g transform="translate(14 24) rotate(40)"><rect width="12" height="9" fill="#F5D000"/><rect width="6" height="4.5" fill="#E0301E"/><rect x="6" y="4.5" width="6" height="4.5" fill="#E0301E"/></g>':''}<ellipse cx="4" cy="-11" rx="3.2" ry="2.6" fill="#C8946A"/><ellipse cx="4" cy="11" rx="3.2" ry="2.6" fill="#C8946A"/><rect x="-6" y="-13" width="11" height="26" rx="5.5" fill="#F2C230" stroke="#6b5a14" stroke-width="1"/><rect x="-6" y="-13" width="3.5" height="26" rx="1.7" fill="#000" opacity=".12"/><circle cx="1.5" cy="0" r="5.8" fill="#C8946A"/><circle cx="-0.8" cy="0" r="5.6" fill="#2B1D14"/></g>`;
const tf = (x,y,s,small) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${small?11.5:12.5}" font-weight="${small?400:600}" style="fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.5);stroke-width:3px">${s}</text>`;
const tp = (x,y,s,small) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${small?11:12.5}" style="fill:${small?'var(--muted)':'var(--ink)'}">${s}</text>`;

/* side-view athlete */
const SK='#C8946A', SK2='#A5734C', SHIRT='#F2C230', SHIRT2='#C99E1E', SHORT='#1E2421', SHORT2='#3E4742', SHOE='#111', HAIR='#2B1D14', G=154;
const rad = a => a*Math.PI/180, step = (p,l,a) => [p[0]+l*Math.cos(rad(a)), p[1]+l*Math.sin(rad(a))], lerp = (a,b,t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
function pose(o){
  const hip=[0,0], neck=step(hip,38,o.t), head=step(neck,13,o.t);
  const k1=step(hip,30,o.th1), f1=step(k1,30,o.sh1), k2=step(hip,30,o.th2), f2=step(k2,30,o.sh2);
  const sh=lerp(neck,hip,.1), e1=step(sh,20,o.ua1), h1=step(e1,18,o.fa1), e2=step(sh,20,o.ua2), h2=step(e2,18,o.fa2);
  return {hip,neck,head,k1,f1,k2,f2,sh,e1,h1,e2,h2,t1:step(f1,11,o.ft1??0),t2:step(f2,11,o.ft2??0),t:o.t};
}
function place(P, j, x, y){ const dx=x-P[j][0], dy=y-P[j][1], Q={t:P.t}; for (const k in P) if (Array.isArray(P[k])) Q[k]=[P[k][0]+dx,P[k][1]+dy]; return Q; }
const onGround = (P, j, x) => place(P, j, x, G-3.5);
const sg = (a,b,w,c) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const SOCK='#161A18', SOCK2='#343B37';
const V=(a,b)=>[b[0]-a[0],b[1]-a[1]], nrm=v=>{const l=Math.hypot(v[0],v[1])||1;return [v[0]/l,v[1]/l]}, add=(a,v,s)=>[a[0]+v[0]*s,a[1]+v[1]*s];
const f1d = q => q[0].toFixed(1)+' '+q[1].toFixed(1);
function taper(a,b,r1,r2,c,op){ const d=nrm(V(a,b)), n=[-d[1],d[0]], o=op?` opacity="${op}"`:'';
  return `<g${o}><path d="M${f1d(add(a,n,r1))} L${f1d(add(b,n,r2))} L${f1d(add(b,n,-r2))} L${f1d(add(a,n,-r1))} Z" fill="${c}"/><circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="${r1}" fill="${c}"/><circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="${r2}" fill="${c}"/></g>`; }
function bt(a,b,r1,r2,c){ const d=nrm(V(a,b)); let n=[-d[1],d[0]]; if (n[1]<-.05 || (Math.abs(n[1])<=.05 && n[0]<0)) n=[-n[0],-n[1]];
  return taper(a,b,r1,r2,c)+taper(add(a,n,r1*.5),add(b,n,r2*.5),r1*.5,r2*.5,'#000',.13)+taper(add(a,n,-r1*.5),add(b,n,-r2*.5),r1*.22,r2*.22,'#fff',.16); }
function band(a,b,r1,r2,c){ const d=nrm(V(a,b)), n=[-d[1],d[0]]; return `<path d="M${f1d(add(a,n,r1))} L${f1d(add(b,n,r2))} L${f1d(add(b,n,-r2))} L${f1d(add(a,n,-r1))} Z" fill="${c}"/>`; }
let CUR_HL = [];
const HLC = '#E63946';
function leg(h,k,f,t,far){
  const s=far?SK2:SK, m=lerp(k,f,.33), heel=add(f,V(t,f),.28), dd=nrm(V(heel,t)); let nd=[-dd[1],dd[0]]; if (nd[1]<0) nd=[-nd[0],-nd[1]];
  let o = bt(h,k,7.4,5,s) + bt(k,m,5,5.8,s) + bt(m,f,5.8,3.1,s)
    + bt(lerp(k,f,.14),m,5.3,6.1,far?SOCK2:SOCK) + bt(m,f,6.1,3.6,far?SOCK2:SOCK)
    + band(lerp(k,f,.2),lerp(k,f,.26),5.6,5.8,far?'#5a5a5a':'#DADADA')
    + bt(h,lerp(h,k,.52),9,6.9,far?SHORT2:SHORT)
    + taper(add(heel,nd,2),add(t,nd,2),3.1,2.5,'#F4F4F4') + bt(heel,t,3.9,3.1,SHOE) + sg(lerp(heel,t,.3),lerp(heel,t,.62),1.3,'#E8E8E8');
  const hl = CUR_HL.filter(x => far ? x.endsWith('2') : !x.endsWith('2')).map(x=>x.replace('2',''));
  const dT=nrm(V(h,k)), nT=[-dT[1],dT[0]], dS=nrm(V(k,f)), nS=[-dS[1],dS[0]];
  if (hl.includes('quad')) o += taper(add(lerp(h,k,.2),nT,-2.6),add(lerp(h,k,.85),nT,-1.8),3.6,2.4,HLC,.8);
  if (hl.includes('ham')) o += taper(add(lerp(h,k,.2),nT,2.6),add(lerp(h,k,.85),nT,1.8),3.6,2.4,HLC,.8);
  if (hl.includes('calf')) o += taper(add(lerp(k,f,.12),nS,2.4),add(lerp(k,f,.6),nS,1.4),3.4,2.2,HLC,.85);
  return o;
}
function arm(s,e,hd,far){ const c=far?SK2:SK; return bt(s,e,4.6,3.6,c)+bt(s,lerp(s,e,.5),5.6,4.7,far?SHIRT2:SHIRT)+band(lerp(s,e,.42),lerp(s,e,.52),5.1,4.8,'#1E2421')+bt(e,hd,3.5,2.6,c)+`<circle cx="${hd[0].toFixed(1)}" cy="${hd[1].toFixed(1)}" r="3.5" fill="${c}"/>`; }
function fig(P){
  const u=nrm(V(P.hip,P.neck)), fr=[-u[1],u[0]], L=t=>lerp(P.hip,P.neck,t);
  const chest=add(L(.7),fr,1.8), waist=add(L(.36),fr,-.4), top=L(.95);
  let torso = bt(P.hip,waist,9.6,8.6,SHIRT)+bt(waist,chest,8.6,10.6,SHIRT)+bt(chest,top,10.6,7,SHIRT)
    + sg(add(L(.2),fr,-8.2),add(L(.85),fr,-9.6),1.8,SHIRT2)
    + bt(P.hip,L(.2),9.8,9.3,SHORT)
    + `<circle cx="${add(L(.72),fr,6.5)[0].toFixed(1)}" cy="${add(L(.72),fr,6.5)[1].toFixed(1)}" r="2.3" fill="#1E2421"/>`;
  if (CUR_HL.includes('glute')) torso += `<circle cx="${add(P.hip,fr,-5.5)[0].toFixed(1)}" cy="${add(P.hip,fr,-5.5)[1].toFixed(1)}" r="5.5" fill="${HLC}" opacity=".8"/>`;
  if (CUR_HL.includes('core')) torso += taper(add(L(.25),fr,1),add(L(.62),fr,1.5),5.5,5.5,HLC,.7);
  const hc=add(P.head,u,1.5), face=add(hc,fr,.9), hair=add(add(hc,fr,-2),u,1.4), nose=add(add(hc,fr,8.6),u,-1.2), eye=add(add(hc,fr,4.6),u,1.8), ear=add(hc,fr,-1.2);
  const head = taper(P.neck,hc,3.9,3.9,SK) + taper(top,P.neck,5.2,4.3,'#1E2421')
    + `<circle cx="${hair[0].toFixed(1)}" cy="${hair[1].toFixed(1)}" r="8.9" fill="${HAIR}"/><circle cx="${face[0].toFixed(1)}" cy="${face[1].toFixed(1)}" r="8.1" fill="${SK}"/>`
    + `<path d="M${f1d(add(nose,u,2.4))} L${f1d(add(nose,fr,1.8))} L${f1d(add(nose,u,-1.6))} Z" fill="${SK}"/>`
    + `<circle cx="${ear[0].toFixed(1)}" cy="${ear[1].toFixed(1)}" r="2.2" fill="${SK2}"/><circle cx="${eye[0].toFixed(1)}" cy="${eye[1].toFixed(1)}" r="1" fill="#1b1b1b"/>` + sg(add(eye,u,1.9),add(add(eye,u,2.1),fr,2.4),1.1,HAIR) + `<circle cx="${add(add(hc,fr,2.5),u,-4.2)[0].toFixed(1)}" cy="${add(add(hc,fr,2.5),u,-4.2)[1].toFixed(1)}" r="4.2" fill="${HAIR}" opacity=".22"/>`;
  const shadow = `<ellipse cx="${((P.f1[0]+P.f2[0])/2).toFixed(1)}" cy="${G+1}" rx="24" ry="3.2" fill="rgba(0,0,0,.13)"/>`;
  return shadow+arm(P.sh,P.e2,P.h2,1)+leg(P.hip,P.k2,P.f2,P.t2,1)+torso+leg(P.hip,P.k1,P.f1,P.t1,0)+head+arm(P.sh,P.e1,P.h1,0);
}
const STAND = {t:-90,th1:89,sh1:91,th2:92,sh2:90,ua1:95,fa1:85,ua2:88,fa2:92};
const two = (right, left, extra='', hgt=172, lr='البداية', ll='النهاية', dir=-1) => svg(extra+fig(right)+fig(left)+(dir<0?ln(190,26,150,26,'move'):ln(150,26,190,26,'move'))+tp(255,hgt-4,lr,true)+tp(85,hgt-4,ll,true), hgt);
const chair = (x,y) => `<g style="fill:#8A6A52"><rect x="${x-26}" y="${y+5}" width="44" height="3" fill="#5E4634"/><rect x="${x-26}" y="${y}" width="44" height="6" rx="2"/><rect x="${x-24}" y="${y}" width="4" height="${G-y}"/><rect x="${x+12}" y="${y}" width="4" height="${G-y}"/><rect x="${x-26}" y="${y-38}" width="5" height="40" rx="2"/></g>`;
const wallR = x => `<rect x="${x}" y="0" width="${340-x}" height="${G}" style="fill:var(--line)"/><rect x="${x}" y="0" width="6" height="${G}" fill="#000" opacity=".06"/>`+Array.from({length:6},(_,i)=>`<line x1="${x}" x2="340" y1="${i*26+13}" y2="${i*26+13}" style="stroke:var(--muted)" stroke-opacity=".15"/>`).join('')+`<line x1="${x}" x2="${x}" y1="0" y2="${G}" style="stroke:var(--muted)" stroke-opacity=".5"/>`;

const FIG = {
  squat(){ const A=onGround(pose({...STAND,ua1:-5,fa1:0,ua2:2,fa2:-3}),'f1',250), B=onGround(pose({t:-55,th1:8,sh1:112,th2:12,sh2:110,ua1:-8,fa1:-5,ua2:-4,fa2:-2}),'f1',95); return two(A,B); },
  lunge(){ const A=onGround(pose({...STAND,ua1:100,fa1:70,ua2:95,fa2:75}),'f1',260), B=onGround(pose({t:-88,th1:5,sh1:90,th2:125,sh2:170,ft2:45,ua1:100,fa1:70,ua2:95,fa2:75}),'f1',110); return two(A,B); },
  bulgarian(){ const a=pose({t:-85,th1:75,sh1:95,th2:130.4,sh2:157.6,ft2:180,ua1:100,fa1:75,ua2:95,fa2:80}), b=pose({t:-80,th1:10,sh1:105,th2:105,sh2:-140,ft2:180,ua1:100,fa1:75,ua2:95,fa2:80});
    const A=onGround(a,'f1',290), B=onGround(b,'f1',125);
    return two(A,B,chair(A.f2[0]-4,A.f2[1]+4.5)+chair(B.f2[0]-4,B.f2[1]+4.5)); },
  calf(){ const stepTop=G-16, stepBox=x=>`<rect x="${x-34}" y="${stepTop}" width="40" height="16" rx="2" fill="#9C9C94"/><rect x="${x-34}" y="${stepTop}" width="40" height="3" fill="#B8B8AF"/>`;
    const a=pose({...STAND,th2:95,sh2:165,ft1:-18,ua1:-25,fa1:-15,ua2:-20,fa2:-10}), b=pose({...STAND,th2:95,sh2:165,ft1:55,ua1:-30,fa1:-20,ua2:-25,fa2:-15});
    const A=place(a,'t1',262,stepTop-3.5), B=place(b,'t1',112,stepTop-3.5);
    return two(A,B,stepBox(264)+stepBox(114)+`<rect x="${A.h1[0]+4}" y="10" width="6" height="${G-10}" style="fill:var(--muted)" opacity=".5"/><rect x="${B.h1[0]+4}" y="10" width="6" height="${G-10}" style="fill:var(--muted)" opacity=".5"/>`); },
  bridge(){ const A=onGround(pose({t:180,th1:-45,sh1:70,th2:-20,sh2:-20,ua1:6,fa1:2,ua2:4,fa2:0}),'f1',300), B=onGround(pose({t:162,th1:-12,sh1:98,th2:-12,sh2:-12,ua1:14,fa1:2,ua2:12,fa2:0}),'f1',140);
    return two(A,B); },
  nordic(){ const couch = x => `<rect x="${x-62}" y="${G-44}" width="72" height="30" rx="8" fill="#6F5B4E"/><rect x="${x-58}" y="${G-14}" width="5" height="14" fill="#4A3C33"/><rect x="${x+2}" y="${G-14}" width="5" height="14" fill="#4A3C33"/>`;
    const A=place(pose({t:-90,th1:90,sh1:180,th2:92,sh2:178,ft1:100,ft2:100,ua1:65,fa1:-70,ua2:60,fa2:-60}),'k1',275,G-6), B=place(pose({t:-38,th1:142,sh1:180,th2:140,sh2:178,ft1:100,ft2:100,ua1:55,fa1:25,ua2:50,fa2:20}),'k1',80,G-6);
    return two(A,B,couch(A.f1[0])+couch(B.f1[0])); },
  sidePlank(){ const P=onGround(pose({t:-148,th1:17,sh1:17,th2:16,sh2:16,ua1:90,fa1:-5,ua2:40,fa2:150,ft1:-80,ft2:-80}),'f1',250);
    return svg(fig(P)+tp(95,40,'ثبّت ٣٠ ثانية')+tp(95,60,'جسمك خط مستقيم، لا تنزل الحوض',true),172); },
  runForm(){ const P=onGround(pose({t:-78,th1:35,sh1:110,th2:115,sh2:160,ft1:10,ft2:130,ua1:120,fa1:30,ua2:55,fa2:-40}),'f1',235);
    return svg(fig(P)+`<path d="M22 20 h120 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-50 l-14 14 l2 -14 h-58 a10 10 0 0 1 -10 -10 v-26 a10 10 0 0 1 10 -10z" style="fill:var(--pitch-soft);stroke:var(--pitch)" stroke-width="1.5"/>`+tp(82,40,'أقدر أسولف')+tp(82,57,'وأنا أركض',false),172); },
  zones(){ const cols=['#9BB5A5','#3FA36B','#E7B52C','#E5782B','#C8372D'], lbl=['٥٠٪','٦٠–٧٠٪','٧٠–٨٠٪','٨٠–٩٠٪','٩٠٪+'], nm=['مشي','مريح','متوسط','صعب','سبرنت'];
    let s=''; for (let i=0;i<5;i++){ const x=276-i*62; s+=`<rect x="${x}" y="${i===1?34:44}" width="56" height="${i===1?58:40}" rx="7" fill="${cols[i]}" ${i===1?'stroke="var(--ink)" stroke-width="2.5"':''} opacity="${i===1?1:.55}"/>`+tp(x+28,112,lbl[i],true)+tp(x+28,130,nm[i],i!==1); }
    return svg(s+tp(214+28,24,'أنت هنا',false)+ln(242,27,242,33,'move'),150); },
  walk(){ const P=onGround(pose({t:-88,th1:68,sh1:95,th2:112,sh2:100,ft2:15,ua1:108,fa1:95,ua2:72,fa2:65}),'f1',180);
    return svg(fig(P)+ln(235,60,290,60,'dash')+tp(80,80,'مشي هادي')+tp(80,100,'٢٠–٣٠ دقيقة',true),172); },
  calfStretch(){ const P0=pose({t:-55,th1:45,sh1:95,th2:125,sh2:125,ua1:-25,fa1:-20,ua2:-20,fa2:-15}), P=onGround(P0,'f1',215);
    return svg(wallR(Math.max(P.h1[0],P.h2[0])+5)+fig(P)+tp(85,50,'الرجل الخلفية مستقيمة')+tp(85,70,'والكعب على الأرض',true)+tp(85,90,'٣٠ ثانية لكل رجل',true),172); },
  quadStretch(){ const P=onGround(pose({...STAND,th2:110,sh2:-110,ft2:-100,ua2:120,fa2:118,ua1:-8,fa1:-8}),'f1',200);
    return svg(wallR(P.h1[0]+5)+fig(P)+tp(90,50,'اسحب الكعب للخلف')+tp(90,70,'ركبتك تتجه للأرض',true)+tp(90,90,'٣٠ ثانية لكل رجل',true),172); },
  jog(){ const P=onGround(pose({t:-82,th1:55,sh1:105,th2:105,sh2:140,ft2:100,ua1:115,fa1:35,ua2:65,fa2:-25}),'f1',220);
    return svg(fig(P)+tp(85,60,'ركض هادي')+tp(85,80,'بجهد ٥٠٪',true),172); },
  legSwing(){ const a=pose({...STAND,th1:25,sh1:28,ft1:-10,ua1:-5,fa1:-5,ua2:-3,fa2:-3}), b=pose({...STAND,th1:135,sh1:150,ft1:170,ua1:-5,fa1:-5,ua2:-3,fa2:-3});
    const A=onGround(a,'f2',255), B=onGround(b,'f2',90);
    return two(A,B,'',172,'قدّام','ورا',-1); },
  highKnees(){ const P=onGround(pose({t:-85,th1:-8,sh1:88,th2:88,sh2:92,ft2:40,ua1:125,fa1:40,ua2:45,fa2:-50}),'t2',220);
    return svg(fig(P)+tp(85,50,'الركبة لمستوى الحوض')+tp(85,70,'٢ × ٢٠ ثانية',true),172); },
  pogo(){ const a=pose({...STAND,th1:86,sh1:94,th2:88,sh2:93,ft1:55,ft2:55,ua1:100,fa1:75,ua2:95,fa2:80});
    const A=place(a,'t1',260,G-3.5), B=place(a,'t1',100,G-13);
    return two(A,B,ln(135,G-4,135,G-16,'dash'),172,'ملامسة','بالهواء',-1); },
  broadJump(){ const A=onGround(pose({t:-40,th1:15,sh1:115,th2:18,sh2:112,ua1:150,fa1:155,ua2:145,fa2:150}),'f1',70), B=onGround(pose({t:-55,th1:10,sh1:112,th2:12,sh2:110,ua1:-12,fa1:-8,ua2:-8,fa2:-5}),'f1',270);
    return svg(fig(A)+fig(B)+cv(`M${A.hip[0]+10} ${A.hip[1]-35} Q170 -20 ${B.hip[0]-20} ${B.hip[1]-40}`,'dash')+tp(80,G+14,'انطلاق',true)+tp(260,G+14,'هبوط',true),172); },
  lateralHop(){ let s=`<line x1="170" y1="0" x2="170" y2="130" stroke="#fff" stroke-width="4" opacity=".9"/>`;
    const fp=(x,y)=>`<ellipse cx="${x-5}" cy="${y}" rx="4" ry="7" fill="#1b1b1b" opacity=".55"/><ellipse cx="${x+5}" cy="${y}" rx="4" ry="7" fill="#1b1b1b" opacity=".55"/>`;
    [[135,108],[205,84],[135,60],[205,36]].forEach(([x,y])=>s+=fp(x,y));
    s+=cv('M145 100 Q170 82 195 90','jump')+cv('M195 76 Q170 58 145 66','jump')+cv('M145 52 Q170 34 195 42','jump');
    return svg(s+tf(270,70,'الخط',true)+tf(65,70,'ارجع فورًا',true),130,'field'); }
};
const LEGEND = svg([['sprint','سرعة'],['side','جانبي'],['back','للخلف'],['walk','مشي']].map(([k,l],i)=>{const c=255-i*85;return ln(c+22,15,c+62,15,k)+tf(c+42,38,l,true);}).join(''), 46, 'field');
const D = {
  sprint: ['سرعات قصيرة', ()=>svg(cone(40,50)+cone(300,50)+me(40,78,0)+ln(55,50,285,50,'sprint')+tf(170,36,'٢٠ م بجهد ٩٠٪')+ln(290,95,55,95,'walk')+tf(170,117,'رجوع مشي ٣٠ ثانية',true),128,'field'), 'انطلق من ثبات، وخلّ أول ٣ خطوات قوية وقصيرة.'],
  sideSprint: ['جانبي ثم انطلاق', ()=>`${svg(`<line x1="20" y1="0" x2="20" y2="160" stroke="#fff" stroke-width="3" opacity=".85"/>`+cone(60,130)+cone(60,38)+cone(300,38)+me(40,126,0,1)+ln(60,117,60,54,'side')+tf(110,90,'٨ م جانبي')+ln(76,38,285,38,'sprint')+tf(180,24,'٢٠ م سرعة')+tf(210,112,'وجهك للملعب مثل متابعة التسلل',true),155,'field')}`, 'لا تقاطع رجولك بالجانبي، خطوات قصيرة وسريعة.'],
  backSprint: ['للخلف ثم انطلاق', ()=>svg(cone(135,72)+cone(265,72)+me(200,72,0)+ln(195,44,145,44,'back')+tf(168,30,'٥ م للخلف')+ln(140,100,255,100,'sprint')+tf(200,124,'١٠ م سرعة'),135,'field'), 'ارجع للخلف وأنت شايف قدامك، وعند العلامة انطلق فورًا.'],
  coda: ['تغيير الاتجاه', ()=>svg(cone(30,128)+cone(170,128)+cone(170,35)+cone(310,128)+me(30,102,0)+ln(42,128,155,128,'sprint')+ln(160,115,160,50,'side')+ln(180,50,180,115,'side')+ln(185,128,298,128,'sprint')+tf(98,151,'بداية: ١٠ م سرعة')+tf(115,85,'٨ م جانبي')+tf(235,85,'٨ م جانبي رجوع')+tf(242,151,'نهاية: ١٠ م سرعة'),160,'field'), 'بالجانبي ظهرك يبقى بنفس الاتجاه، لا تلف جسمك.'],
  ariet: ['تحمّل الحكم المساعد', ()=>svg(`<line x1="0" y1="18" x2="340" y2="18" stroke="#fff" stroke-width="3" opacity=".85"/>`+cone(30,55)+cone(240,55)+cone(310,55)+me(30,82,0,1)+ln(42,55,226,55,'sprint')+tf(135,40,'٧٥ م بجهد ٨٠–٨٥٪')+ln(252,55,298,55,'walk')+tf(275,84,'٢٥ م مشي',true)+tf(170,112,'وارجع بنفس الطريقة، وهذي عدة وحدة',true),122,'field'), 'مثل ركضك على خط التماس. المشي جزء من التمرين، لا توقف.'],
  reaction: ['رد الفعل', ()=>svg(me(170,92,-90)+cone(170,24)+cone(170,160)+cone(55,92)+cone(285,92)+ln(170,76,170,40,'sprint')+ln(170,108,170,146,'sprint')+ln(154,92,72,92,'sprint')+ln(186,92,268,92,'sprint')+tf(112,80,'٥ م',true)+tf(228,80,'٥ م',true)+tf(170,188,'عند الإشارة انطلق لأي علامة وارجع للوسط',true),196,'field'), 'خلّ أحد يأشر لك الاتجاه، أو استخدم منبّه عشوائي.'],
  lateralHop: ['قفز جانبي فوق خط', FIG.lateralHop, 'هبوط خفيف على أطراف الأصابع، الآثار توضح مكان رجولك.'],
  broadJump: ['قفزة طويلة من ثبات', FIG.broadJump, 'اسحب يدينك للخلف قبل القفزة، وارتاح ٣٠ ثانية بين كل قفزة.'],
  pogo: ['ارتدادات الكاحل', FIG.pogo, 'الحركة من الكاحل، الركبة شبه ثابتة. وقّف إذا حسيت ألم بالوتر.'],
  squat: ['سكوات', FIG.squat, 'ظهرك مستقيم، والكعب ما يرتفع عن الأرض. انزل لين الفخذ يوازي الأرض.'],
  lunge: ['طعنات للخلف', FIG.lunge, 'ارجع برجل وحدة، والركبة الخلفية تقرّب من الأرض بدون ما تلمسها.'],
  bulgarian: ['سكوات برجل وحدة على كرسي', FIG.bulgarian, 'الرجل الخلفية على الكرسي، والشغل كله على الرجل الأمامية.'],
  calf: ['رفع السمانة على الدرج', FIG.calf, 'نزّل الكعب تحت مستوى الدرجة، ثم اطلع لأعلى نقطة ببطء.'],
  bridge: ['رفع الحوض برجل وحدة', FIG.bridge, 'ادفع من الكعب، والحوض يطلع لين يصير جسمك خط من الكتف للركبة.'],
  nordic: ['العضلة الخلفية (نورديك)', FIG.nordic, 'رجولك مثبتة تحت الكنب. انزل ببطء قد ما تقدر، واستقبل نفسك بيدينك.'],
  sidePlank: ['بلانك جانبي', FIG.sidePlank, 'الكوع تحت الكتف مباشرة.'],
  runForm: ['وضعية الركض', FIG.runForm, 'إذا ما تقدر تكمل جملة وأنت تركض، خفّف السرعة.'],
  zones: ['مناطق الجهد', FIG.zones, 'ركض الأحد في المنطقة الثانية بالساعة.'],
  walk: ['مشي', FIG.walk, 'مشي مريح يحرّك الدم ويسرّع الاستشفاء.'],
  calfStretch: ['إطالة السمانة', FIG.calfStretch, 'بدون ارتداد، ثبات فقط.'],
  quadStretch: ['إطالة الفخذ الأمامية', FIG.quadStretch, 'استند على الجدار عشان توازنك.'],
  jog: ['ركض هادي', FIG.jog, '١٠ دقايق قبل الحركات.'],
  legSwing: ['مرجحة الرجل', FIG.legSwing, 'قدّام وورا ١٠ مرات لكل رجل، والحركة تكبر تدريجيًا.'],
  highKnees: ['رفع الركب', FIG.highKnees, 'خطوات سريعة وخفيفة في مكانك.'],
  cooper: ['اختبار ١٢ دقيقة', ()=>svg(`<rect x="40" y="25" width="260" height="100" rx="50" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="10 8" opacity=".8"/>`+me(170,25,180)+ln(150,25,110,25,'sprint')+`<circle cx="170" cy="75" r="26" fill="#1b1b1b" stroke="#ddd" stroke-width="3"/><rect x="163" y="44" width="14" height="6" fill="#333"/><rect x="163" y="100" width="14" height="6" fill="#333"/>`+`<text x="170" y="80" text-anchor="middle" font-size="14" font-weight="700" fill="#7CFFB2">١٢:٠٠</text>`+tf(170,146,'لفّات على مسار ثابت، وسجّل المسافة من الساعة',true),155,'street'), 'نفس المسار كل مرة عشان المقارنة تكون عادلة.']
};
const rounds = n => n===1?'جولة وحدة':n===2?'جولتين':`${num(n)} جولات`, sets = n => n===2?'مجموعتين':`${num(n)} مجموعات`;
const DOSE = {
  squat:p=>`١٥ عدة، ${rounds(p.str)}`, lunge:p=>`١٠ لكل رجل، ${rounds(p.str)}`, bulgarian:p=>`٨ لكل رجل، ${rounds(p.str)}`,
  calf:p=>`١٥ لكل رجل، ${rounds(p.str)}`, bridge:p=>`١٢ لكل رجل، ${rounds(p.str)}`, nordic:p=>`٥ عدات، ${rounds(p.str)}`,
  sidePlank:p=>`٣٠ ثانية لكل جهة، ${rounds(p.str)}`,
  sprint:p=>`${num(p.sp)} مرات، راحة ٣٠ ثانية`, sideSprint:p=>`${num(p.sp)} مرات`, backSprint:p=>`${num(p.sp)} مرات`, coda:p=>`${num(p.light?2:4)} مرات`,
  pogo:p=>`${sets(p.light?2:3)} × ٢٠ قفزة`, lateralHop:p=>`${sets(p.light?2:3)} × ١٠ لكل جهة`, broadJump:p=>`${sets(p.light?2:3)} × ٥ قفزات`,
  reaction:()=>'٨ انطلاقات', ariet:p=>`${num(p.ar)} مرات`,
  runForm:p=>`${num(p.run)} دقيقة متواصلة`, zones:()=>'المنطقة الثانية', walk:()=>'٢٠–٣٠ دقيقة',
  calfStretch:()=>'٣٠ ثانية × ٢ لكل رجل', quadStretch:()=>'٣٠ ثانية × ٢ لكل رجل',
  jog:()=>'١٠ دقايق', legSwing:()=>'١٠ لكل رجل', highKnees:()=>'مجموعتين × ٢٠ ثانية', cooper:()=>'١٢ دقيقة'
};
const MUS = {
  squat:[['quad','glute'],'الفخذ الأمامية والمؤخرة'], lunge:[['quad','glute'],'الفخذ الأمامية والمؤخرة'], bulgarian:[['quad','glute'],'الفخذ الأمامية والمؤخرة'],
  calf:[['calf'],'السمانة'], bridge:[['glute','ham'],'المؤخرة والعضلة الخلفية'], nordic:[['ham'],'العضلة الخلفية للفخذ'], sidePlank:[['core'],'الجنب والبطن'],
  pogo:[['calf'],'السمانة والكاحل'], broadJump:[['quad','glute','calf'],'الرجلين كاملة'], calfStretch:[['calf2'],'سمانة الرجل الخلفية'],
  quadStretch:[['quad2'],'الفخذ الأمامية'], legSwing:[['ham'],'مرونة الورك'], highKnees:[['quad'],'الورك والفخذ']
};
const IMG = {"walk":{"photo":"img-walk-photo.webp","flat":"img-walk-flat.webp"},"cooper":{"photo":"img-cooper-photo.webp","flat":"img-cooper-flat.webp"},"squat":{"photo":"img-squat-photo.webp","flat":"img-squat-flat.webp"},"coda":{"photo":"img-coda-photo.webp","flat":"img-coda-flat.webp"},"lateralHop":{"photo":"img-lateralHop-photo.webp","flat":"img-lateralHop-flat.webp"},"sidePlank":{"photo":"img-sidePlank-photo.webp","flat":"img-sidePlank-flat.webp"},"broadJump":{"photo":"img-broadJump-photo.webp","flat":"img-broadJump-flat.webp"},"lunge":{"photo":"img-lunge-photo.webp","flat":"img-lunge-flat.webp"},"calfStretch":{"photo":"img-calfStretch-photo.webp","flat":"img-calfStretch-flat.webp"},"highKnees":{"photo":"img-highKnees-photo.webp","flat":"img-highKnees-flat.webp"},"calf":{"photo":"img-calf-photo.webp","flat":"img-calf-flat.webp"},"ariet":{"photo":"img-ariet-photo.webp","flat":"img-ariet-flat.webp"},"reaction":{"photo":"img-reaction-photo.webp","flat":"img-reaction-flat.webp"},"backSprint":{"photo":"img-backSprint-photo.webp"},"sprint":{"photo":"img-sprint-photo.webp","flat":"img-sprint-flat.webp"},"sideSprint":{"photo":"img-sideSprint-photo.webp","flat":"img-sideSprint-flat.webp"},"bridge":{"photo":"img-bridge-photo.webp","flat":"img-bridge-flat.webp"},"jog":{"photo":"img-jog-photo.webp","flat":"img-jog-flat.webp"},"quadStretch":{"photo":"img-quadStretch-photo.webp","flat":"img-quadStretch-flat.webp"},"pogo":{"photo":"img-pogo-photo.webp","flat":"img-pogo-flat.webp"},"bulgarian":{"photo":"img-bulgarian-photo.webp","flat":"img-bulgarian-flat.webp"},"nordic":{"photo":"img-nordic-photo.webp","flat":"img-nordic-flat.webp"},"legSwing":{"photo":"img-legSwing-photo.webp","flat":"img-legSwing-flat.webp"},"runForm":{"photo":"img-runForm-photo.webp","flat":"img-runForm-flat.webp"}};
let VIEW = (()=>{ try { return localStorage.getItem('dg-view')||'photo'; } catch(e){ return 'photo'; } })();
const REST = {
  sprint:[['بين كل عدة',30,'مشي رجوع']], sideSprint:[['بين كل عدة',30]], backSprint:[['بين كل عدة',30]], coda:[['بين كل مرة',45]],
  pogo:[['بين المجموعات',60]], lateralHop:[['بين المجموعات',60]], broadJump:[['بين كل قفزة',30]], reaction:[['بين كل انطلاقة',20]],
  ariet:[['المشي ٢٥ م هو راحتك',0]], sidePlank:[['بين الجهتين',10]],
  calfStretch:[['بين الرجلين',10]], quadStretch:[['بين الرجلين',10]], highKnees:[['بين المجموعات',30]], legSwing:[['بين الرجلين',10]]
};
// rest after each exercise before the next one (index-aligned with DIAGRAMS[type])
const AFTER = {intervals:[120,120,180], yoyo:[90,90,120,180], strength:[15,15,15,15,15,15,60], light:[30,30], rest:[0,10], recovery:[0,10]};
const WARM_REST = {intervals:60, yoyo:60, strength:30, test:60};
const FLOW = {
  intervals:{warm:'إحماء ١٠ د: ركض خفيف وخطوات جانبية', cool:'تبريد ٥ د: مشي وإطالات', note:'الراحة الأطول قبل تغيير الاتجاه لأنه أصعب تمرين'},
  yoyo:{warm:'إحماء ١٠ د: ركض خفيف وحركات كاحل', cool:'تبريد ٥ د: مشي وإطالات', note:'تمارين القفز أول والجسم نشيط، والتحمّل آخر شي'},
  strength:{warm:'إحماء ٥ د: مشي سريع وحركات دائرية', cool:'تبريد ٥ د: إطالات للرجلين', note:'التمارين دائرة: تسويهم ورا بعض، وبعد آخر تمرين دقيقة راحة ثم الجولة الثانية'},
  run:{warm:'أول ٥ د أبطأ', cool:'آخر ٥ د مشي', note:'ركض متواصل بدون توقف'},
  light:{warm:'', cool:'', note:'كل شي خفيف ومتواصل'},
  rest:{warm:'',cool:'',note:''}, recovery:{warm:'',cool:'',note:''}, test:{warm:'إحماء ١٠ د',cool:'تبريد ٥ د مشي',note:''}
};
const fmtS = s => { if(s<60) return `${num(s)} ثانية`; const m=Math.floor(s/60), r=s%60; const base = m===1?'دقيقة':m===2?'دقيقتين':`${num(m)} دقايق`; return r===30 ? base+' ونص' : r ? `${base} و${num(r)} ثانية` : base; };
/* rest timer */
let tmr=null;
function startTimer(sec,label){
  stopTimer(); let left=sec; const bar=$('timer'); bar.hidden=false;
  const draw=()=>{ bar.querySelector('.tl').textContent=label; bar.querySelector('.tv').textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`; bar.style.setProperty('--p',(1-left/sec)*100+'%'); };
  draw();
  tmr=setInterval(()=>{ left--; if(left<=0){ stopTimer(true); } else { if(left<=3) beep(600,.08); draw(); } },1000);
}
function stopTimer(done){ if(tmr){clearInterval(tmr); tmr=null;} const bar=$('timer'); if(done){ beep(880,.35); try{navigator.vibrate&&navigator.vibrate([200,100,200]);}catch(e){} bar.querySelector('.tl').textContent='خلصت الراحة، يلا 💪'; bar.querySelector('.tv').textContent='٠:٠٠'; setTimeout(()=>{ if(!tmr) bar.hidden=true; },2500); } else bar.hidden=true; }
let actx=null;
function beep(f,d){ try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); const o=actx.createOscillator(), g=actx.createGain(); o.frequency.value=f; o.connect(g); g.connect(actx.destination); g.gain.value=.15; o.start(); o.stop(actx.currentTime+d);}catch(e){} }
function restHTML(k){ const r=REST[k]; if(!r) return ''; return `<div class="rests">${r.map(([l,s,extra])=>s?`<button class="rbtn" data-s="${s}" data-l="${l}">⏱ ${l}: ${fmtS(s)}${extra?' '+extra:''}</button>`:`<span class="rbtn off">⏸ ${l}</span>`).join('')}</div>`; }
function flowHTML(type, keys){
  const f=FLOW[type]; if(!f || (!f.warm && !f.note && !AFTER[type])) return '';
  const ex=keys.filter(k=>D[k] && k!=='zones'); let n=0, out='';
  const step=t=>`<div class="fstep"><span class="n">${num(++n)}</span><span>${t}</span></div>`;
  const rest=(s,t)=>`<div class="frest">${s?`⏸ ارتاح ${fmtS(s)}`:'↓ انتقل مباشرة'}${t?` ${t}`:''}</div>`;
  if (f.warm){ out+=step(f.warm); if (WARM_REST[type]) out+=rest(WARM_REST[type]); }
  ex.forEach((k,i)=>{ out+=step(D[k][0]); const a=(AFTER[type]||[])[i];
    if (i<ex.length-1 && a!=null) out+=rest(a);
    else if (i===ex.length-1 && type==='strength') out+=`<div class="frest">🔁 ارتاح دقيقة، وارجع لـ«${D[ex[0]][0]}» للجولة الثانية</div>`; });
  if (f.cool){ if (type!=='strength' && ex.length && AFTER[type]) out+=rest(60); out+=step(f.cool); }
  return `<div class="flow"><h4>ترتيب الحصة</h4>${out}${f.note?`<p class="note">${f.note}</p>`:''}</div>`;
}
function nextHTML(type, keys, i){
  const ex=keys.filter(k=>D[k] && k!=='zones'), idx=ex.indexOf(keys[i]); if (idx<0 || !AFTER[type]) return '';
  if (idx===ex.length-1){
    return type==='strength'
      ? `<div class="next"><span>🔁 لما تخلص: ارتاح دقيقة، وارجع لـ«${D[ex[0]][0]}» للجولة اللي بعدها. بعد آخر جولة كمّل بالتبريد.</span><button class="rbtn" data-s="60" data-l="قبل الجولة الجاية">⏱ دقيقة</button></div>`
      : `<div class="next done"><span>🏁 هذا آخر تمرين. لما تخلص ارتاح دقيقة وبعدها التبريد 👏</span></div>`;
  }
  const s=AFTER[type][idx], nx=D[ex[idx+1]][0];
  return s ? `<div class="next"><span>✋ لما تخلص: ارتاح <b>${fmtS(s)}</b>، وبعدها ابدأ «${nx}»</span><button class="rbtn" data-s="${s}" data-l="قبل ${nx}">⏱ ابدأ الراحة</button></div>`
           : `<div class="next"><span>↓ لما تخلص: انتقل مباشرة لـ«${nx}»</span></div>`;
}
const DIAGRAMS = {intervals:['sprint','sideSprint','backSprint','coda'], yoyo:['pogo','lateralHop','broadJump','reaction','ariet'],
  strength:['squat','lunge','bulgarian','calf','bridge','nordic','sidePlank'], run:['runForm','zones'], rest:['walk','calfStretch','quadStretch'],
  recovery:['walk','calfStretch','quadStretch'], light:['jog','legSwing','highKnees'], test:['cooper']};
const LEGEND_FOR = new Set(['intervals','yoyo']);

/* ---------- exercise media ---------- */
// Every exercise image is exported at the same size, so the card can reserve its
// space before the file arrives and nothing shifts while it loads.
export const IMG_W = 640, IMG_H = 482;

// Which illustration styles actually exist for an exercise. backSprint has no
// flat drawing, so its switcher offers صورة and مخطط only instead of showing a
// broken image.
export function stylesFor(k){ return IMG[k] ? ['photo','flat'].filter(v => IMG[k][v]) : []; }

// Every file for one style, for the service worker to precache.
export function stylePaths(style){
  return Object.keys(IMG).map(k => IMG[k][style]).filter(Boolean);
}

export function srcFor(k, view){ return (IMG[k] && IMG[k][view]) || ''; }

// The style the card should open on: the chosen one when this exercise has it,
// otherwise whatever it does have.
export function viewFor(k){
  const avail = stylesFor(k);
  if (!avail.length) return 'diagram';
  if (VIEW === 'diagram') return 'diagram';
  return avail.includes(VIEW) ? VIEW : avail[0];
}

// ONE <img> per card, carrying only the selected style. The other style is never
// requested until the switcher asks for it, so opening a session downloads half
// of what it used to — and switching styles costs one file per visible card
// rather than a second full set up front.
export function mediaHTML(k, art){
  const avail = stylesFor(k);
  if (!avail.length) return art;
  const sel = viewFor(k), src = sel === 'diagram' ? '' : IMG[k][sel];
  const opts = [...avail.map(v => [v, v === 'photo' ? 'صورة' : 'رسم']), ['diagram','مخطط']];
  const label = D[k] ? D[k][0] : '';
  return `<div class="vsw" data-k="${k}">${opts.map(([id,l])=>`<button data-v="${id}" aria-pressed="${sel===id}">${l}</button>`).join('')}</div>`
    + `<div class="vbox" data-v="img"${sel==='diagram'?' hidden':''}>`
    + `<img class="dgimg" loading="lazy" decoding="async" width="${IMG_W}" height="${IMG_H}" alt="${label}"${src?` src="${src}"`:''}>`
    + `</div>`
    + `<div class="vbox" data-v="diagram"${sel==='diagram'?'':' hidden'}>${art}</div>`;
}

// Re-point every open card at the newly chosen style. Cards whose exercise has no
// file for it keep what they have, so the switch never blanks a card out.
export function applyView(root, view){
  setView(view);
  root.querySelectorAll('.vsw').forEach(sw => {
    const k = sw.dataset.k, card = sw.parentElement;
    const want = view === 'diagram' ? 'diagram' : (stylesFor(k).includes(view) ? view : null);
    sw.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === (want || 'diagram')));
    if (!want) return;
    const imgBox = card.querySelector('.vbox[data-v="img"]'), dgBox = card.querySelector('.vbox[data-v="diagram"]');
    if (want === 'diagram'){ if (imgBox) imgBox.hidden = true; if (dgBox) dgBox.hidden = false; return; }
    const img = imgBox && imgBox.querySelector('img'), src = srcFor(k, want);
    if (img && src && !img.getAttribute('src')?.endsWith(src)) img.src = src;
    if (imgBox) imgBox.hidden = false;
    if (dgBox) dgBox.hidden = true;
  });
}

/* ---------- exports ---------- */
// CUR_HL is read by leg()/fig() while an exercise is being drawn: the caller sets
// it, calls the art function, then clears it.
export function setHL(v){ CUR_HL = v || []; }
export function getView(){ return VIEW; }
export function setView(v){
  VIEW = v;
  try { localStorage.setItem('dg-view', v); } catch(e){}
  precacheSelectedStyle();
}

// Tell the service worker which illustration style to keep offline, so exactly one
// set is precached instead of both. Called on boot and on every switch; the worker
// skips anything it already holds, so switching back and forth costs nothing.
export function precacheSelectedStyle(){
  const style = VIEW === 'diagram' ? null : VIEW;
  if (!style || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    const sw = reg.active || navigator.serviceWorker.controller;
    if (sw) sw.postMessage({ type: 'precache-style', urls: stylePaths(style) });
  }).catch(() => {});
}

export { D, DOSE, MUS, IMG, DIAGRAMS, LEGEND, LEGEND_FOR, REST, AFTER, WARM_REST, FLOW,
         restHTML, flowHTML, nextHTML, startTimer, stopTimer, fmtS, rounds, sets, svg };
