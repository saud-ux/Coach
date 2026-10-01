// ui.js — the pieces the new design repeats: progress rings and stroke icons.
//
// No emoji anywhere in the chrome. Every glyph here is an inline stroke SVG that
// inherits currentColor, so an icon picks up whatever colour its container sets.
//
// Imports nothing, like state.js, so anything may use it.

/* ---------- rings ---------- */
// One SVG circle on top of a --track circle: round caps, rotated -90deg so the
// arc starts at twelve o'clock, and stroke-dasharray/offset carrying the value.
//
// `pct` is 0..1 and is clamped. A ring at exactly 0 draws nothing but the track,
// which is what the empty sleep state wants.
export function ring({ size = 176, pct = 0, color = 'var(--sleep)', width = 12, track = 'var(--track)', cls = '' } = {}){
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const off = c * (1 - p);
  return `<svg class="ring ${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${track}" stroke-width="${width}"/>
    ${p > 0 ? `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
      transform="rotate(-90 ${size/2} ${size/2})"/>` : ''}
  </svg>`;
}

// A ring with its own content stacked in the middle.
export function ringWith(opts, inner){
  return `<div class="ringwrap" style="--rs:${opts.size || 176}px">${ring(opts)}<div class="ringmid">${inner}</div></div>`;
}

/* ---------- icons ---------- */
// 24x24, stroke 1.8, round caps. Sized by CSS (width/height on .ic).
const P = {
  today:    '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M9.5 19.5V14h5v5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chat:     '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/>',
  chart:    '<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>',
  gear:     '<circle cx="12" cy="12" r="3.1"/><path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 0 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.2a1.9 1.9 0 0 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.2a1.9 1.9 0 0 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 0 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  back:     '<path d="M9 5l7 7-7 7"/>',
  flag:     '<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 3.6L17 11.7H6z"/>',
  moon:     '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>',
  heart:    '<path d="M12 20s-7-4.5-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7-1.3c0 4.8-7 13.3-7 13.3z"/>',
  clock:    '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3 1.8"/>',
  route:    '<circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="6" r="2.3"/><path d="M8.3 17.3C14 16 16 13 16.4 8.3"/>',
  bolt:     '<path d="M13.2 3 5.8 13.2h4.6L9.9 21l7.4-10.2h-4.6z"/>',
  spark:    '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.6 6.6l2.8 2.8M14.6 14.6l2.8 2.8M17.4 6.6l-2.8 2.8M9.4 14.6l-2.8 2.8"/>',
  check:    '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus:     '<path d="M12 5.5v13M5.5 12h13"/>',
  close:    '<path d="M6 6l12 12M18 6L6 18"/>',
  inbox:    '<path d="M3.5 13h4l1.5 2.5h6L16.5 13h4"/><path d="M5.5 5h13l2 8v4.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V13z"/>',
  scale:    '<path d="M12 4.5v15M7 19.5h10"/><path d="M4 9.5h16M6.5 9.5 4 15h5zM17.5 9.5 15 15h5z"/>',
  timer:    '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5M9.5 3h5"/>',
  refresh:  '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M20 4.5V9h-4.5"/>',
  info:     '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5M12 8.2v.1"/>',
  trash:    '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M7 6.5l.8 13h8.4l.8-13"/>',
};

export function icon(name, cls = ''){
  const d = P[name];
  if (!d) return '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${d}</svg>`;
}

/* ---------- small formatters ---------- */
// "7 س 12 د" — the app shows Western digits everywhere, including here.
const ar = n => Number(n).toLocaleString('ar-SA-u-nu-latn', { useGrouping: false });

export function hhmm(mins){
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${ar(r)} د`;
  return r ? `${ar(h)} س ${ar(r)} د` : `${ar(h)} س`;
}

// "11:45 م" from "23:45" or a Date
export function clock12(v){
  let h, m;
  if (v instanceof Date){ h = v.getHours(); m = v.getMinutes(); }
  else {
    const x = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
    if (!x) return '';
    h = +x[1]; m = +x[2];
  }
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ar(h12)}:${String(m).padStart(2,'0').replace(/\d/g, d => ar(d))} ${suffix}`;
}

export { ar as arNum };

/* ---------- Western digits on screen ---------- */
// The app writes 0-9 itself, but text it did not write can still carry Arabic-
// Indic digits: plan days generated before the switch, old chat and reports, a
// coach reply that ignored its instructions, an assignment SMS. Rather than
// rewrite stored data, every text node is converted on its way to the screen.
// Setting nodeValue fires one more mutation, which finds nothing left to change.
const LATIN = { '٫': '.', '٪': '%' };
const NON_LATIN = /[\u0660-\u066B\u06F0-\u06F9]/;
const toLatin = t => t.replace(/[\u0660-\u066B\u06F0-\u06F9]/g, c =>
  LATIN[c] ?? String((c.charCodeAt(0) - (c >= '\u06F0' ? 0x6F0 : 0x660))));

export function latinDigits(root){
  const fix = n => { if (NON_LATIN.test(n.nodeValue)) n.nodeValue = toLatin(n.nodeValue); };
  const walk = el => {
    if (el.nodeType === 3) return fix(el);
    if (el.nodeType !== 1) return;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fix(n);
  };
  walk(root);
  new MutationObserver(ms => {
    for (const m of ms){
      if (m.type === 'characterData') fix(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
