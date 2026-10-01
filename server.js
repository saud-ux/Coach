// جدول الحكم — static app + a small proxy to the Claude API for the coach
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// strip every space and line break: no secret here contains whitespace, and one pasted
// wrapped across lines makes fetch throw "invalid header value", which used to surface
// in the app as a bare connection error
const clean = v => (v || '').replace(/\s+/g, '');
// never let a key reach the logs
const redact = v => String(v == null ? '' : v).replace(/sk-ant-[A-Za-z0-9_\-]+/g, 'sk-ant-***');
const API_KEY = clean(process.env.ANTHROPIC_API_KEY);
const KEY_OK = /^[\x21-\x7e]+$/.test(API_KEY);   // printable ASCII, no spaces or newlines
const PASSCODE = clean(process.env.APP_PASSCODE);
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 8000;
const EFFORT = process.env.CLAUDE_EFFORT || 'low';            // low|medium|high|xhigh|max, or 'off' to omit
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 90000;
const SB_URL = clean(process.env.SUPABASE_URL), SB_KEY = clean(process.env.SUPABASE_KEY), SYNC_TOKEN = clean(process.env.SYNC_TOKEN);
const SYNC = !!(SB_URL && SB_KEY && SYNC_TOKEN);
const PUBLIC = __dirname;
// Nothing here is secret, but none of it is the app either: serving it only gives
// a reader our source and our notes. Any .md and the migrations folder are covered
// by rule rather than by name, so a new doc is private the moment it is written.
const PRIVATE = new Set(['server.js','package.json','package-lock.json','render.yaml','.gitignore']);
const PRIVATE_DIRS = ['/migrations', '/lib', '/node_modules', '/.git'];
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css; charset=utf-8', '.webmanifest':'application/manifest+json', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
// what is worth compressing: text shrinks by 70-80%, images and fonts are already compressed
const COMPRESSIBLE = new Set(['.html','.js','.mjs','.css','.json','.webmanifest','.svg','.txt']);

/* ---------- static files: compression + cache policy ---------- */
const zlib = require('zlib');
// Compress once per file and keep the result, keyed by path, encoding and mtime.
// The whole site is a handful of text files, so this stays tiny and every request
// after the first is a buffer write.
const zCache = new Map();
function compressed(file, enc, buf, mtime){
  const key = `${enc}:${file}:${mtime}`;
  const hit = zCache.get(key);
  if (hit) return hit;
  let out;
  try {
    out = enc === 'br'
      ? zlib.brotliCompressSync(buf, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5,          // 5 is the knee: near-max ratio, fast
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
      : zlib.gzipSync(buf, { level: 6 });
  } catch (e) { return null; }
  // a "compressed" file that grew is not worth serving
  if (out.length >= buf.length) return null;
  if (zCache.size > 200) zCache.clear();
  zCache.set(key, out);
  return out;
}
function pickEncoding(req){
  const a = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (/\bbr\b/.test(a)) return 'br';
  if (/\bgzip\b/.test(a)) return 'gzip';
  return null;
}
// A ?v= query is a promise from index.html that the bytes will never change under
// that URL, so those can be cached hard. Without it, revalidate: the service worker
// is the real cache for css and js, and being able to ship a fix without waiting out
// a max-age matters more than saving a 304.
function cachePolicy(ext, file, hasVersion){
  if (ext === '.html' || file.endsWith('sw.js')) return 'no-cache';
  if (hasVersion) return 'public, max-age=31536000, immutable';
  if (ext === '.js' || ext === '.mjs' || ext === '.css') return 'no-cache';
  return 'public, max-age=604800';
}

// simple per-IP rate limit: 30 coach calls / 10 minutes
const hits = new Map();
function limited(ip){ const now=Date.now(), w=10*60*1000; const a=(hits.get(ip)||[]).filter(t=>now-t<w); a.push(now); hits.set(ip,a); return a.length>30; }

function send(res, code, body, type='application/json'){ res.writeHead(code, {'Content-Type':type}); res.end(typeof body==='string'?body:JSON.stringify(body)); }

// one call to the Claude API, with a timeout; retries once on a transient failure
async function askClaude(body){
  for (let attempt = 0; attempt < 2; attempt++){
    let r, d;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST',
        headers:{'content-type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      d = await r.json();
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (attempt === 0 && !timedOut) continue;                       // one retry on a network blip
      console.error('Claude API unreachable', e && e.name, redact(e && e.message));
      return { status: timedOut ? 504 : 502, error: timedOut ? 'timeout' : 'network' };
    }
    if (r.ok) return { ok: true, data: d };
    const detail = redact((d && d.error && d.error.message) || '');
    console.error('Claude API error', r.status, detail || redact(JSON.stringify(d)));
    if ((r.status === 429 || r.status >= 500) && attempt === 0) continue;   // one retry on a transient status
    if (r.status === 401 || r.status === 403) return { status: 502, error: 'bad_api_key' };
    if (r.status === 429) return { status: 429, error: 'upstream_rate' };
    if (r.status >= 500) return { status: 502, error: 'upstream_down' };
    return { status: 502, error: 'bad_request', detail };
  }
  return { status: 502, error: 'network' };
}

async function coach(req, res){
  if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'});
  const ip = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, {error:'rate'});
  if (!API_KEY) return send(res, 500, {error:'no_api_key'});
  if (!KEY_OK) return send(res, 500, {error:'bad_key_format'});
  let raw=''; for await (const c of req){ raw+=c; if (raw.length>8000000) return send(res, 413, {error:'too large'}); }
  let messages, system; try { const b = JSON.parse(raw); messages = b.messages; system = b.system; } catch { return send(res, 400, {error:'bad json'}); }
  if (!Array.isArray(messages) || !messages.length) return send(res, 400, {error:'no messages'});
  // merge consecutive same-role turns (the app may send two user turns in a row)
  const toBlocks = c => Array.isArray(c) ? c.filter(b => (b.type==='text' && typeof b.text==='string') || (b.type==='image' && b.source && b.source.type==='base64' && /^image\/(jpeg|png|webp|gif)$/.test(b.source.media_type))).map(b => b.type==='text' ? {type:'text',text:b.text} : {type:'image',source:{type:'base64',media_type:b.source.media_type,data:String(b.source.data)}}) : [{type:'text',text:String(c||'')}];
  const merged=[]; for (const m of messages){ const role=m.role==='assistant'?'assistant':'user', blocks=toBlocks(m.content); if (!blocks.length) continue; if (merged.length && merged[merged.length-1].role===role) merged[merged.length-1].content.push(...blocks); else merged.push({role,content:blocks}); }
  if (!merged.length) return send(res, 400, {error:'no messages'});
  if (merged[0].role!=='user') merged.unshift({role:'user',content:[{type:'text',text:'.'}]});

  const body = { model: MODEL, max_tokens: MAX_TOKENS, messages: merged };
  if (typeof system === 'string' && system.trim()) body.system = system.slice(0, 20000);
  if (EFFORT !== 'off') body.output_config = { effort: EFFORT };

  const r = await askClaude(body);
  if (!r.ok) return send(res, r.status, {error: r.error, detail: r.detail || ''});
  const text = (r.data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
  // an empty reply means the token budget ran out before any text was written
  if (!text.trim()) { console.error('Claude returned no text', r.data.stop_reason, JSON.stringify(r.data.usage||{})); return send(res, 502, {error:'truncated'}); }
  send(res, 200, {text, stop_reason: r.data.stop_reason || ''});
}

async function rpc(fn, args){
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {method:'POST', headers:{'apikey':SB_KEY,'Content-Type':'application/json'}, body:JSON.stringify({p_token:SYNC_TOKEN, ...args})});
  if (!r.ok) throw new Error('supabase '+r.status+' '+await r.text());
  return r.json();
}
async function state(req, res){
  if (!SYNC) return send(res, 404, {error:'sync disabled'});
  if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'});
  try {
    if (req.method === 'GET') return send(res, 200, (await rpc('coach_get', {})) || {});
    if (req.method === 'PUT') {
      let raw=''; for await (const c of req){ raw+=c; if (raw.length>5000000) return send(res, 413, {error:'too large'}); }
      const body = JSON.parse(raw); if (!body || typeof body.data !== 'object') return send(res, 400, {error:'bad body'});
      const ts = await rpc('coach_put', {p_data: body.data}); return send(res, 200, {updated_at: ts});
    }
    send(res, 405, {error:'method'});
  } catch (e) { console.error(e); send(res, 502, {error:'sync failed'}); }
}

// assignment SMS -> inbox (called from an iOS Shortcuts automation)
function parseAssign(text){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  const link = (t.match(/https?:\/\/\S+/)||[])[0] || '';
  const body = t.replace(/https?:\/\/\S+/g,' ').replace(/\s+/g,' ').trim();
  const m = body.match(/مباراة\s+(.+?)\s*[Xx×]\s*(.+)$/);
  return { home: m ? m[1].trim() : '', away: m ? m[2].trim() : '', link };
}
async function inbox(req, res, url){
  if (!SYNC) return send(res, 404, {error:'sync disabled'});
  try {
    if (url.pathname === '/api/assign' && req.method === 'POST') {
      let raw=''; for await (const c of req){ raw+=c; if (raw.length>20000) return send(res, 413, {error:'too large'}); }
      let body={}; try { body = JSON.parse(raw); } catch { body = {text: raw}; }
      const pass = req.headers['x-passcode'] || body.passcode;
      if (PASSCODE && pass !== PASSCODE) return send(res, 401, {error:'passcode'});
      const text = String(body.text||'').slice(0,2000);
      if (!/تعيين/.test(text)) return send(res, 200, {ok:false, message:'مو رسالة تكليف'});
      const item = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), text, ...parseAssign(text), at: new Date().toISOString() };
      await rpc('coach_inbox_add', {p_item: item});
      return send(res, 200, {ok:true, message: item.home ? `وصل تكليف: ${item.home} × ${item.away}` : 'وصل تكليف جديد'});
    }
    if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'});
    if (req.method === 'GET') return send(res, 200, await rpc('coach_inbox_get', {}));
    if (req.method === 'DELETE') return send(res, 200, await rpc('coach_inbox_remove', {p_id: url.searchParams.get('id')||''}));
    send(res, 405, {error:'method'});
  } catch (e) { console.error(e); send(res, 502, {error:'inbox failed'}); }
}

/* ---------- health: sleep and watch workouts from the iOS Shortcut ---------- */
// POST /api/health      the Shortcut sends what Apple Health has (see SHORTCUT.md)
// GET  /api/health      the app reads the last month back into its cache
// POST /api/health/ack  the referee answered the effort question for one workout
//
// The rows live in their own two tables (migrations/002_health.sql). The server
// reads the main state row only for the max heart rate the zones are cut from,
// and never writes it: that row has one writer, the app.
const H = require('./lib/health');
const missingFn = e => /PGRST202|Could not find the function|does not exist/i.test(String(e && e.message));

async function maxHrSetting(){
  try {
    const st = (await rpc('coach_get', {})) || {};
    const s = (st.data || st).settings || {};
    const n = Number(s.max_hr);
    return n >= 120 && n <= 230 ? n : H.MAX_HR_DEFAULT;
  } catch (e) { return H.MAX_HR_DEFAULT; }
}

// "ليلة واحدة · تمرينين" -- what the Shortcut shows on the phone when it finishes
function arCount(n, one, two, few, many){
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n <= 10 ? few : many}`;
}

async function health(req, res, url){
  if (!SYNC) return send(res, 404, {error:'sync disabled'});
  try {
    if (url.pathname === '/api/health' && req.method === 'POST') {
      let raw=''; for await (const c of req){ raw+=c; if (raw.length>3000000) return send(res, 413, {error:'too large'}); }
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, {error:'bad json', message:'الاختصار أرسل شي مو JSON'}); }
      // the Shortcut can carry the passcode in the body, like /api/assign
      // Shortcuts likes to nest the whole dictionary under one field ("data"), so
      // a body with nothing of ours at the top level is unwrapped one level
      if (body && body.data && typeof body.data === 'object' && !Array.isArray(body.data) &&
          !body.sleep && !body.nights && !body.workouts) body = { ...body.data, passcode: body.data.passcode ?? body.passcode };
      // a passcode typed as 1234 can arrive as a number, not text
      const given = req.headers['x-passcode'] || (body && body.passcode);
      const pass = clean(given == null ? '' : String(given));
      if (PASSCODE && pass !== PASSCODE) return send(res, 401, {error:'passcode', message:'رمز الدخول غلط'});
      const maxHr = await maxHrSetting();
      const { nights, workouts } = H.normalize(body, { maxHr, tz: TZ });
      if (!nights.length && !workouts.length) {
        console.log('health: a call arrived with nothing usable in it --', H.describe(body));
        return send(res, 200, {ok:true, nights:0, workouts:0, message:'وصل الاتصال، بس ما فيه نوم ولا تمارين'});
      }
      await rpc('coach_health_add', {p_nights: nights, p_workouts: workouts});
      console.log(`health: stored nights=${nights.length} workouts=${workouts.length} maxHr=${maxHr}`);
      const parts = [
        nights.length ? arCount(nights.length, 'ليلة واحدة', 'ليلتين', 'ليالي', 'ليلة') : '',
        workouts.length ? arCount(workouts.length, 'تمرين واحد', 'تمرينين', 'تمارين', 'تمرين') : ''
      ].filter(Boolean);
      return send(res, 200, {ok:true, nights:nights.length, workouts:workouts.length, message:`وصل ✅ ${parts.join(' · ')}`});
    }
    if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'});
    if (url.pathname === '/api/health/ack' && req.method === 'POST') {
      let raw=''; for await (const c of req){ raw+=c; if (raw.length>2000) return send(res, 413, {error:'too large'}); }
      let id=''; try { id = String(JSON.parse(raw).id || ''); } catch { return send(res, 400, {error:'bad json'}); }
      if (!/^w[0-9a-z]{1,16}$/.test(id)) return send(res, 400, {error:'bad id'});
      return send(res, 200, {ok: !!(await rpc('coach_health_ack', {p_id: id}))});
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const days = Math.max(1, Math.min(120, Number(url.searchParams.get('days')) || 31));
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const d = (await rpc('coach_health_get', {p_since: since})) || {};
      return send(res, 200, {nights: d.nights || [], workouts: d.workouts || [], last_at: d.last_at || null});
    }
    send(res, 405, {error:'method'});
  } catch (e) {
    if (missingFn(e)) {
      console.error('health: the coach_health_* functions are missing; run migrations/002_health.sql in Supabase');
      return send(res, 503, {error:'not_migrated', message:'قاعدة البيانات تحتاج ملف الترحيل 002'});
    }
    console.error('health failed', redact(e && e.message));
    send(res, 502, {error:'health failed'});
  }
}

/* ---------- reminders: web push, driven by an external cron hitting /api/cron ---------- */
const webpush = require('web-push');
const TZ = process.env.APP_TZ || 'Asia/Riyadh';
const CRON_TOKEN = clean(process.env.CRON_TOKEN);   // its own token: it travels in a URL to a third-party scheduler
// a stable pair from the environment survives restarts; a generated one only lasts
// until the next deploy, and the app re-subscribes when it sees the key change
let VAPID = { publicKey: process.env.VAPID_PUBLIC_KEY || '', privateKey: process.env.VAPID_PRIVATE_KEY || '' };
if (!VAPID.publicKey || !VAPID.privateKey) {
  VAPID = webpush.generateVAPIDKeys();
  console.log('generated a temporary VAPID pair; set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to keep reminders working across deploys');
}
webpush.setVapidDetails('mailto:coach@referee.app', VAPID.publicKey, VAPID.privateKey);

// what the clock says in the referee's own timezone
function localNow(){
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short', hourCycle:'h23'}).formatToParts(new Date());
  const g = t => (parts.find(x => x.type === t) || {}).value;
  return { date:`${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour'))*60 + Number(g('minute')), wd: g('weekday') };
}
const toMin = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm||'')); return m ? Number(m[1])*60 + Number(m[2]) : null; };
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// One reminder per kind per day. The cron may tick twice inside the 35-minute
// window, or miss one, so the log is what makes a tick idempotent.
//
// This used to be a bare Map in process memory, which worked until Render's free
// plan spun the instance down: the restart cleared it and the next tick re-sent a
// reminder the user had already read. It now lives in Supabase, with the Map kept
// in front of it as a same-process shortcut.
const sentLog = new Map();
async function alreadySent(key){
  if (sentLog.has(key)) return true;
  try {
    const r = await rpc('coach_sent_has', {p_key: key});
    // the RPC returns a boolean; older deployments without it fall through to the Map
    return r === true || (r && r.sent === true);
  } catch (e) {
    console.error('sent-log read failed, falling back to memory', redact(e && e.message));
    return false;
  }
}
async function markSent(key, date){
  sentLog.set(key, date);
  for (const [k,d] of sentLog) if (d < date) sentLog.delete(k);
  try { await rpc('coach_sent_mark', {p_key: key, p_date: date}); }
  catch (e) { console.error('sent-log write failed; a restart may repeat this reminder', redact(e && e.message)); }
}

const DEFAULTS = { ready:{on:true, time:'08:00'}, train:{on:true, time:'17:00'}, match:{on:true, before:120}, weekly:{on:true, day:6, time:'20:00'} };
const pref = (prefs, kind) => ({ ...DEFAULTS[kind], ...((prefs||{})[kind] || {}) });

// the coach writes the reminder itself, so it knows the plan, the weather and the load
const FALLBACK = {
  ready: 'صباح الخير 👋 عبّي فحص الجاهزية عشان أرتب لك تمرين اليوم.',
  train: 'وقت التمرين 💪 افتح الجدول وشوف تمرين اليوم.',
  match: 'مباراتك قربت ⚽ جهّز أغراضك واشرب ماء من الحين.',
  weekly: 'خلّص الأسبوع 📊 شوف ملخصك وخطة الأسبوع الجاي.'
};
const ASK = {
  ready: 'اكتب تنبيهًا صباحيًا قصيرًا يذكّره يعبّي فحص الجاهزية.',
  train: 'اكتب تنبيهًا قصيرًا يذكّره بتمرين اليوم، واذكر اسم التمرين، وإذا الجو حار اقترح وقتًا أنسب.',
  match: 'اكتب تنبيهًا قصيرًا قبل مباراته، يذكّره بالترطيب والتجهيز، واذكر وقت المباراة.',
  weekly: 'اكتب تنبيهًا قصيرًا بملخص أسبوعه: كم تمرين سوّى وكم مباراة، وكلمة تشجيع.'
};
async function line(kind, snapshot){
  if (!API_KEY || !KEY_OK) return FALLBACK[kind];
  try {
    const r = await askClaude({
      model: MODEL, max_tokens: 400, output_config: {effort:'low'},
      system: 'أنت مدرب لياقة ودود لحكم كرة قدم مساعد سعودي اسمه سعود. تكتب إشعار جوال واحد فقط: جملة أو جملتين بالعربية بلهجة سعودية دافئة، أقل من 120 حرفًا، وإيموجي واحد على الأكثر، والأرقام بالإنجليزي (0-9). لا تكتب عنوانًا ولا أقواسًا ولا شرحًا، النص المطلوب فقط.',
      messages: [{role:'user', content:[{type:'text', text:`${ASK[kind]}\n\nبياناته الآن:\n${JSON.stringify(snapshot)}`}]}]
    });
    if (!r.ok) return FALLBACK[kind];
    const t = (r.data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').trim();
    return t ? t.slice(0, 200) : FALLBACK[kind];
  } catch (e) { console.error('reminder text failed', redact(e && e.message)); return FALLBACK[kind]; }
}

async function push(sub, title, body, tag, url){
  try {
    await webpush.sendNotification(sub, JSON.stringify({title, body, tag, url}));
    return true;
  } catch (e) {
    const gone = e && (e.statusCode === 404 || e.statusCode === 410);
    console.error('push failed', e && e.statusCode, gone ? 'subscription expired; the app re-subscribes on next open' : redact(e && e.body || e && e.message));
    return false;
  }
}

// called by the external cron every few minutes; decides what is due and sends it
async function cron(req, res, url){
  const given = clean(url.searchParams.get('token'));
  if (!CRON_TOKEN || given !== CRON_TOKEN) {
    console.error(CRON_TOKEN
      ? `cron: token did not match (the stored one is ${CRON_TOKEN.length} characters, the call sent ${given.length})`
      : 'cron: CRON_TOKEN is not set, so no reminder can be sent');
    return send(res, 401, {error:'token'});
  }
  if (!SYNC) return send(res, 404, {error:'sync disabled'});
  let st;
  try { st = (await rpc('coach_get', {})) || {}; } catch (e) { console.error('cron read failed', redact(e && e.message)); return send(res, 502, {error:'read'}); }
  const data = st.data || st;
  const p = data && data.push;
  if (!p || !p.sub) { console.log('cron: tick, but reminders are not switched on in the app yet'); return send(res, 200, {ok:true, note:'no subscription'}); }
  const prefs = p.prefs || {};
  const now = localNow();
  const sessions = data.sessions || {}, matches = data.matches || [], logs = data.logs || {}, readiness = data.readiness || {};
  const today = sessions[now.date] || null;
  const due = [];                                            // fires inside a 35-minute window after the set time
  const within = t => t != null && now.min - t >= 0 && now.min - t < 35;

  const rp = pref(prefs, 'ready');
  if (rp.on && !readiness[now.date] && within(toMin(rp.time))) due.push(['ready', 'فحص الجاهزية', '/?tab=sched']);

  const tp = pref(prefs, 'train');
  const restDay = !today || today.type === 'rest' || today.type === 'match';
  if (tp.on && !restDay && !(logs[now.date] && logs[now.date].done) && within(toMin(tp.time))) due.push(['train', today.title || 'تمرين اليوم', '/?tab=sched']);

  const mp = pref(prefs, 'match');
  if (mp.on) for (const m of matches) {
    if (m.date !== now.date || !m.time) continue;
    const t = toMin(m.time); if (t == null) continue;
    if (within(t - Number(mp.before || 120))) due.push(['match', 'مباراة اليوم', '/?tab=sched']);
  }

  const wp = pref(prefs, 'weekly');
  if (wp.on && WD[Number(wp.day)] === now.wd && within(toMin(wp.time))) due.push(['weekly', 'ملخص الأسبوع', '/?tab=prog']);

  const fired = [];
  for (const [kind, title, link] of due) {
    const key = `${kind}:${now.date}`;
    if (await alreadySent(key)) continue;
    // claimed before sending, not after: if the push itself is slow and the cron
    // ticks again, the second tick must find this already taken
    await markSent(key, now.date);
    const snapshot = { today: now.date, session: today, matchesToday: matches.filter(m=>m.date===now.date), weekLogs: Object.keys(logs).filter(d=>d<=now.date).slice(-7).map(d=>({d, ...logs[d]})) };
    const body = await line(kind, snapshot);
    if (await push(p.sub, title, body, kind, link)) fired.push(kind);
  }
  const clock = `${String(Math.floor(now.min/60)).padStart(2,'0')}:${String(now.min%60).padStart(2,'0')}`;
  console.log(`cron: tick ${clock} sent=${fired.length ? fired.join('+') : 'none'}`);
  send(res, 200, {ok:true, at:`${now.date} ${clock}`, fired});
}

// a "does this work at all" button in the app
async function pushTest(req, res){
  if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'});
  let raw=''; for await (const c of req){ raw+=c; if (raw.length>20000) return send(res, 413, {error:'too large'}); }
  let sub; try { sub = JSON.parse(raw).subscription; } catch { return send(res, 400, {error:'bad json'}); }
  if (!sub || !sub.endpoint) return send(res, 400, {error:'no subscription'});
  const ok = await push(sub, 'جدول الحكم', 'التنبيهات شغّالة ✅', 'test', '/');
  send(res, ok ? 200 : 502, {ok});
}

const server = http.createServer(async (req, res) => {
  try { await route(req, res); }
  catch (e) { console.error('unhandled request error', redact(e && e.stack || e)); if (!res.headersSent) send(res, 500, {error:'server'}); else res.end(); }
});

async function route(req, res){
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state/enabled') return send(res, 200, {enabled: SYNC});
  if (url.pathname === '/api/state') return state(req, res);
  if (url.pathname === '/api/assign' || url.pathname === '/api/inbox') return inbox(req, res, url);
  if (url.pathname === '/api/health' || url.pathname === '/api/health/ack') return health(req, res, url);
  if (url.pathname === '/api/claude' && req.method === 'POST') return coach(req, res);
  if (url.pathname === '/api/push/key') return send(res, 200, {key: VAPID.publicKey});
  if (url.pathname === '/api/push/vapid') { if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, {error:'passcode'}); return send(res, 200, VAPID); }
  if (url.pathname === '/api/push/test' && req.method === 'POST') return pushTest(req, res);
  if (url.pathname === '/api/cron') return cron(req, res, url);
  if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  const base = path.basename(file), ext0 = path.extname(file).toLowerCase();
  if (!file.startsWith(PUBLIC) || PRIVATE.has(base) || base.startsWith('.') || ext0 === '.md' ||
      PRIVATE_DIRS.some(d => url.pathname === d || url.pathname.startsWith(d + '/')))
    return send(res, 403, 'forbidden', 'text/plain');
  if (url.pathname === '/' ) file = path.join(PUBLIC, 'index.html');
  serveFile(req, res, file, url.searchParams.has('v'));
}

function serveFile(req, res, file, hasVersion){
  fs.stat(file, (se, st) => {
    if (se || !st.isFile()){
      // unknown path: hand back the app so a deep link still boots
      const idx = path.join(PUBLIC,'index.html');
      if (file === idx) return send(res, 404, 'not found', 'text/plain');
      return serveFile(req, res, idx, false);
    }
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      const ext = path.extname(file).toLowerCase();
      const head = {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': cachePolicy(ext, file, hasVersion),
        'X-Content-Type-Options': 'nosniff'
      };
      const enc = COMPRESSIBLE.has(ext) ? pickEncoding(req) : null;
      const body = enc ? compressed(file, enc, data, st.mtimeMs) : null;
      if (body){
        head['Content-Encoding'] = enc;
        head['Vary'] = 'Accept-Encoding';
        head['Content-Length'] = body.length;
        res.writeHead(200, head); return res.end(body);
      }
      head['Content-Length'] = data.length;
      if (COMPRESSIBLE.has(ext)) head['Vary'] = 'Accept-Encoding';
      res.writeHead(200, head); res.end(data);
    });
  });
}

if (API_KEY && !KEY_OK) console.error('ANTHROPIC_API_KEY contains a character that cannot go in a header; the coach cannot call the API until it is re-entered');
process.on('unhandledRejection', e => console.error('unhandled rejection', redact(e && e.stack || e)));
server.listen(PORT, () => console.log('referee coach on :'+PORT));
