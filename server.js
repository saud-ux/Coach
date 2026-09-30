// جدول الحكم — static app + a small proxy to the Claude API for the coach
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// strip every space and line break: an API key never contains whitespace, and a key
// pasted wrapped across lines makes fetch throw "invalid header value", which used
// to surface in the app as a bare connection error
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').replace(/\s+/g, '');
const KEY_OK = /^[\x21-\x7e]+$/.test(API_KEY);   // printable ASCII, no spaces or newlines
// never let a key reach the logs
const redact = v => String(v == null ? '' : v).replace(/sk-ant-[A-Za-z0-9_\-]+/g, 'sk-ant-***');
const PASSCODE = process.env.APP_PASSCODE || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 8000;
const EFFORT = process.env.CLAUDE_EFFORT || 'low';            // low|medium|high|xhigh|max, or 'off' to omit
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 90000;
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_KEY, SYNC_TOKEN = process.env.SYNC_TOKEN;
const SYNC = !!(SB_URL && SB_KEY && SYNC_TOKEN);
const PUBLIC = __dirname;
const PRIVATE = new Set(['server.js','package.json','render.yaml','README.md','.gitignore']);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

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

const server = http.createServer(async (req, res) => {
  try { await route(req, res); }
  catch (e) { console.error('unhandled request error', redact(e && e.stack || e)); if (!res.headersSent) send(res, 500, {error:'server'}); else res.end(); }
});

async function route(req, res){
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state/enabled') return send(res, 200, {enabled: SYNC});
  if (url.pathname === '/api/state') return state(req, res);
  if (url.pathname === '/api/assign' || url.pathname === '/api/inbox') return inbox(req, res, url);
  if (url.pathname === '/api/claude' && req.method === 'POST') return coach(req, res);
  if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC) || PRIVATE.has(path.basename(file)) || path.basename(file).startsWith('.')) return send(res, 403, 'forbidden', 'text/plain');
  if (url.pathname === '/' ) file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { fs.readFile(path.join(PUBLIC,'index.html'), (e2, d2) => e2 ? send(res,404,'not found','text/plain') : send(res,200,d2,TYPES['.html'])); return; }
    const ext = path.extname(file);
    const cache = ext==='.html'||file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=604800';
    res.writeHead(200, {'Content-Type': TYPES[ext]||'application/octet-stream', 'Cache-Control': cache}); res.end(data);
  });
}

if (API_KEY && !KEY_OK) console.error('ANTHROPIC_API_KEY contains a character that cannot go in a header; the coach cannot call the API until it is re-entered');
process.on('unhandledRejection', e => console.error('unhandled rejection', redact(e && e.stack || e)));
server.listen(PORT, () => console.log('referee coach on :'+PORT));
