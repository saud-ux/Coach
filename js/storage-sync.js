// storage-sync.js — the server bridge and how state gets loaded and saved.
//
// Two jobs:
//   1. window.claude — the small runtime that replaces the Claude artifact host
//      when the app runs on our own server: sample() for the coach, db/user for
//      cloud sync, RC_INBOX for assignments. Kept on window because the guard at
//      the top lets the app still run inside the artifact host unchanged.
//   2. loading and saving state.
//
// Loading is deliberately split in two. bootLocal() paints from localStorage with
// no network at all, so the app opens instantly even while the Render instance is
// still waking up. syncRemote() then catches up in the background and shows
// «يتم التحديث…» while it does. Nothing awaits the network before first paint.

import { state, setState, LS, $, setStatus, save, persistLocal, hooks, setLoaded, todayISO } from './state.js';
import { ensureHorizon, applyMatch } from './schedule.js';

/* ---------- window.claude runtime ---------- */
export function initRuntime(){
  if (window.claude && window.claude.use) return;
  const KEY='rc-pass';
  const getPass=()=>{ try{ return localStorage.getItem(KEY)||''; }catch(e){ return ''; } };
  async function api(path, opts={}){
    let pass=getPass();
    for (let attempt=0; attempt<3; attempt++){
      const r = await fetch(path,{...opts,headers:{'Content-Type':'application/json','X-Passcode':pass,...(opts.headers||{})}});
      if (r.status===401){ pass = prompt('اكتب رمز الدخول:')||''; try{localStorage.setItem(KEY,pass);}catch(e){} if(!pass) throw {code:'not_granted',message:'no passcode'}; continue; }
      let body = null; try { body = await r.clone().json(); } catch(e){}
      if (r.status===429) throw {code:(body&&body.error==='upstream_rate')?'upstream_rate':'rate_limited',message:'rate'};
      if (!r.ok) throw {code:(body&&body.error)||'upstream_error', detail:(body&&body.detail)||'', status:r.status};
      return body!==null ? body : r.json();
    }
    throw {code:'not_granted',message:'bad passcode'};
  }
  async function toB64(blob){
    const img = await createImageBitmap(blob); const s=Math.min(1,1400/Math.max(img.width,img.height));
    const c=document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.85).split(',')[1];
  }
  async function call(input, opts){
    let messages = typeof input==='string' ? [{role:'user',content:input}] : input.map(m=>({role:m.role,content:m.content}));
    const imgs = opts.images ? Array.from(opts.images instanceof Blob ? [opts.images] : opts.images) : [];
    if (imgs.length){ const last=messages[messages.length-1]; const blocks=[];
      for (const b of imgs) blocks.push({type:'image',source:{type:'base64',media_type:'image/jpeg',data:await toB64(b)}});
      blocks.push({type:'text',text:last.content}); last.content=blocks; }
    const payload = opts.system ? {system:opts.system, messages} : {messages};
    const d = await api('/api/claude',{method:'POST',body:JSON.stringify(payload)});
    return {text:d.text||'', truncated:d.stop_reason==='max_tokens', modelTierApplied:'default'};
  }
  const sample = async (input, opts={}) => { if (opts.signal && opts.signal.aborted) throw {code:'cancelled'}; const r = await call(input, opts); if (opts.signal && opts.signal.aborted) throw {code:'cancelled'}; if (opts.onText) opts.onText({text:r.text, delta:r.text}); return r; };
  sample.json = async (input, opts={}) => { const r = await sample(input, opts); let t=r.text.trim();
    const f=t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) t=f[1];
    try { return JSON.parse(t); } catch(e){ const s=t.search(/[\[{]/), e2=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']')); try { return JSON.parse(t.slice(s,e2+1)); } catch(_){ throw {code:r.truncated?'truncated':'invalid_json',message:'parse',text:r.text}; } } };
  sample.limits = async () => ({maxPromptBytes:65536, images:{maxCount:1,maxInputBytes:20e6,mediaTypes:['image/jpeg','image/png','image/heic','image/webp']}});
  // cloud sync through our server (Supabase behind it)
  const db = { doc: () => ({
    get: async () => { const d = await api('/api/state'); return { exists: !!(d && d.data), data: () => d.data }; },
    set: async (v) => { await api('/api/state',{method:'PUT',body:JSON.stringify({data:v})}); }
  }) };
  const user = { id: async () => 'me' };
  window.RC_INBOX = { list: () => api('/api/inbox'), remove: id => api('/api/inbox?id='+encodeURIComponent(id),{method:'DELETE'}) };
  let syncOk = null;
  async function hasSync(){ if (syncOk!==null) return syncOk; try { const r=await fetch('/api/state/enabled'); syncOk = r.ok && (await r.json()).enabled; } catch(e){ syncOk=false; } return syncOk; }
  window.claude = { use: async name => name==='sample' ? sample : name==='db' ? ((await hasSync())?db:null) : name==='user' ? ((await hasSync())?user:null) : null };
}

/* ---------- the coach handle ---------- */
// sampleFn is reassigned after boot and again when the server rejects the
// passcode, so it cannot be a plain imported binding. Importers read rt.sample.
export const rt = { sample: null };
export const hasCoach = () => !!rt.sample;

/* ---------- adopt: the only place state is rebuilt ---------- */
// A whitelist on purpose — anything not named here is dropped, which is also what
// keeps a hand-edited or truncated backup from injecting junk. The flip side is
// that any NEW top-level key has to be added here or it silently disappears on
// the next load, so this function is the one to edit when the shape grows.
export function adopt(data){
  if (!data || !data.sessions) return;
  setState({v:7, sessions:data.sessions, matches:data.matches||[], logs:data.logs||{}, tests:(data.tests||[]).filter(x=>x.kind==='cooper'), chat:data.chat||[], readiness:data.readiness||{}, reports:data.reports||{}, quiz:data.quiz||{answers:{},daily:{}}, settings:data.settings||{city:'zulfi'}, push:data.push||null, health:data.health||null});
  if ((data.v||1) < 6){
    // plan template changed: replace every upcoming non-match day with the ongoing plan
    const t = todayISO();
    Object.keys(state.sessions).forEach(d => { if (d >= t && state.sessions[d].type !== 'match') delete state.sessions[d]; });
    ensureHorizon();
    state.matches.filter(m => m.date >= t).forEach(m => applyMatch(m.date, m.time, m.note));
  }
}

/* ---------- load and save ---------- */
let docRef = null, saving = Promise.resolve(), editSeq = 0, lastStatus = '';

hooks.onDirty = () => { editSeq++; };
hooks.remoteSave = snap => {
  if (!docRef) return;
  saving = saving.then(() => docRef.set(snap)).then(() => setStatus(lastStatus = 'محفوظ'))
    .catch(e => setStatus(lastStatus = e.code==='quota_exceeded' ? 'المساحة ممتلئة' : 'تعذّر الحفظ، يُحفظ على الجهاز مؤقتًا'));
};

// Step 1: no network. Read the device copy, fill the plan horizon, and let the
// app paint. After this returns the app is fully usable offline.
export function bootLocal(){
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LS) || 'null'); } catch(e){}
  if (local) adopt(local);
  ensureHorizon();
  setLoaded(true);
  // persist the freshly generated plan straight away. Without this, a first run with
  // no cloud sync kept nothing on the device until the user happened to change
  // something -- the old initStorage() always ended with a save().
  persistLocal();
  setStatus(lastStatus = 'محفوظ على هذا الجهاز');
  return !!local;
}

// Step 2: catch up with the server. Runs after first paint, never blocks it.
export async function syncRemote(){
  const seqAtStart = editSeq;
  setStatus('يتم التحديث…');
  try {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const uid = user ? await user.id() : null;
    if (!db || !uid){ setStatus(lastStatus); return; }
    docRef = db.doc(`data/users/${uid}/state`);
    const snap = await docRef.get();
    if (snap.exists){
      // The server copy wins, as it always has — except when the user changed
      // something while the request was in flight. Overwriting their edit with a
      // snapshot taken before it would lose work they just did.
      if (editSeq === seqAtStart){
        adopt(snap.data());
        ensureHorizon();
        persistLocal();          // keep the device copy in step with what we just took
        hooks.rerender();
      }
    }
    setStatus(lastStatus = 'محفوظ في حسابك');
    save();                       // seed the server on first run, or flush local edits
  } catch(e){
    setStatus(lastStatus);        // offline is normal here, not an error worth shouting about
  }
}

/* ---------- backup ---------- */
// The export is a bare JSON.stringify(state) and the import goes through adopt(),
// which is what keeps every older backup readable. They live here rather than in
// main.js so the settings sheet can call them without reaching into the entry.
export function exportBackup(){
  const blob = new Blob([JSON.stringify(state)], {type:'application/json'});
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = 'referee-backup-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(file){
  try {
    const d = JSON.parse(await file.text());
    if (!d.sessions) return false;
    adopt(d);
    ensureHorizon();
    save();
    return true;
  } catch(e){ return false; }
}

/* ---------- assignment inbox ---------- */
export const inboxList = () => window.RC_INBOX ? window.RC_INBOX.list() : Promise.resolve([]);
export const inboxRemove = id => window.RC_INBOX ? window.RC_INBOX.remove(id) : Promise.resolve();
export const hasInbox = () => !!window.RC_INBOX;
