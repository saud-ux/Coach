# ARCHITECTURE — جدول الحكم (referee-coach)

Map of the app as it exists **before** Phase 1. Nothing described here has been changed.

Written in English on purpose: it is a developer map full of identifiers. All *user-facing* copy stays
Arabic / RTL / Saudi dialect, as the project rules require.

---

## 1. Files on disk

| File | Size | Role |
|---|---|---|
| `index.html` | 213 115 B · 2 004 lines | **Everything client-side**: markup, all CSS (lines 18–405), the standalone runtime shim (493–544), and the whole app (545–2002) in one IIFE. |
| `server.js` | 19 711 B | Node `http` server, no framework. Static file serving + 11 API routes. |
| `sw.js` | 2 160 B | Service worker: cache `referee-coach-v10`, push receiver, notification-click router. |
| `manifest.webmanifest` | 613 B | PWA manifest. `theme_color #1E6A43`, `background_color #F4F6F2`, `dir: rtl`, `lang: ar`. |
| `render.yaml` | 514 B | Render free-plan web service, region frankfurt, `healthCheckPath: /healthz`. |
| `package.json` | 309 B | Single dependency: `web-push@^3.6.7`. Node ≥ 20. `npm start` → `node server.js`. |
| `icon-180/192/512.png`, `maskable-512.png` | — | App icons. |
| `img-<exercise>-flat.jpg` (24 files) | 520 954 B | Flat-illustration style. |
| `img-<exercise>-photo.jpg` (25 files) | 832 889 B | Photo style. |
| `README.md` | 1 233 B | Arabic: deploy + data-transfer instructions. |

**Total exercise images: 1 353 843 B across 49 files.**

### Image-set gap (pre-existing, to fix in Phase 1)
`IMG` (index.html:930) declares 24 exercises, each with a `flat` and a `photo` entry — 48 paths.
`img-backSprint-flat.jpg` **does not exist on disk** even though `IMG.backSprint.flat` points at it.
Today that only shows as a broken image when the user picks the «رسم» view on the back-sprint card.

---

## 2. Modules inside `index.html`

The single IIFE has no module boundaries, but the code is already grouped by banner comments.
These groups are the natural Phase-1 split:

| Lines | Banner | Contents | Phase-1 target |
|---|---|---|---|
| 18–405 | — | All CSS. Two layers: the original palette/components, then a `/* ===== design refresh ===== */` block (~337–405) that overrides borders → shadows, bumps radii, floats the tab bar. | `css/tokens.css` + `css/app.css` |
| 408–491 | — | Body markup: header, three `<section>` tabs (`#sched`, `#chat`, `#prog`), composer, `nav.tabs`, `#timer`, `#scrim`/`#sheet`. | `index.html` |
| 493–544 | standalone runtime | `window.claude` shim: `api()` (passcode retry loop), `toB64()`, `call()`, `sample` / `sample.json` / `sample.limits`, `db.doc()`, `user.id()`, `window.RC_INBOX`, `hasSync()`. Also registers the SW. | `js/storage-sync.js` |
| 547–558 | dates | `pad iso parse addDays todayISO`, the three `Intl.DateTimeFormat`s (`fWd fDm fFull`), `num()`, `PLAN_START`. | `js/state.js` |
| 560–621 | plan | `TYPES HARD STRENGTH BUILD CYCLE weekParams defaultSession ensureHorizon buildDefaults`. | `js/schedule.js` |
| 623–669 | state + storage | `state`, `LS`, `$`, `setStatus`, `save()`, `adopt()`, `initStorage()`. | `js/state.js` + `js/storage-sync.js` |
| 671–691 | matches | `applyMatch() removeMatch()`. | `js/schedule.js` |
| 693–747 | render: schedule | `TICON`, `viewWeek`, `renderSchedule()` (week nav, day strip, progress bar, day rows, swipe). | `js/schedule.js` |
| 749–757 | sheets | `openSheet() closeSheet()`, scrim/Escape handlers, `EFFORT` labels. | `js/main.js` |
| 759–988 | diagrams | ~230 lines of SVG: `svg() ln cv cone me tf tp`, the stick-figure rig (`pose place onGround taper bt band leg arm fig`), `FIG` (19 poses), `LEGEND`, `D` (25 exercise descriptors), `DOSE MUS IMG VIEW REST AFTER WARM_REST FLOW`, rest timer (`startTimer stopTimer beep`), `restHTML flowHTML nextHTML DIAGRAMS`. | `js/figures.js` |
| 990–1167 | — | `openDay()` (the big session sheet), `parseAssignText() openAddMatch()`, inbox (`INBOX loadInbox renderInbox`), `openAddTest()`. | `js/schedule.js` + `js/main.js` |
| 1169–1205 | progress | `chart() renderProgress()`. | `js/progress.js` |
| 1207–1221 | training load | `RPE defDur dayLoad sumLoad loadStatus`, `LEGS WEA HALF`. | `js/progress.js` |
| 1223–1304 | readiness | `RQ readyScore readyLabel lighten restoreOrig RQ2 greet coachReply bubble renderReady`. | `js/coach.js` |
| 1306–1322 | hero | `renderHero()`. | `js/schedule.js` |
| 1324–1512 | laws quiz bank | `QCAT`, `QUIZ` (**92 questions**), `qRef dayHash quizState recordAnswer quizOf shuffled qBlock renderQuiz openExam openPractice`. | `js/quiz.js` |
| 1514–1561 | career log | `ROLES seasonOf renderCareer matchFieldsHTML bindMatchFields`. | `js/progress.js` |
| 1563–1583 | weather | `CITIES WX loadWeather hr12 renderWx`. Calls Open-Meteo **directly from the browser**, not through our server. | `js/progress.js` |
| 1585–1594 | — | `renderLaw()`. | `js/quiz.js` |
| 1596–1664 | monthly report | `fMon monthSel monthStats renderMonth drawMonth` (1080×1350 canvas PNG for sharing). | `js/progress.js` |
| 1666–1690 | alerts + report prompt | `renderAlerts()`. | `js/coach.js` |
| 1692–1738 | weekly report | `weekSummary genReport renderReport`. | `js/coach.js` |
| 1740–1766 | load + matches panels | `renderLoad() renderMatches()`. | `js/progress.js` |
| 1768–1863 | chat | `sampleFn busy ctl`, `RULES` (system prompt), `context() renderChat() applyChanges() send()`, the error-code → Arabic message table, quick chips. | `js/coach.js` |
| 1865–1881 | tabs + boot | `switchTab() scrollToday()`, all top-level `onclick` wiring, export/import, city select. | `js/main.js` |
| 1882–1985 | reminders | `PUSH_DEF prefsOf installed b64 subscribePush renderNotif savePrefs`, notif buttons, VAPID-key reveal, `?tab=` deep link. | `js/notifications.js` |
| 1987–2001 | — | `renderAll()` and the boot sequence. | `js/main.js` |
| — | — | *(does not exist yet)* | `js/health.js` — empty stub in Phase 1, filled in Phase 3 |

### Render graph
`renderAll()` is the single entry point. It renders the "next match" header block inline, then calls:

`renderHero → renderReady → renderQuiz → renderAlerts → renderSchedule → renderCareer → renderLaw →
renderMonth → renderProgress → renderReport → renderLoad → renderMatches → renderChat → renderNotif`

Almost every mutation ends with `save(); renderAll();`. There is no diffing — every state change
re-renders all three tabs.

### Boot sequence (index.html:2000–2002)
1. `ensureHorizon(); renderAll(); requestAnimationFrame(scrollToday);` — paints immediately from the
   in-memory default state (empty), before storage is read.
2. `initStorage()` — reads `localStorage`, then `await`s `/api/state/enabled` + `GET /api/state`.
   **This is the blocking step that makes a cold Render instance feel broken**: the shell has already
   painted, but the real schedule only appears after the round trip. Then `loadInbox()`
   (`GET /api/inbox`) and `loadWeather()` (Open-Meteo).
3. `claude.use('sample')` → sets `sampleFn`, re-renders. Until it resolves, the coach tab shows
   «المدرب غير متاح حاليًا» and the composer stays hidden.

---

## 3. State shape

One object, `state`, declared at index.html:624. `v` is the schema version, currently **6**.

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
`adopt(data)` (index.html:643) rebuilds `state` key by key. **Any top-level key not named there is
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
| `referee-coach-v1` | `save()` (const `LS`, index.html:626) | The whole `state`, JSON. The only key holding user data. |
| `rc-pass` | runtime shim `api()` (const `KEY`, index.html:496) | The app passcode, captured by `prompt()` on the first 401 and replayed as the `X-Passcode` header. Also read directly by `#notifTest` and `#vapidBtn`. |
| `dg-view` | the view switcher in `openDay()` (index.html:1032) | `"photo" \| "flat" \| "diagram"` — which exercise illustration style to show. Defaults to `"photo"`. This is the setting Phase 1 item 2 keys image loading off. |

Nothing else touches `localStorage`; there is no `sessionStorage` or IndexedDB use.

### Theme
The CSS defines a full dark palette under both `@media (prefers-color-scheme: dark)` and
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

### Static serving (server.js:281–289)
- Path traversal is blocked (`file.startsWith(PUBLIC)`), plus a `PRIVATE` deny-set
  (`server.js package.json package-lock.json render.yaml README.md .gitignore`), dotfiles, and
  `/node_modules`. **`ARCHITECTURE.md`, and the future `migrations/` and `SHORTCUT.md`, are not in
  `PRIVATE` and would be served publicly** — worth fixing in Phase 1.
- `Cache-Control`: `no-cache` for `.html` and `sw.js`, `public, max-age=604800` for everything else.
- `TYPES` covers `.html .js .webmanifest .json .png .jpg .svg .ico`. **No `.css`, no `.webp`** — both are
  needed in Phase 1. A `.css` file would fall through to `application/octet-stream` and the browser would
  refuse the stylesheet.
- **No compression at all.** No gzip, no brotli, no `Content-Encoding`.

### `/api/claude` (`coach()`, server.js:59)
Passcode → per-IP rate limit (**30 calls / 10 min**, in-memory `Map`) → key sanity checks → read body
(≤8 MB) → normalise `messages` (whitelist `text` and base64 `image` blocks; merge consecutive same-role
turns; force a leading `user` turn) → `askClaude()`. The response is flattened to `{text, stop_reason}`;
an empty `text` becomes a 502 `truncated`.

`askClaude()` retries **once** on a network blip, a 429, or a 5xx. Errors map to
`bad_api_key | upstream_rate | upstream_down | bad_request | timeout | network`, which the client turns
into Arabic sentences (index.html:1838–1856).

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
Collected in `openDay()` from a five-button row labelled by `EFFORT` (index.html:757):

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
const RPE = [0, 2, 4, 6, 8, 10];     // index.html:1208
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
function defDur(d, s) {                                    // index.html:1209
  if (!s) return 0;
  if (s.type === 'run') return weekParams(d).run;          // 25–45, from the plan's week
  return ({ strength:35, intervals:35, yoyo:40, light:20,
            recovery:25, rest:0, test:25, match:105 })[s.type] ?? 30;
}

function dayLoad(d) {                                      // index.html:1210
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
- `loadStatus()` (index.html:1212) — the ACWR:
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
Asked conversationally in `renderReady()` from `RQ2` (index.html:1237), as emoji buttons inside a chat
bubble. The flat labels in `RQ` (index.html:1224) are the same scale in plain words.

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
const readyScore = r => (r.sleep + r.sore + r.energy) / 3;    // index.html:1225
```
An unweighted mean of three 1–5 answers → a **float in [1, 5]**. Displayed as a percentage:
`Math.round(score / 5 * 100)` — so the floor of the gauge is 20%, not 0%.

```js
const readyLabel = sc =>                                       // index.html:1226
  sc >= 4 ? ['جاهز تمامًا',     'var(--pitch)']   // fully ready, green
: sc >= 3 ? ['جاهزية متوسطة',  '#C99A1E']        // moderate, amber
:           ['جاهزية منخفضة',  'var(--red)'];    // low, red
```

### What the score drives

1. **Automatic downgrade.** When the third answer lands, if `readyScore < 2.5` **and** today's session
   type is in `HARD` (`run strength intervals yoyo test`), `lighten(today, true)` fires immediately.
2. **`lighten(d, toRecovery)`** (index.html:1227) — never touches `test` days. It stashes the old
   `{type,title,details}` under `sessions[d].orig` and replaces the day with either
   - `toRecovery` → `type:'recovery'`, «استشفاء (جاهزيتك منخفضة)», or
   - otherwise → `type:'light'`, «نسخة خفيفة: <original title>», with the original details appended.

   `restoreOrig(d)` puts `orig` back. The presence of `orig` is what the UI reads as "today was
   softened", and what the «رجّع التمرين الأصلي» button undoes.
3. **Manual buttons.** With no `orig` yet, a HARD non-test day, and `score < 4`, the card offers
   «حوّل اليوم لاستشفاء» when `score < 2.5`, otherwise «خفّف تمرين اليوم».
4. **Coach copy.** `coachReply(today, r)` (index.html:1248) composes one Arabic line from the score plus
   today's/tomorrow's match, whether the session was softened, and two extra nudges:
   `sleep <= 2` → «وحاول تنام بدري الليلة»; `sore <= 2` with no match today → «ورجولك تحتاج مشي خفيف وإطالة».
5. **Prompt context.** The last 7 days of raw `readiness` entries go into `context()` for `/api/claude`,
   and `weekSummary()` averages them into the weekly report. `monthStats()` averages them into the
   monthly percentage.
6. **The cron's morning reminder** is suppressed once `readiness[today]` exists (server.js:225).
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
   `?tab=` on boot (index.html:1985).

### The `sentLog` bug (Phase 1 item 5)
```js
const sentLog = new Map();                                     // server.js:157
function alreadySent(key){ return sentLog.has(key); }
function markSent(key, date){ sentLog.set(key, date); for (const [k,d] of sentLog) if (d < date) sentLog.delete(k); }
```
Process memory only. Render's free plan spins the instance down when idle and restarts it on the next
request, which clears the Map — so the very next cron tick inside the same 35-minute window re-sends a
reminder the user already got. The fix is to persist it (new `coach_sent_has` / `coach_sent_mark` RPCs,
or a field on the state row), with the SQL in `migrations/001_sent_log.sql`.

---

## 9. Service worker, as it stands

```js
const CACHE = 'referee-coach-v10';
```
- **install** — precaches exactly `['/', '/index.html', '/manifest.webmanifest', '/icon-192.png']`, then
  `skipWaiting()`. **No CSS, JS, fonts or images** (there is no separate CSS/JS today, and images are only
  cached opportunistically).
- **activate** — deletes every cache whose key isn't `CACHE`, then `clients.claim()`.
- **fetch** — bails out on non-GET and on anything under `/api/`, so **`/api/state` is never cached and
  has no offline fallback**.
  - HTML (`/` or `*.html`) → **network-first**, writes through to the cache, falls back to the cached
    response and then to `/index.html`.
  - everything else → **cache-first**, writing through on a miss for same-origin responses and for
    anything on a `fonts.g*` host.
- **push / notificationclick** — as described in section 8.

### Consequences for Phase 1
- The Google Fonts stylesheet (`Readex Pro`, 5 weights) is a render-blocking third-party request on every
  cold load, cached only after the first visit.
- A cold Render instance still blocks the *content*: the shell paints from cache, then `initStorage()`
  waits on `/api/state` with no cached fallback and no "updating" affordance.
- Both image styles are reachable and both get cached opportunistically once the user flips the view
  switcher, with nothing precached deliberately.

---

## 10. First-load transfer budget (the Phase 1 "before" number)

Bytes on disk, uncompressed, which is exactly what the server sends today:

| Asset | Bytes |
|---|---|
| `index.html` | 213 115 |
| `manifest.webmanifest` | 613 |
| `sw.js` | 2 160 |
| `icon-192.png` | 4 943 |
| **Same-origin subtotal** | **220 831** |
| Google Fonts CSS + Readex Pro woff2 (5 weights, cross-origin) | not served by us; ~90–120 KB typical |

Images are **not** part of the first load — they are only requested when a session sheet opens.
Opening one intervals session fetches 4 exercise cards, and because both `<img>` tags for each card are
in the DOM (one `hidden`), `loading="lazy"` is the only thing keeping the non-selected style from
downloading; any card scrolled into view pulls **both** styles.
Worst case across all 24 exercises in both styles: **1 353 843 B**.

These are the numbers the Phase 1 report compares against.

---

## 11. Things Phase 1 has to be careful about

1. **`adopt()` is a whitelist** — splitting files must not change which keys survive a load or an import.
2. **`localStorage` key `referee-coach-v1`** and the export shape are frozen by the project rules.
3. **`state.v = 6`** — if any shape changes, bump it and write a migration that keeps v≤6 backups importable.
4. **`defaultSession()` is deterministic from the date**, with `PLAN_START = '2026-09-27'`, and
   `ensureHorizon()` fills today+56 on every boot. Touching the templates triggers the same
   "replace future days" migration path that `v < 6` took.
5. **Scope leakage**: every function currently lives in one closure. Moving to ES modules means every
   cross-group reference needs an explicit export. The dense ones are `state`, `save`, `renderAll`,
   `openDay`, `openSheet`, `closeSheet`, `switchTab`, `send`, `sampleFn`, `num`, `todayISO`, `addDays`,
   `parse`, `fWd`/`fDm`/`fFull`, `TYPES`, `HARD`, `weekParams`, `defDur`, `dayLoad`, `loadStatus`,
   `readyScore`, `quizState`, `WX`, `startTimer`.
   `sampleFn` is *reassigned* after boot and again on auth failure, so it cannot be a plain imported
   binding — it needs a getter or a small holder object.
6. **`server.js`'s `TYPES` has no `.css` or `.webp` entry**, and `PRIVATE` does not hide `.md` files or
   `migrations/`.
7. **`img-backSprint-flat.jpg` is referenced but missing** — the WebP conversion pass should either
   generate it or drop the entry so the switcher stops offering a broken view.
8. **The `hidden`-sibling image pattern in `openDay()`** is what Phase 1 item 2 replaces: render only the
   selected style's `<img>`, and inject the other on demand when the user flips the switch.
