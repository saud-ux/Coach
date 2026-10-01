// mobile.js — the touches that make the app feel like a phone app, not a page.
//
//   - a sheet follows the finger down and closes past a threshold, like iOS sheets
//   - pulling the top of Today or الجدول down re-syncs the plan and the watch
//   - with the keyboard up, the tab bar steps aside and the composer sits on top of it
//
// main.js calls initMobile() once with what these need from it, so this module
// imports nothing and cannot join an import cycle.

const DISMISS = 110;            // px of drag that closes a sheet
const PULL = 72;                // px of pull that refreshes

export function initMobile({ closeSheet, refresh, activeTab }){
  sheetDrag(closeSheet);
  pullToRefresh(refresh, activeTab);
  keyboard();
}

/* ---------- drag a sheet down to close it ---------- */
function sheetDrag(closeSheet){
  const sh = document.getElementById('sheet');
  let y0 = null, dy = 0, t0 = 0;
  const reset = () => { sh.style.transition = 'transform .22s cubic-bezier(.2,.8,.3,1)'; sh.style.transform = ''; };
  sh.addEventListener('touchstart', e => {
    // only from the top of the sheet's own scroll, and never from a field or a slider
    if (sh.scrollTop > 0 || e.target.closest('input,textarea,select,[data-nodrag]')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); sh.style.transition = 'none';
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || sh.scrollTop > 0) { sh.style.transform = ''; return; }
    sh.style.transform = `translateY(${dy * 0.9}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;      // a flick closes too
    y0 = null;
    if (dy > DISMISS || fast) {
      sh.style.transition = 'transform .18s ease-in'; sh.style.transform = 'translateY(100%)';
      setTimeout(() => { sh.style.transition = ''; sh.style.transform = ''; closeSheet(); }, 170);
    } else reset();
  });
}

/* ---------- pull to refresh ---------- */
function pullToRefresh(refresh, activeTab){
  const ind = document.createElement('div');
  ind.className = 'ptr'; ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<i></i><span>اسحب للتحديث</span>';
  document.body.appendChild(ind);
  const label = ind.querySelector('span');
  let y0 = null, dy = 0, busy = false;
  const can = () => !busy && window.scrollY <= 0 && document.getElementById('scrim').hidden && ['today', 'sched'].includes(activeTab());
  document.addEventListener('touchstart', e => { y0 = can() ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { ind.style.setProperty('--p', 0); ind.classList.remove('on'); return; }
    const p = Math.min(1, dy / PULL);
    ind.style.setProperty('--p', p);
    ind.classList.add('on');
    label.textContent = p >= 1 ? 'اترك للتحديث' : 'اسحب للتحديث';
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy < PULL) { ind.classList.remove('on'); ind.style.setProperty('--p', 0); return; }
    busy = true; ind.classList.add('busy'); label.textContent = 'يحدّث…';
    try { await refresh(); label.textContent = 'محدّث ✓'; } catch (e) { label.textContent = 'ما قدرت أحدّث'; }
    setTimeout(() => { ind.classList.remove('on', 'busy'); ind.style.setProperty('--p', 0); busy = false; }, 700);
  });
}

/* ---------- the keyboard ---------- */
// iOS slides the keyboard over position:fixed elements. visualViewport says how
// much of the screen it took, so the composer can sit above it and the tab bar,
// useless while typing, can step aside.
function keyboard(){
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const up = kb > 80;
    root.classList.toggle('kb', up);
    root.style.setProperty('--kb', up ? `${Math.round(kb)}px` : '0px');
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}
