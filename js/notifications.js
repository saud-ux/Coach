// notifications.js — web push for the four reminders.
//
// The app only ever stores a subscription. Deciding what is due and writing the
// text happens on the server, driven by an external cron hitting /api/cron, so
// reminders arrive whether or not the app is open.
//
// subscribePush() re-subscribes when the server's VAPID public key has changed,
// because a generated pair does not survive a deploy and the old subscription is
// then dead. installed() exists because iOS only delivers push to a PWA that was
// added to the home screen and opened from its icon.
import { state, save, $ } from './state.js';

/* ---------- reminders ---------- */
const PUSH_DEF = {ready:{on:true,time:'08:00'}, train:{on:true,time:'17:00'}, match:{on:true,before:120}, weekly:{on:true,day:6,time:'20:00'}};
const prefsOf = () => { const p=(state.push&&state.push.prefs)||{}; return {ready:{...PUSH_DEF.ready,...(p.ready||{})}, train:{...PUSH_DEF.train,...(p.train||{})}, match:{...PUSH_DEF.match,...(p.match||{})}, weekly:{...PUSH_DEF.weekly,...(p.weekly||{})}}; };
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64 = s => { const pad='='.repeat((4-s.length%4)%4), raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(raw, c=>c.charCodeAt(0)); };

async function subscribePush(){
  const reg = await navigator.serviceWorker.ready;
  const key = await (await fetch('/api/push/key')).json();
  if (!key || !key.key) throw new Error('no key');
  let sub = await reg.pushManager.getSubscription();
  // the server may have restarted with a new pair; the old subscription is then dead
  if (sub && sub.options && sub.options.applicationServerKey){
    const cur = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    if (cur !== key.key){ await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64(key.key)});
  state.push = {...(state.push||{}), sub: sub.toJSON(), prefs: prefsOf()};
  save();
  return sub;
}

function renderNotif(){
  const st=$('notifState'), on=$('notifOn'), test=$('notifTest'), opts=$('notifOpts');
  if (!st) return;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const perm = supported ? Notification.permission : 'denied';
  const live = !!(state.push && state.push.sub);
  if (!supported){
    st.textContent = installed() ? 'متصفحك ما يدعم التنبيهات.' : 'عشان تشتغل التنبيهات، أضف التطبيق للشاشة الرئيسية: مشاركة ← إضافة إلى الشاشة الرئيسية، ثم افتحه من الأيقونة.';
    on.hidden = true; opts.hidden = true; test.hidden = true; return;
  }
  if (perm === 'denied'){
    st.textContent = 'التنبيهات ممنوعة لهذا التطبيق. فعّلها من إعدادات الآيفون ← الإشعارات ← جدول الحكم.';
    on.hidden = true; opts.hidden = true; test.hidden = true; return;
  }
  on.hidden = live; test.hidden = !live; opts.hidden = !live;
  st.textContent = live ? 'التنبيهات مفعّلة على هذا الجهاز ✅' : 'فعّل التنبيهات عشان يذكّرك المدرب بالتمرين وفحص الجاهزية وقبل المباريات.';
  if (!live) return;
  const p = prefsOf();
  $('nReady').checked=p.ready.on; $('nReadyT').value=p.ready.time;
  $('nTrain').checked=p.train.on; $('nTrainT').value=p.train.time;
  $('nMatch').checked=p.match.on; $('nMatchB').value=String(p.match.before);
  $('nWeek').checked=p.weekly.on; $('nWeekD').value=String(p.weekly.day); $('nWeekT').value=p.weekly.time;
}
function savePrefs(){
  if (!state.push) return;
  state.push.prefs = {
    ready:{on:$('nReady').checked, time:$('nReadyT').value||'08:00'},
    train:{on:$('nTrain').checked, time:$('nTrainT').value||'17:00'},
    match:{on:$('nMatch').checked, before:Number($('nMatchB').value)||120},
    weekly:{on:$('nWeek').checked, day:Number($('nWeekD').value), time:$('nWeekT').value||'20:00'}
  };
  save();
}
/* ---------- wiring, called once by main.js after the markup exists ---------- */
function initNotifications(){
  if (!$('notifOn')) return;

  $('notifOn').onclick = async () => {
    const btn=$('notifOn'); btn.disabled=true; btn.textContent='لحظة…';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted'){ renderNotif(); return; }
      await subscribePush();
      renderNotif();
    } catch(e){ $('notifState').textContent = 'ما قدرنا نفعّل التنبيهات. تأكد إن التطبيق مفتوح من أيقونة الشاشة الرئيسية وأعد المحاولة.'; }
    finally { btn.disabled=false; btn.textContent='فعّل التنبيهات'; }
  };
  $('notifTest').onclick = async () => {
    const btn=$('notifTest'); btn.disabled=true; btn.textContent='يرسل…';
    try {
      const sub = await subscribePush();
      const r = await fetch('/api/push/test',{method:'POST',headers:{'Content-Type':'application/json','X-Passcode':(localStorage.getItem('rc-pass')||'')},body:JSON.stringify({subscription:sub.toJSON()})});
      $('notifState').textContent = r.ok ? 'أرسلنا تنبيه تجربة، لازم يوصلك خلال ثوانٍ.' : 'ما قدرنا نرسل. راجع سجل الخدمة.';
    } catch(e){ $('notifState').textContent='ما قدرنا نرسل التجربة.'; }
    finally { btn.disabled=false; btn.textContent='جرّب تنبيه'; }
  };
  // the keys live behind the passcode header, which a browser cannot send from the address
  // bar, so the app fetches them and hands them over ready to paste into the host settings
  $('vapidBtn').onclick = async () => {
    const box=$('vapidBox'), btn=$('vapidBtn');
    if (!box.hidden){ box.hidden=true; btn.textContent='أظهر مفاتيح التنبيهات الثابتة'; return; }
    btn.disabled=true; btn.textContent='لحظة…';
    try {
      const r = await fetch('/api/push/vapid',{headers:{'X-Passcode':(localStorage.getItem('rc-pass')||'')}});
      if (!r.ok) throw new Error('http '+r.status);
      const k = await r.json();
      box.innerHTML = '<p class="note">انسخ كل قيمة وحطها في إعدادات الخدمة بنفس الاسم، عشان التنبيهات ما تنقطع مع كل تحديث.</p>';
      [['VAPID_PUBLIC_KEY',k.publicKey],['VAPID_PRIVATE_KEY',k.privateKey]].forEach(([name,val])=>{
        const w=document.createElement('div'); w.style.marginTop='10px';
        const l=document.createElement('label'); l.className='f'; l.textContent=name; w.appendChild(l);
        const t=document.createElement('textarea'); t.className='in'; t.rows=2; t.readOnly=true; t.value=val;
        t.onclick=()=>t.select(); w.appendChild(t);
        const b=document.createElement('button'); b.className='btn ghost'; b.textContent='انسخ';
        b.onclick=async()=>{ try{ await navigator.clipboard.writeText(val); }catch(e){ t.select(); document.execCommand('copy'); } b.textContent='تم النسخ ✅'; setTimeout(()=>b.textContent='انسخ',1500); };
        w.appendChild(b); box.appendChild(w);
      });
      box.hidden=false; btn.textContent='إخفاء المفاتيح';
    } catch(e){ box.innerHTML='<p class="note">ما قدرنا نجيب المفاتيح. تأكد من رمز الدخول وأعد المحاولة.</p>'; box.hidden=false; btn.textContent='إخفاء'; }
    finally { btn.disabled=false; }
  };
  ['nReady','nTrain','nMatch','nWeek'].forEach(id=>$(id).onchange=savePrefs);
  ['nReadyT','nTrainT','nMatchB','nWeekD','nWeekT'].forEach(id=>$(id).onchange=savePrefs);
}

export { PUSH_DEF, prefsOf, installed, subscribePush, renderNotif, savePrefs, initNotifications };
