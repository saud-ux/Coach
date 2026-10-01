// state.js — dates, the state object, and saving.
//
// This is the bottom of the dependency graph: it imports nothing, so every other
// module can import it freely.
//
// `state` is an exported `let`. ES modules give importers a live binding, so when
// setState() swaps the whole object (on load or on backup import) every module
// sees the new one without re-importing. Reassignment has to happen in here,
// which is why setState() exists instead of `state = …` from storage-sync.js.

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const todayISO = () => iso(new Date());
// Arabic words, Gregorian calendar, Western digits (0-9) everywhere in the app.
const AR = 'ar-SA-u-ca-gregory-nu-latn';
const fWd = new Intl.DateTimeFormat(AR,{weekday:'long'});
const fDm = new Intl.DateTimeFormat(AR,{day:'numeric',month:'short'});
const fFull = new Intl.DateTimeFormat(AR,{weekday:'long',day:'numeric',month:'long'});
const fMon = new Intl.DateTimeFormat(AR,{month:'long',year:'numeric'});
const num = n => Number(n).toLocaleString(AR);
const PLAN_START = '2026-09-27';

export { pad, iso, parse, addDays, todayISO, AR, fWd, fDm, fFull, fMon, num, PLAN_START };

/* ---------- dom helpers ---------- */
export const $ = id => document.getElementById(id);
// The sync line is only worth the user's attention while something is happening
// or has gone wrong. The settled states are written but kept invisible, so the
// Today header stays as specified: date, title, gear.
const QUIET = ['محفوظ', 'محفوظ في حسابك', 'محفوظ على هذا الجهاز'];
export const setStatus = t => {
  const el = $('status');
  if (!el) return;
  el.textContent = t;
  el.classList.toggle('show', !QUIET.includes(t));
};

/* ---------- state ---------- */
// v7 adds `health`, a cache of sleep nights and watch workouts. It is additive:
// a v6 backup simply has no health key and gets an empty one, which is why the
// destructive migration gate in adopt() still reads `< 6` and not `< 7`.
export let state = {v:7, sessions:{}, matches:[], logs:{}, tests:[], chat:[], readiness:{}, reports:{}, quiz:{answers:{},daily:{}}, settings:{city:'zulfi'}, push:null, health:null};
export function setState(next){ state = next; }

export const LS = 'referee-coach-v1';

// Filled in by other modules so state.js stays dependency-free:
//   remoteSave  — storage-sync.js, pushes a snapshot to /api/state
//   rerender    — main.js, renderAll()
//   onDirty     — storage-sync.js, notes that the user changed something, so an
//                 in-flight background fetch does not overwrite their edit
export const hooks = { remoteSave: null, rerender: () => {}, onDirty: () => {} };

let loaded = false, saveTimer = null;
export function setLoaded(v){ loaded = v; }
export function isLoaded(){ return loaded; }

// Write the device copy immediately, without marking the state dirty. Used at boot,
// where ensureHorizon() has just generated the plan but the user has not changed
// anything: save() would count as an edit and make syncRemote() skip the server copy.
export function persistLocal(){
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch(e){}
}

export function save(){
  if (!loaded) return;
  hooks.onDirty();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.chat.length > 60) state.chat = state.chat.slice(-60);
    const snap = JSON.parse(JSON.stringify(state));
    if (hooks.remoteSave) hooks.remoteSave(snap);
    try { localStorage.setItem(LS, JSON.stringify(snap)); } catch(e){}
  }, 500);
}
