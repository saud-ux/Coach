# ARCHITECTURE — جدول الحكم (referee-coach)

Map of the app. **Current as of Phase 1** (the split into modules, WebP images, the new service
worker, and compression on the server). Sections 3, 6 and 7 — the state shape, the RPE scale and
readiness — describe behaviour that Phase 1 deliberately did not change.

Written in English on purpose: it is a developer map full of identifiers. All *user-facing* copy stays
Arabic / RTL / Saudi dialect, as the project rules require.

---

## 1. Files on disk

| File | Size | Role |
|---|---|---|
| `index.html` | 7 730 B · 119 lines | Markup only. Links two stylesheets and one entry module. |
| `css/tokens.css` | 1 974 B | Palette, dark-mode variants, base element styles, shadow/radius tokens. |
| `css/app.css` | 28 488 B | Every component rule, in the original cascade order. |
| `js/*.js` | 10 modules, 174 KB | The app. See §2. |
| `server.js` | 22 KB | Node `http` server, no framework. Static serving with brotli/gzip + 11 API routes. |
| `sw.js` | 6 310 B | Service worker: versioned shell cache, cache-first media, network-first `/api/state`, push. |
| `manifest.webmanifest` | 613 B | PWA manifest. `theme_color #1E6A43`, `background_color #F4F6F2`, `dir: rtl`, `lang: ar`. |
| `render.yaml` | 514 B | Render free-plan web service, region frankfurt, `healthCheckPath: /healthz`. |
| `package.json` | 309 B | Single dependency: `web-push@^3.6.7`. Node ≥ 20. `npm start` → `node server.js`. |
| `migrations/001_sent_log.sql` | — | The persisted reminder log. Run once in Supabase. |
| `icon-180/192/512.png`, `maskable-512.png` | — | App icons. |
| `img-<exercise>-flat.webp` (23 files) | 294 822 B | Flat-illustration style. |
| `img-<exercise>-photo.webp` (24 files) | 580 114 B | Photo style. |
| `README.md`, `ARCHITECTURE.md` | — | Docs. Not served: `server.js` refuses any `.md`. |

**Total exercise images: 874 936 B across 47 files** (was 1 353 843 B across 47 JPEGs — all were
640×482, so the saving is the WebP encoder, not resizing). Only the selected style is ever
downloaded, so the realistic worst case is roughly half of that.

### Image-set gap
`IMG` (`js/figures.js`) declares 24 exercises. **`backSprint` has a photo but no flat drawing** — the
file never existed. Before Phase 1 the entry pointed at a missing `img-backSprint-flat.jpg` and showed
a broken image when «رسم» was selected. Now `stylesFor()` derives the switcher from what actually
exists, so that one card offers صورة + مخطط only and falls back to the photo when the global setting
is «رسم». If a flat drawing for it is ever produced, dropping the file in and adding the entry to
`IMG` is the whole change.

---

## 2. The modules

Phase 1 split the single IIFE into native ES modules. No bundler, no build step: `index.html` loads
one entry module and the browser resolves the rest.

| File | Lines | Contents |
|---|---|---|
| `js/state.js` | 59 | Bottom of the graph, imports nothing. Dates (`iso parse addDays todayISO`, the four `Intl` formatters, `num`), `$`/`setStatus`, the `state` object, `save()`, and the `hooks` object other modules register into. |
| `js/storage-sync.js` | 139 | `initRuntime()` (the `window.claude` shim: `sample`, `db`, `user`, `RC_INBOX`), the `rt` coach handle, `adopt()`, and the two-phase load: `bootLocal()` then `syncRemote()`. |
| `js/figures.js` | 334 | All the inline-SVG artwork and the stick-figure rig, the per-exercise metadata (`D DOSE MUS IMG REST AFTER FLOW DIAGRAMS`), the rest timer, and the image helpers `mediaHTML/applyView/stylesFor/precacheSelectedStyle`. |
| `js/schedule.js` | 356 | The plan (`weekParams defaultSession ensureHorizon defDur`), matches, `renderSchedule`, `renderHero`, `openDay`, `openAddMatch`, `openAddTest`, and the assignment inbox. |
| `js/coach.js` | 283 | Readiness (`readyScore lighten renderReady`), `renderAlerts`, the weekly report, and chat (`RULES context send applyChanges renderChat`). |
| `js/progress.js` | 230 | Training load (`RPE dayLoad sumLoad loadStatus`), the Cooper chart, the career log, weather, the monthly report image, and the load/matches panels. |
| `js/quiz.js` | 212 | The 92-question bank, the daily question, the mock exam, per-article practice, and `renderLaw`. |
| `js/notifications.js` | 120 | Push subscription, the four reminder preferences, and `initNotifications()`. |
| `js/health.js` | 26 | Stub for Phase 3. Exports no-ops that `main.js` already calls. |
| `js/main.js` | 116 | The entry point: `openSheet/closeSheet`, `switchTab`, `scrollToday`, `renderAll`, `wire()`, and boot. |

### Import cycles, and why they are safe
`schedule`, `coach`, `progress` and `quiz` all import from `main.js` (for `openSheet`, `switchTab`,
`renderAll`) and from each other. ESM handles the cycles because every cross-module reference is a
**hoisted function declaration** and nothing is called while a module is still evaluating — the calls
all happen inside event handlers, long after the graph has loaded. `main.js` is the only module with
top-level side effects.

Two things make this work, and both will break silently if changed:

1. **`main.js` must be imported by exactly one URL.** The first attempt put `?v=11` on the
   `<script type="module">` tag while the modules imported each other by bare path. Those are two
   different module identities, so the browser loaded the entire graph **twice** and the second copy
   ran its boot code while `schedule.js` was still evaluating (`Cannot access 'BUILD' before
   initialization`). `index.html`, `sw.js` and the imports must all spell the path the same way.
2. **Reassigned values cannot be plain exports.** `state` is swapped wholesale by `adopt()`, so it is
   an exported `let` with a `setState()` beside it — reassignment has to happen in the module that
   declares it. `sampleFn` is reassigned after boot and on auth failure, so it became `rt.sample`, a
   property on an exported object. `VIEW` and `WX` are likewise reached through accessors.

### Render graph
`renderAll()` is the single entry point. It renders the "next match" header block inline, then calls:

`renderHero → renderReady → renderQuiz → renderAlerts → renderSchedule → renderCareer → renderLaw →
renderMonth → renderProgress → renderReport → renderLoad → renderMatches → renderChat → renderNotif`

Almost every mutation ends with `save(); renderAll();`. There is no diffing — every state change
re-renders all three tabs.

### Boot sequence (`js/main.js`)
Two phases, so a sleeping Render instance can no longer hold the app hostage.

**Phase one — synchronous, no network.**
`hooks.rerender = renderAll` → `initRuntime()` → register the service worker → `bootLocal()` (read
`localStorage`, `adopt()`, `ensureHorizon()`, mark loaded) → `wire()` → `initNotifications()` →
`renderAll()` → `scrollToday()` → `openDeepLinkTab()`.
After this the app is fully usable offline.

**Phase two — background, each piece independent.**
`syncRemote()` shows «يتم التحديث…», fetches `/api/state`, adopts it and re-renders; `loadWeather()`,
`loadInbox()`, `syncHealth()` and `precacheSelectedStyle()` run alongside it; `claude.use('sample')`
sets `rt.sample` and re-renders just the chat, report and alert strips.

`syncRemote()` keeps the old precedence — the server copy wins — with one addition: it counts edits
(`hooks.onDirty`) and skips the overwrite if the user changed something while the request was in
flight, so a snapshot taken before their edit cannot erase it.

> **Known limitation, unchanged from before Phase 1:** there is no timestamp or merge. Edits made on
> a *different* device while this one was offline are still lost when the server copy arrives. Giving
> `state` an `updated_at` and comparing would fix it, and is not in scope for these phases.

---

## 3. State shape

One object, `state`, declared at `js/state.js`. `v` is the schema version, currently **6**.

```js
state = {
  v: 6,

  // the plan. key = "YYYY-MM-DD". every day from PLAN_START to today+56 is filled by ensureHorizon().
  sessions: {
    "2026-10-01": {
      type:    "run|strength|intervals|yoyo|light|rest|recovery|test|match",
      title:   String,                   // Arabic, <=80 chars when written by the coach
      details: String,                   // Arabic multiline, <=800 chars when written by the coach
      orig?:   {type, title, details}    // set by lighten(); presence = "this day was softened"
    }
  },

  // matches. applyMatch() keeps at most one per date.
  matches: [{
    id:   "m" + base36 + rand,
    date: "YYYY-MM-DD",
    time: "HH:MM" | "",
    note: String,                        // built from comp/teams/venue by openAddMatch
    // all of the following are optional, written by bindMatchFields():
    comp?:  String,                      // competition
    home?:  String, away?: String,
    role?:  "0".."3" | "",               // index into ROLES
    venue?: String, crew?: String,
    score?: String,                      // assessor's mark, stored as a decimal string
    assess?: String,                     // assessor's notes
    link?:  String                       // assignment URL, carried over from the inbox
  }],

  // what actually happened. key = "YYYY-MM-DD".
  logs: {
    "2026-10-01": {
      done:   true,
      effort: 1..5 | null,               // the RPE input — see section 6
      dur:    Number,                    // minutes, clamped 0..240
      note:   String,
      watch?: {                          // filled by reading a watch screenshot with Claude
        duration_min, distance_km, avg_hr, max_hr, calories,   // Number | null
        summary: String                                        // <=200 chars Arabic
      },
      // match days only:
      legs?:    1..5 | null,             // 1 مرتاحة ... 5 منهكة
      weather?: 1..3 | null,             // 1 معتدل, 2 حار, 3 حار ورطب
      half?:    1..3 | null              // 1 ما تعبت, 2 الشوط الأول, 3 الشوط الثاني
    }
  },

  // Cooper test results. adopt() filters to kind === 'cooper' only.
  tests: [{ id: "t"+base36, kind: "cooper", date: "YYYY-MM-DD", value: Number /* metres */ }],

  // coach conversation. trimmed to the last 60 entries inside save().
  chat: [{
    role:     "user" | "assistant",
    content:  String,
    changes?: String,                    // "عدّلت ٣ أيام في الجدول" — rendered as a sub-label
    err?:     true                       // error bubbles are excluded from the history sent upstream
  }],

  // morning readiness check. key = "YYYY-MM-DD". see section 7.
  readiness: {
    "2026-10-01": { sleep: 1..5, sore: 1..5, energy: 1..5, skipped?: true }
  },

  // weekly coach reports. key = that week's SUNDAY in ISO form.
  reports: { "2026-09-27": { text: String, at: "YYYY-MM-DD" } },

  // laws quiz. quizState() resets the whole object if v !== 2.
  quiz: {
    v: 2,
    answers: { "<QUIZ index>": { pick: Number, ok: Boolean, date: "YYYY-MM-DD", extra: Boolean } },
    daily:   { "YYYY-MM-DD": <QUIZ index> },                   // which question was "today's"
    wrong:   { "<QUIZ index>": { n: Number, fix: Number } },    // drops out of the bank at fix >= 2
    exams?:  [{ date: "YYYY-MM-DD", right: Number, total: Number, secs: Number }]
  },

  settings: { city: "zulfi" | "riyadh" | "majmaah" },

  // web-push state. null until the user enables reminders.
  push: {
    sub: <PushSubscription.toJSON()>,
    prefs: {
      ready:  { on: Boolean, time: "HH:MM" },             // default 08:00
      train:  { on: Boolean, time: "HH:MM" },             // default 17:00
      match:  { on: Boolean, before: Number },            // minutes, default 120
      weekly: { on: Boolean, day: 0..6, time: "HH:MM" }   // default day 6 (Sat), 20:00
    }
  }
}
```

### `adopt()` is a whitelist — matters for Phase 3
`adopt(data)` (`js/storage-sync.js`) rebuilds `state` key by key. **Any top-level key not named there is
silently dropped**, including on backup import. Adding a new top-level key (e.g. `health`) in a later
phase means adding it to `adopt()` too, or it vanishes on the next load.

It bails out entirely when `!data.sessions`, which is also the validity check the import button relies on.

### Existing migration (`v < 6`)
When loading data stamped below 6, every session from today forward whose `type !== 'match'` is
**deleted**, `ensureHorizon()` refills it from the current template, and future matches are re-applied.
Past days are untouched. Any new migration must keep that "never rewrite history" rule.

### Save path
`save()` debounces 500 ms, then:
1. trims `state.chat` to 60,
2. deep-clones via `JSON.parse(JSON.stringify(state))`,
3. if `docRef` exists, chains `docRef.set(snap)` onto a serial promise (`saving`) → `PUT /api/state`,
4. always writes `localStorage[LS]` as well.

Status line shows `محفوظ` / `محفوظ في حسابك` / `محفوظ على هذا الجهاز` / `تعذّر الحفظ…`.

### Backup format
Export (`#expBtn`) is literally `JSON.stringify(state)`, filename `referee-backup-<today>.json`.
Import (`#impFile`) → `JSON.parse` → requires `d.sessions` → `adopt(d)` → `ensureHorizon()` → `save()`.
**This exact format must stay importable.**

---

## 4. localStorage keys

| Key | Written by | Value |
|---|---|---|
| `referee-coach-v1` | `save()` (`js/state.js`) | The whole `state`, JSON. The only key holding user data. |
| `rc-pass` | the `window.claude` shim (`js/storage-sync.js`) | The app passcode, captured by `prompt()` on the first 401 and replayed as the `X-Passcode` header. Also read directly by `#notifTest` and `#vapidBtn`. |
| `dg-view` | `setView()` (`js/figures.js`) | `"photo" \| "flat" \| "diagram"` — which exercise illustration style to show. Defaults to `"photo"`. This is the setting Phase 1 item 2 keys image loading off. |

Nothing else touches `localStorage`; there is no `sessionStorage` or IndexedDB use.

### Theme
`css/tokens.css` defines a full dark palette under both `@media (prefers-color-scheme: dark)` and
`:root[data-theme="dark"]`, and guards the media query with `:root:not([data-theme="light"])`.
**No JavaScript ever sets `data-theme`** — there is no toggle UI and no stored preference. The hooks
are inert scaffolding, which is exactly what Phase 2 has to preserve.

---

## 5. Server: routes, env, and the Supabase layer

### Routes (`route()`, server.js:270)

| Route | Method | Auth | Behaviour |
|---|---|---|---|
| `/api/state/enabled` | GET | none | `{enabled: SYNC}`. Lets the client decide whether cloud sync exists. |
| `/api/state` | GET | `X-Passcode` | `rpc('coach_get')` → the stored state row. 404 when sync is disabled. |
| `/api/state` | PUT | `X-Passcode` | Body `{data:{…}}`, ≤5 MB → `rpc('coach_put', {p_data})` → `{updated_at}`. |
| `/api/assign` | POST | `X-Passcode` **or** `passcode` in the body | For iOS Shortcuts. Body `{text}` ≤2 000 chars, request ≤20 KB. Requires the text to contain `تعيين`, else `{ok:false}`. `parseAssign()` pulls the first URL and a `مباراة A × B` pattern → `rpc('coach_inbox_add')`. |
| `/api/inbox` | GET | `X-Passcode` | `rpc('coach_inbox_get')`. |
| `/api/inbox?id=` | DELETE | `X-Passcode` | `rpc('coach_inbox_remove', {p_id})`. |
| `/api/claude` | POST | `X-Passcode` + rate limit | The coach proxy. See below. |
| `/api/push/key` | GET | none | `{key: VAPID.publicKey}`. |
| `/api/push/vapid` | GET | `X-Passcode` | Both VAPID keys, so the app can display them for pasting into Render env vars. |
| `/api/push/test` | POST | `X-Passcode` | Body `{subscription}` → one test notification. |
| `/api/cron?token=` | GET | `?token=` must equal `CRON_TOKEN` | The reminder tick. See section 8. |
| `/healthz` | GET | none | `ok`, text/plain. Render's health check. |
| anything else | GET | none | Static file from `__dirname`. SPA fallback: a miss serves `index.html` with status 200. |

### Static serving (`serveFile()`)
- Path traversal is blocked (`file.startsWith(PUBLIC)`), plus a `PRIVATE` deny-set, dotfiles, **any
  `.md`**, and the `PRIVATE_DIRS` list (`/migrations`, `/node_modules`, `/.git`). Docs and SQL are
  refused by rule rather than by name, so a new one is private the moment it is written.
- **Compression**: brotli (quality 5) or gzip for `.html .js .mjs .css .json .webmanifest .svg .txt`,
  chosen from `Accept-Encoding`, with `Vary: Accept-Encoding`. Each result is compressed once and kept
  in memory keyed by path + encoding + mtime; a result that came out larger than the original is
  discarded. Images and fonts are skipped — they are already compressed.
- **`Cache-Control`**, in order:
  - `.html` and `sw.js` → `no-cache`
  - any URL with a `?v=` query → `public, max-age=31536000, immutable`
  - `.js`, `.mjs`, `.css` without `?v=` → `no-cache`, because the service worker is the real cache and
    being able to ship a fix beats saving a 304
  - everything else (images, icons) → `public, max-age=604800`
- `X-Content-Type-Options: nosniff` on every static response.
- `TYPES` covers `.html .js .mjs .css .webmanifest .json .png .jpg .jpeg .webp .svg .ico .woff2 .txt`.

### `/api/claude` (`coach()`, server.js:59)
Passcode → per-IP rate limit (**30 calls / 10 min**, in-memory `Map`) → key sanity checks → read body
(≤8 MB) → normalise `messages` (whitelist `text` and base64 `image` blocks; merge consecutive same-role
turns; force a leading `user` turn) → `askClaude()`. The response is flattened to `{text, stop_reason}`;
an empty `text` becomes a 502 `truncated`.

`askClaude()` retries **once** on a network blip, a 429, or a 5xx. Errors map to
`bad_api_key | upstream_rate | upstream_down | bad_request | timeout | network`, which the client turns
into Arabic sentences (`js/coach.js`).

### Environment variables

| Var | Default | Used for | In `render.yaml`? |
|---|---|---|---|
| `PORT` | `3000` | listen port | Render supplies it |
| `ANTHROPIC_API_KEY` | — | the coach. Whitespace-stripped; must be printable ASCII | yes, `sync: false` |
| `APP_PASSCODE` | — | `X-Passcode` on every protected route | yes, `sync: false` |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | model id | yes, `claude-sonnet-5-5` |
| `CLAUDE_MAX_TOKENS` | `8000` | per coach call | no |
| `CLAUDE_EFFORT` | `low` | `output_config.effort`; `off` omits it | no |
| `CLAUDE_TIMEOUT_MS` | `90000` | upstream abort | no |
| `SUPABASE_URL` | — | sync + inbox + cron | **no — missing** |
| `SUPABASE_KEY` | — | ditto | **no — missing** |
| `SYNC_TOKEN` | — | passed as `p_token` to every RPC | **no — missing** |
| `APP_TZ` | `Asia/Riyadh` | the cron's idea of "now" | no |
| `CRON_TOKEN` | — | `/api/cron?token=`; separate because it travels in a URL to a third-party scheduler | yes, `sync: false` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated per boot | web push. A generated pair dies on every deploy; the client detects the change and re-subscribes | yes, both `sync: false` |

`SYNC = !!(SUPABASE_URL && SUPABASE_KEY && SYNC_TOKEN)`. With any one missing, `/api/state`,
`/api/inbox`, `/api/assign` and `/api/cron` all return 404 and the app silently falls back to
localStorage-only.

### Supabase RPCs in use
All called as `POST {SB_URL}/rest/v1/rpc/<fn>` with header `apikey: SB_KEY` and body
`{p_token: SYNC_TOKEN, ...args}`:

- `coach_get()` → the state row (the server reads `st.data || st`)
- `coach_put(p_data)` → returns a timestamp
- `coach_inbox_add(p_item)`
- `coach_inbox_get()`
- `coach_inbox_remove(p_id)`

There is **no `migrations/` directory in the repo** — the SQL behind these five functions exists only in
the Supabase project. Phase 1 adds `migrations/001_sent_log.sql`, Phase 3 adds `migrations/002_health.sql`.

---

## 6. The effort / RPE scale used by `dayLoad()`

This is the number Phase 2's 1–10 picker and Phase 3's watch import have to map onto, so it is spelled
out exactly.

### Input: `effort`, an integer 1–5
Collected in `openDay()` from a five-button row labelled by `EFFORT` (`js/schedule.js`):

| `log.effort` | Label | Meaning |
|---|---|---|
| 1 | سهل جدًا | very easy |
| 2 | سهل | easy |
| 3 | متوسط | moderate |
| 4 | صعب | hard |
| 5 | مرهق | exhausting |

On match days the question is relabelled «كيف كان جهد المباراة؟» but the scale is identical.

### The lookup table
```js
const RPE = [0, 2, 4, 6, 8, 10];     // `js/progress.js`
```
`RPE` is indexed by `effort`, not by RPE value — slot 0 is unused padding:

| `effort` | `RPE[effort]` |
|---|---|
| 1 | 2 |
| 2 | 4 |
| 3 | 6 |
| 4 | 8 |
| 5 | 10 |

So it is a **1–5 user scale projected onto the even numbers of a 0–10 RPE axis**.

### The computation
```js
function defDur(d, s) {                                    // `js/schedule.js`
  if (!s) return 0;
  if (s.type === 'run') return weekParams(d).run;          // 25–45, from the plan's week
  return ({ strength:35, intervals:35, yoyo:40, light:20,
            recovery:25, rest:0, test:25, match:105 })[s.type] ?? 30;
}

function dayLoad(d) {                                      // `js/progress.js`
  const l = state.logs[d];
  if (!l || !l.done) return 0;                             // unlogged days contribute nothing
  const dur = l.dur ?? defDur(d, state.sessions[d]);
  return dur * RPE[l.effort || 3];                         // effort missing => treated as 3 => x6
}
```

**`load = minutes × RPE[effort]`.** Units are arbitrary "load points".
A logged 35-minute intervals session at effort 4 scores `35 × 8 = 280`.

Two defaults to respect: a missing `dur` falls back to `defDur()`, and a missing `effort` is
**treated as 3 (×6)**, not as zero.

### Where load is consumed
- `sumLoad(from, to)` — inclusive day-by-day sum.
- `loadStatus()` (`js/progress.js`) — the ACWR:
  - `acute` = `sumLoad(today-6, today)` (7-day window)
  - `chronic` = `sumLoad(today-27, today) / 4` (28-day window, averaged to a weekly figure)
  - `ratio` = `acute / chronic`, or `null` when `chronic === 0`
  - `enough` = there is a `done` log at least 14 days old; until then the UI shows «بيانات غير كافية»
  - bands: `> 1.5` → «خطر إرهاق» (red) · `> 1.3` → «انتبه» (yellow) · `0.8 – 1.3` → «منطقة آمنة» (green)
    · `< 0.8` → «حمل منخفض» (yellow)
- `renderLoad()` — six-week bar chart plus the ratio gauge.
- `renderAlerts()` — raises a banner above `ratio > 1.3` with a «خفّف جدولي» button that messages the coach.
- `weekSummary()` / `genReport()` / `context()` — load and `loadStatus()` go into the coach's prompt.
- `monthStats()` — sums `l.dur ?? defDur()` for the monthly minutes figure (minutes only, no RPE).

### Phase-2 mapping note
A 1–10 picker maps onto this scale as `effort = Math.round(answer / 2)` clamped to 1–5 — the exact
inverse of `RPE`, so `dayLoad()` keeps producing the same numbers for the same perceived effort.
Storing a finer-grained value in `effort` would change every historical ACWR comparison and must not
happen silently. If Phase 2 wants to keep the 1–10 answer verbatim, store it in a **separate** field
(e.g. `rpe10`) and keep writing the derived 1–5 into `effort`.

---

## 7. How readiness is computed

### Input: three questions, each 1–5
Asked conversationally in `renderReady()` from `RQ2` (`js/coach.js`), as emoji buttons inside a chat
bubble. The flat labels in `RQ` (`js/coach.js`) are the same scale in plain words.

| Key | Question | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| `sleep` | كيف نمت البارح؟ | 😫 سيء جدًا | 😕 سيء | 😐 عادي | 🙂 زين | 😴 نمت عدل |
| `sore` | ورجولك اليوم؟ فيها شد أو ألم؟ | 🥵 توجعني | 😣 فيها شد | 😐 خفيف | 🙂 بسيط | 💪 ولا شي |
| `energy` | وطاقتك؟ كيف تحس نفسك؟ | 🪫 منهك | 😮‍💨 تعبان | 😐 عادي | ⚡ نشيط | 🔥 مولّع |

Higher is always better. The three answers are written to `state.readiness[today]` only once **all
three** are answered; partial answers live in the module-level `rStep` scratch object and are lost on
reload.

### The score
```js
const readyScore = r => (r.sleep + r.sore + r.energy) / 3;    // `js/coach.js`
```
An unweighted mean of three 1–5 answers → a **float in [1, 5]**. Displayed as a percentage:
`Math.round(score / 5 * 100)` — so the floor of the gauge is 20%, not 0%.

```js
const readyLabel = sc =>                                       // `js/coach.js`
  sc >= 4 ? ['جاهز تمامًا',     'var(--pitch)']   // fully ready, green
: sc >= 3 ? ['جاهزية متوسطة',  '#C99A1E']        // moderate, amber
:           ['جاهزية منخفضة',  'var(--red)'];    // low, red
```

### What the score drives

1. **Automatic downgrade.** When the third answer lands, if `readyScore < 2.5` **and** today's session
   type is in `HARD` (`run strength intervals yoyo test`), `lighten(today, true)` fires immediately.
2. **`lighten(d, toRecovery)`** (`js/coach.js`) — never touches `test` days. It stashes the old
   `{type,title,details}` under `sessions[d].orig` and replaces the day with either
   - `toRecovery` → `type:'recovery'`, «استشفاء (جاهزيتك منخفضة)», or
   - otherwise → `type:'light'`, «نسخة خفيفة: <original title>», with the original details appended.

   `restoreOrig(d)` puts `orig` back. The presence of `orig` is what the UI reads as "today was
   softened", and what the «رجّع التمرين الأصلي» button undoes.
3. **Manual buttons.** With no `orig` yet, a HARD non-test day, and `score < 4`, the card offers
   «حوّل اليوم لاستشفاء» when `score < 2.5`, otherwise «خفّف تمرين اليوم».
4. **Coach copy.** `coachReply(today, r)` (`js/coach.js`) composes one Arabic line from the score plus
   today's/tomorrow's match, whether the session was softened, and two extra nudges:
   `sleep <= 2` → «وحاول تنام بدري الليلة»; `sore <= 2` with no match today → «ورجولك تحتاج مشي خفيف وإطالة».
5. **Prompt context.** The last 7 days of raw `readiness` entries go into `context()` for `/api/claude`,
   and `weekSummary()` averages them into the weekly report. `monthStats()` averages them into the
   monthly percentage.
6. **The cron's morning reminder** is suppressed once `readiness[today]` exists (`server.js`).
7. **`readiness[today].skipped`** is a separate flag unrelated to the score: set when the user answers
   «ما لحقت» to the evening "did you train?" follow-up, which stops the card re-asking.

### Phase-3 note
Phase 3 adds the sleep score as a fourth input. `readyScore` is currently a plain mean of three values
that the UI also renders as `/5`, so a new input either arrives on the same 1–5 axis or the function
becomes an explicit weighted sum — and the historical entries in `state.readiness` (which only ever have
the three keys) must keep scoring the same way.

---

## 8. Reminders: how a push actually happens

1. The user taps «فعّل التنبيهات» → `Notification.requestPermission()` → `subscribePush()`:
   `GET /api/push/key`, compares the current subscription's `applicationServerKey` against it,
   unsubscribes and re-subscribes if the server's VAPID pair changed, then stores `sub.toJSON()` in
   `state.push.sub` and saves — which pushes it to Supabase via `PUT /api/state`.
   `installed()` exists because iOS only allows push from a home-screen-installed PWA.
2. An **external** scheduler hits `GET /api/cron?token=…` every few minutes. Nothing in this repo
   schedules it.
3. `cron()` reads the state row with `coach_get`, takes `data.push.sub` and `data.push.prefs`, computes
   `localNow()` in `APP_TZ`, and collects what is due. The window is `now - target ∈ [0, 35)` **minutes**
   (`within()`), which tolerates a missed tick.
   - `ready` — if `!readiness[today]`
   - `train` — if today exists, is not `rest`/`match`, and `!logs[today].done`
   - `match` — for each match today, `mp.before` minutes (default 120) before kickoff
   - `weekly` — on `prefs.weekly.day`
4. Dedupe: `alreadySent('<kind>:<date>')` against the in-memory `sentLog` Map.
5. The notification *text* is written by Claude per tick (`line(kind, snapshot)`, `max_tokens: 400`,
   `effort: 'low'`; snapshot = today's session + today's matches + the last 7 logs), with a hardcoded
   Arabic `FALLBACK` when the API is unavailable.
6. `webpush.sendNotification()`. A 404/410 is logged as an expired subscription; the client re-subscribes
   on next open.
7. `sw.js`'s `push` handler shows it; `notificationclick` focuses an existing window and navigates to
   `data.url` (`/?tab=sched` or `/?tab=prog`) rather than opening a second copy. The client reads
   `?tab=` on boot (`js/main.js`).

### The `sentLog` bug (Phase 1 item 5)
```js
const sentLog = new Map();                                     // `server.js`
function alreadySent(key){ return sentLog.has(key); }
function markSent(key, date){ sentLog.set(key, date); for (const [k,d] of sentLog) if (d < date) sentLog.delete(k); }
```
Process memory only. Render's free plan spins the instance down when idle and restarts it on the next
request, which cleared the Map — so the very next cron tick inside the same 35-minute window re-sent a
reminder the user had already read.

**Fixed in Phase 1.** `alreadySent()` and `markSent()` are now `async` and go through two new RPCs,
`coach_sent_has` and `coach_sent_mark`, with the Map kept in front as a same-process shortcut. The key
is claimed *before* the push is sent, not after, so a second tick arriving while the first is still
working finds it taken. If the RPCs are missing or reject the token the server logs
`sent-log read failed, falling back to memory` and behaves as it did before — degraded, not broken.
The SQL is in `migrations/001_sent_log.sql`; read the note at the bottom of that file about how the
token check must match your existing `coach_get`/`coach_put`.

---

## 9. Service worker

```js
const VERSION = '11';
const SHELL = `shell-v${VERSION}`;   // html, css, js, icons — replaced every release
const MEDIA = 'media-v1';            // exercise images — survives releases, keyed by filename
const API   = 'api-v1';              // the last good /api/state
```

Three caches on purpose: a release should not throw away the images or the last known state.

- **install** — precaches the whole shell: `/`, `/index.html`, both stylesheets, **all ten JS modules**,
  the manifest, two icons and the Google Fonts stylesheet. Added one at a time rather than with
  `addAll()`, because `addAll()` rejects the entire batch if any single request fails and a
  third-party font URL is exactly the kind of request that fails.
  The module list must be complete: one missing import takes the whole graph down offline.
- **activate** — deletes any cache not in the current three, then `clients.claim()`.
- **message** — the page posts `{type:'precache-style', urls:[…]}` with the files for the *selected*
  illustration style only. The worker skips anything it already holds, so switching styles back and
  forth costs nothing and the unselected style is never fetched until it is actually shown.
- **fetch**
  - `/api/state` → **network first**, falling back to the cached copy. This is what lets the app open
    fully populated while the server is still waking up.
  - every other `/api/` path → not intercepted (they mutate or are per-moment).
  - navigations → **cache first**, with a background refresh. The first paint never waits on the network.
  - `img-*.webp` → cache first, into `MEDIA`.
  - `/css/`, `/js/`, icons, manifest, `fonts.g*` → cache first, into `SHELL`.
  - anything else (the weather API) → straight to the network.
- **push / notificationclick** — unchanged from before.

**Bump `VERSION` whenever a shell file changes**, and keep the `?v=` on the two stylesheet links in
`index.html` in step with it. The entry module is deliberately *not* versioned — see §2.

> **Not verified in this environment.** The embedded browser used during development refuses to
> register any service worker at all (a one-line worker fails identically), so install, precache and
> offline behaviour were not exercised. The routing predicates are unit-tested against 15 URLs, and
> the rest is checked in Phase 4's cold-start test on a real browser.

---

## 10. First-load transfer budget

Measured over the wire against the running server, like for like.

| Asset | Before | After |
|---|---|---|
| `index.html` | 213 115 | 2 666 |
| `css/tokens.css` | — | 870 |
| `css/app.css` | — | 6 195 |
| `js/` (10 modules) | — | 64 850 |
| `manifest.webmanifest` | 613 | 287 |
| `sw.js` | 2 160 | 2 383 |
| `icon-192.png` | 4 943 | 4 943 |
| `icon-180.png` | 4 683 | 4 683 |
| **Total same-origin** | **225 514** | **86 877** |

**A 61% reduction (138 637 bytes).** Two causes: the server now sends brotli for html/css/js/json,
and the single 213 KB file became markup plus modules the service worker can keep.

Fonts, cross-origin and not in the table: the request dropped from five weights to the four the app
actually uses, and it no longer blocks the first paint.

Images are still not part of the first load — they are fetched when a session sheet opens. What
changed is that a sheet now pulls **one file per card instead of two**: previously both styles sat in
the DOM with one hidden, and `loading="lazy"` was the only thing holding the second back. A seven-card
strength session went from fourteen possible JPEGs to seven WebPs.

---

## 11. Phase 1: what changed, and what to watch

Done:
1. `index.html` split into markup, two stylesheets and ten ES modules; behaviour identical.
2. All 47 images converted to WebP; only the selected style is requested, with `loading="lazy"`,
   `decoding="async"` and explicit `width`/`height` so cards do not shift as they load.
3. Service worker rewritten: three versioned caches, full shell precache, cache-first media,
   network-first `/api/state`, and style precaching driven by the app.
4. `server.js`: brotli/gzip for text, `.css`/`.webp`/`.woff2` MIME types, `immutable` for `?v=` assets,
   `no-cache` for js/css (the worker is the real cache), and `.md` plus `migrations/` refused.
5. The reminder send-log moved from process memory into Supabase — `migrations/001_sent_log.sql`.
6. The coach chat shows an animated typing indicator, and the heavy re-render is deferred a frame so
   the reply paints first.

Still true, and worth keeping in mind:

- **`adopt()` is a whitelist.** A new top-level state key is dropped on load and on backup import
  unless it is added there. This is the single most important line for Phase 3.
- **`localStorage['referee-coach-v1']` and the export shape are frozen.** Verified in Phase 1 with a
  full round-trip of a pre-split backup: every key, nested `watch`/`quiz.wrong`/`quiz.exams`/
  `push.prefs` object and the non-Cooper test filter all behave exactly as before.
- **`state.v` is still 6.** Nothing in Phase 1 changed the shape, so no migration was needed.
- **One URL per module** (§2) and **reassigned values need accessors** (§2).
- **`VERSION` in `sw.js` and `?v=` in `index.html` must move together.**
- **Phase 2** should keep the `data-theme` hooks in `css/tokens.css`; they are still inert and still
  the place a light theme would attach.
- **Phase 2's 1–10 effort picker** maps to the stored 1–5 as `Math.round(answer/2)` clamped to 1–5
  (§6). Anything finer belongs in a new field, not in `effort`.
