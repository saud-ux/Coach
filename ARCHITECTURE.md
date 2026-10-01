# ARCHITECTURE — جدول الحكم (referee-coach)

Map of the app. **Current as of Phase 3** (the watch: Garmin → Apple Health → an iOS Shortcut →
`POST /api/health`, the sleep score, and readiness that blends in the watch). Phase 2 was the "Night 2"
redesign (§11); Phase 3 is §13. The RPE scale in §6 is unchanged; §7 gained one function.

Written in English on purpose: it is a developer map full of identifiers. All *user-facing* copy stays
Arabic / RTL / Saudi dialect, as the project rules require.

---

## 1. Files on disk

| File | Size | Role |
|---|---|---|
| `index.html` | 7 730 B · 119 lines | Markup only. Links two stylesheets and one entry module. |
| `css/tokens.css` | 1 974 B | Palette, dark-mode variants, base element styles, shadow/radius tokens. |
| `css/app.css` | 28 488 B | Every component rule, in the original cascade order. |
| `js/*.js` | 13 modules, ~200 KB | The app. See §2. |
| `server.js` | 22 KB | Node `http` server, no framework. Static serving with brotli/gzip + 11 API routes. |
| `sw.js` | 6 310 B | Service worker: versioned shell cache, cache-first media, network-first `/api/state`, push. |
| `manifest.webmanifest` | 613 B | PWA manifest. `theme_color #1E6A43`, `background_color #F4F6F2`, `dir: rtl`, `lang: ar`. |
| `render.yaml` | 514 B | Render free-plan web service, region frankfurt, `healthCheckPath: /healthz`. |
| `package.json` | 309 B | Single dependency: `web-push@^3.6.7`. Node ≥ 20. `npm start` → `node server.js`. |
| `migrations/001_sent_log.sql` | — | The persisted reminder log. Run once in Supabase. |
| `migrations/002_health.sql` | — | Sleep nights and watch workouts, plus `coach_health_add/get/ack`. Run once in Supabase. |
| `lib/health.js` | — | Server-only. Pure functions that turn a Shortcut payload into clean rows (§13). Not served. |
| `SHORTCUT.md` | — | The iPhone Shortcut recipe and automations, in Arabic, plus the payload format. |
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
| `js/storage-sync.js` | ~165 | `initRuntime()` (the `window.claude` shim: `sample`, `db`, `user`, `RC_INBOX`), the `rt` coach handle, `adopt()`, the two-phase load (`bootLocal()` then `syncRemote()`), and `exportBackup`/`importBackup`. |
| `js/ui.js` | ~110 | Design primitives: `ring()`/`ringWith()` (SVG circle on a `--track` circle, round caps, rotated -90deg), the stroke `icon()` set, and the Arabic formatters `hhmm` and `clock12`. Imports nothing. |
| `js/today.js` | ~290 | The Today screen — sleep hero, the two tiles, the watch card, the session card, the next-match line — plus the readiness sheet and the settings sheet. |
| `js/workout.js` | ~145 | The Workout Summary screen, and `effortFrom10()`, the one place the 1-10 picker is mapped onto the stored 1-5. |
| `js/figures.js` | 334 | All the inline-SVG artwork and the stick-figure rig, the per-exercise metadata (`D DOSE MUS IMG REST AFTER FLOW DIAGRAMS`), the rest timer, and the image helpers `mediaHTML/applyView/stylesFor/precacheSelectedStyle`. |
| `js/schedule.js` | 356 | The plan (`weekParams defaultSession ensureHorizon defDur`), matches, `renderSchedule`, `renderHero`, `openDay`, `openAddMatch`, `openAddTest`, and the assignment inbox. |
| `js/coach.js` | 283 | Readiness (`readyScore lighten renderReady`), `renderAlerts`, the weekly report, and chat (`RULES context send applyChanges renderChat`). |
| `js/progress.js` | 230 | Training load (`RPE dayLoad sumLoad loadStatus`), the Cooper chart, the career log, weather, the monthly report image, and the load/matches panels. |
| `js/quiz.js` | ~260 | The quiz: 350 law-app questions plus 26 of its own on AR positioning, progress keyed by question id, the daily question, the mock exam, per-article practice, and `renderLaw`. §14. |
| `js/lawbank.js` | 217 KB | **Generated** by `scripts/export-law-bank.py` from the law app. The 350 questions. Never edit by hand. |
| `js/notifications.js` | 120 | Push subscription, the four reminder preferences, and `initNotifications()`. |
| `js/health.js` | ~250 | Sleep and watch workouts: the `state.health` cache, `sleepScore()`, the accessors Today and the Workout Summary read, `syncHealth()`/`ack()` against `/api/health`, `maxHr()`, and `stampReadiness()`. |
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
`syncRemote()` shows «يتم التحديث…», fetches `/api/state`, adopts it and re-renders, and **then**
`syncHealth()` runs (it saves when something new arrives, and a save during `syncRemote()` would count
as an edit and make it skip the server copy); `loadWeather()`, `loadInbox()` and
`precacheSelectedStyle()` run alongside it. Returning to the app re-runs `loadInbox()` and
`syncHealth()`, the latter throttled to once a minute; `claude.use('sample')`
sets `rt.sample` and re-renders just the chat, report and alert strips.

`syncRemote()` keeps the old precedence — the server copy wins — with one addition: it counts edits
(`hooks.onDirty`) and skips the overwrite if the user changed something while the request was in
flight, so a snapshot taken before their edit cannot erase it.

> **Known limitation, unchanged from before Phase 1:** there is no timestamp or merge. Edits made on
> a *different* device while this one was offline are still lost when the server copy arrives. Giving
> `state` an `updated_at` and comparing would fix it, and is not in scope for these phases.

---

## 3. State shape

One object, `state`, declared at `js/state.js`. `v` is the schema version, currently **7**.

```js
state = {
  v: 7,

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
      rpe10?: 1..10,                     // v7, watch-confirmed sessions: the raw picker
                                         // answer. `effort` above stays the value
                                         // dayLoad() reads -- see section 6.
      distance?, avg_hr?, max_hr?,       // v7, copied off the watch workout
      source?: "watch",
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
    "2026-10-01": { sleep: 1..5, sore: 1..5, energy: 1..5, skipped?: true,
                    sleep_watch?: 0..100 }   // v7 Phase 3: the watch's score it was blended with, §13
  },

  // weekly coach reports. key = that week's SUNDAY in ISO form.
  reports: { "2026-09-27": { text: String, at: "YYYY-MM-DD" } },

  // laws quiz, keyed by question id. quizState() migrates v2 -> v3 -> v4 and
  // resets anything else. See §14.
  quiz: {
    v: 4,
    answers: { "<question id>": { pick: Number, ok: Boolean, date: "YYYY-MM-DD", extra: Boolean } },  // last answer
    daily:   { "YYYY-MM-DD": "<question id>" },                 // which question was "today's"
    prog:    { "<question id>": { seen, ok, wrong, streak: Number, mastered: Boolean, due: "YYYY-MM-DD"|null } },
    days:    { "YYYY-MM-DD": Number },                          // answers given that day, for the streak
    cfg:     { scope: "all"|"1".."19"|"g", count: 5|10|20|30|50, diff: 0..3, mode: "mixed"|"random"|"hard", timer: Boolean },
    exams:   [{ date, right, total, secs, scope?, mode?, diff? }]
  },

  settings: { city: "zulfi" | "riyadh" | "majmaah",
              max_hr?: 120..230 },        // Phase 3. Heart-rate zones are cut from it; default 190

  // v7. A CACHE of what the watch sent, not a source of truth: the server keeps the
  // authoritative rows and phase 3 deliberately does not let it write the main state
  // row. Cached here so the sleep card still has something to show offline.
  health: null | {
    nights: { "YYYY-MM-DD": {                    // keyed by night_of
      in_bed_start, in_bed_end,                  // ISO strings
      asleep_min, deep_min, rem_min, awake_min,  // numbers
      resting_hr
    }},
    workouts: [{                                 // newest first
      id, start, end, type, duration_min, distance_km,
      avg_hr, max_hr, zones: {z2,z3,z4,z5},      // minutes per zone
      confirmed: false
    }],
    syncedAt: ISO string | null
  },

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

### v7 (Phase 2)
`health` was added, plus three optional fields on a log entry (`rpe10`, the watch numbers, `source`).
All of it is additive: a v6 backup simply has no `health` key and `adopt()` gives it `null`, and a log
without `rpe10` behaves exactly as before. **The destructive migration gate below still reads `< 6`,
not `< 7`**, so bumping the version did not re-trigger it. Verified by importing both a v6 and a v5
backup: the v6 one keeps every key untouched, and the v5 one still wipes future non-match days.

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
The app is **dark only** as of Phase 2. `css/tokens.css` declares every value once in `:root` and
again under `:root[data-theme="dark"]`, and **no JavaScript ever sets `data-theme`**. The hooks are
deliberately inert scaffolding: adding a light theme later means filling in
`:root[data-theme="light"]` and flipping one attribute, and no rule in `app.css` has to change,
because nothing there hard-codes a colour.

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
| `/api/health` | POST | `X-Passcode` **or** `passcode` in the body | For the iOS Shortcut. ≤3 MB. `lib/health.js` normalises it → `rpc('coach_health_add')` → an Arabic `message` the Shortcut shows. §13. |
| `/api/health` | GET | `X-Passcode` | `rpc('coach_health_get', {p_since})`, default the last 31 days → `{nights, workouts, last_at}`. |
| `/api/health/ack` | POST | `X-Passcode` | Body `{id}` → `rpc('coach_health_ack')`. The referee answered that workout. |
| `/api/cron?token=` | GET | `?token=` must equal `CRON_TOKEN` | The reminder tick. See section 8. |
| `/healthz` | GET | none | `ok`, text/plain. Render's health check. |
| anything else | GET | none | Static file from `__dirname`. SPA fallback: a miss serves `index.html` with status 200. |

### Static serving (`serveFile()`)
- Path traversal is blocked (`file.startsWith(PUBLIC)`), plus a `PRIVATE` deny-set, dotfiles, **any
  `.md`**, and the `PRIVATE_DIRS` list (`/migrations`, `/lib`, `/scripts`, `/node_modules`, `/.git`). Docs and SQL are
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
- `coach_sent_has(p_key)`, `coach_sent_mark(p_key, p_date)` — Phase 1
- `coach_health_add(p_nights, p_workouts)`, `coach_health_get(p_since)`, `coach_health_ack(p_id)` — Phase 3.
  If they are missing the server answers `503 {error:'not_migrated'}` and logs which file to run.

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

### Phase 3: the watch as a second opinion on sleep
`readyScore()` is **unchanged, character for character**. The weekly summary, the monthly average and
every stored entry still go through it, so no historical number moved.

A second function, `readyNow(r)` (`js/coach.js`), is what today's decisions use — the Today tile, the
readiness card, `coachReply()`, the automatic `< 2.5` downgrade and the manual buttons:

```js
const readyNow = r => r.sleep_watch == null ? readyScore(r)
  : ((r.sleep + sleepTo5(r.sleep_watch))/2 + r.sore + r.energy)/3;
```

So the sleep answer becomes the mean of what the referee said and what the watch measured, on the same
1–5 axis, and the result is still a 1–5 mean of three. Without a watch score it *is* `readyScore`.
Details and a worked example in §13.

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
const VERSION = '19';
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

## 11. Phase 2: the "Night 2" design system

### Tokens
Everything is in `css/tokens.css` and nothing below it hard-codes a colour.

| | |
|---|---|
| surfaces | `--bg #07080A` · `--surface #101216` · `--surface-2 #14171C` · `--track #1E232B` |
| text | `--ink #F2F4F7` · `--ink-2 #C9CED6` · `--muted #8B93A1` · `--muted-2 #6E7684` |
| meaning | `--sleep #9B8CFF` · `--ready #3DDC84` · `--load #4AA3FF` · `--effort #FF7A45` · `--match #F2C230` · `--max #FF4D5E` |
| shape | cards 22px, tiles 16px, primary button fully rounded at 50px, `--tap: 44px` minimum |
| type | IBM Plex Sans Arabic 400/500/600/700, system fallback |

The session-type colours (`--run`, `--strength`, …) and the legacy names the SVG figures still
reference (`--pitch`, `--line`, `--card`, `--red`) are mapped onto that palette rather than left
behind, so the exercise artwork and the charts came across without edits.

Rings are SVG: a `--track` circle with a coloured circle over it, `stroke-dasharray` carrying the
value, round caps, `rotate(-90)` so the arc starts at twelve o'clock. `ring()` in `js/ui.js` is the
only implementation. No emoji anywhere in the chrome — `icon()` holds ~22 inline stroke paths.

### Navigation
Four tabs: **اليوم / الجدول / المدرب / التقدم**. Settings left التقدم and became a sheet behind the
gear in the Today header.

The tab bar is **docked**: full width, solid `--surface`, a 1px top edge, flush with the bottom of the
screen above the home-indicator inset. It first shipped floating (inset, rounded, translucent), and the
page showed around and through it. Its height is `--tabbar` in `css/tokens.css`, and the page's bottom
padding, the rest timer and the chat composer are all positioned from that one value.

Three things moved off Today, as specified:

| moved | from | to |
|---|---|---|
| assignment inbox | Today | top of الجدول |
| daily law question | Today | التقدم → القانون |
| alert stack | Today | top of المدرب, plus the load tile turns «مرتفع» |

### Sheets build their own markup
A sheet's contents are replaced when it closes, so **nothing moves a live element into one**. The
readiness conversation and the settings panel each render fresh on open, and `closeSheet()` empties
the sheet. `renderReady()` and `renderNotif()` both no-op when their container is absent, which is
what lets `renderAll()` keep calling them unconditionally.

`openSheet(build, { bare: true })` suppresses the corner close button for a screen that carries its
own back control, so Workout Summary never shows two ways out.

### The 1-10 effort picker
Workout Summary asks «كيف حسيت بالمجهود؟» on a 1-10 scale. `dayLoad()` has always computed
`minutes x RPE[effort]` with `RPE = [0,2,4,6,8,10]` indexed 1-5, so every past ACWR figure is built
on the 1-5 scale.

`effortFrom10()` in `js/workout.js` is the only mapping: `Math.round(answer / 2)` clamped to 1-5 —
the exact inverse of that table. A 7 becomes effort 4 and a 38-minute session scores `38 x 8 = 304`.
The raw answer is kept beside it as `rpe10` for later, and **nothing computes load from that field**.
Changing either the table or what `effort` means would silently rewrite every historical comparison.

### Form fields and zoom
Fields sit below the sheet (`--bg`) with a 1px `--field-line` edge, a brighter edge and a soft ring on
focus, a muted placeholder, and a chevron on dropdowns. They used to share the sheet's colour with no
edge, so an empty field read as blank space. **Every field is 16px**, `.in.sm` included: iPhone zooms the
page into any field under 16px when it is tapped.

The app does not zoom, so it behaves like an app. Four sources, four fixes: `user-scalable=no` in the
viewport tag (pinch), cancelling `gesture*` events in `main.js` (Safari ignores the tag),
`touch-action:manipulation` on `html` (double tap), and the 16px rule above (tapping a field). The cost is
that text cannot be pinched larger; to undo it, remove all four.

### Digits: Western 0-9 everywhere
The app used to show Arabic-Indic digits (٠١٢…). It now shows Western digits, with Arabic words and
the Gregorian calendar, in three layers:

1. **Formatters.** `AR` in `js/state.js` is `ar-SA-u-ca-gregory-nu-latn`, `num()` formats with it, and
   `hhmm`/`clock12` in `js/ui.js` use `nu-latn`. `٪` became `%`.
2. **Literals.** Every digit written in the source — exercise doses, quiz text, notes — is 0-9. The only
   Arabic-Indic digits left in the code are the two input parsers (`#tv` in `js/schedule.js`, `#mScore`
   in `js/progress.js`) and `lib/health.js`, which must keep *accepting* them because people type them.
   The coach prompts (chat, weekly report, push text) ask Claude for 0-9 too.
3. **Display.** `latinDigits(document.body)` (`js/ui.js`, installed first thing in `main.js`) converts
   any Arabic-Indic or Persian digit in a text node as it reaches the screen. That covers what the code
   did not write: plan days generated before the switch (the horizon is 56 days ahead), old chat and
   reports, an assignment SMS. **Stored data is not rewritten** — the backup and the coach prompt see
   exactly what was saved.

The old cosmetic gap — a match title carrying Western digits from `<input type="time">` while the rest
of the UI was Arabic-Indic — is gone as a side effect.

---

## 12. Phase 1: what changed, and what to watch

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

---

## 13. Phase 3: the watch

### The pipeline
Garmin Connect writes sleep, heart rate and workouts into Apple Health. An iOS Shortcut (`SHORTCUT.md`)
reads them and posts to `POST /api/health`. `lib/health.js` normalises the payload, the server stores it
with `coach_health_add` in two tables of its own (`migrations/002_health.sql`), and the app reads it back
with `GET /api/health` into `state.health`, which is a **cache**: it exists so the sleep card has
something to show on a cold offline open.

**The server never writes the main state row.** That row has exactly one writer, the app; a second
writer on one JSON blob is how edits get lost (§2, "Known limitation"). The server *reads* it for one
value, `settings.max_hr`, when a Shortcut post arrives.

### Normalising (`lib/health.js`)
The Shortcut is hand-built on a phone, so the parser assumes nothing:

- **Numbers** may be text with units, Arabic-Indic digits, or a decimal comma: `"٥٨ ن/د"` → 58,
  `"6,2 km"` → 6.2, `"1,234"` → 1234. Every number is range-checked and dropped if absurd.
- **Dates** must be ISO 8601 (the recipe says so); anything `Date.parse` cannot read is dropped.
- **Sleep stages** are matched in English and Arabic (`Asleep Deep` / `عميق`, `Core` / `أساسي`, …).
  Raw samples are grouped into nights by the evening they began, in `APP_TZ`: a sample starting before
  noon belongs to the previous date. Samples starting 11:00–18:00 are naps and are ignored. Minutes per
  stage are an **interval union**, so the watch and the phone writing the same night count once.
  A night that is only "in bed" with no sleep stage is not stored.
- **Workouts** get `id = 'w' + base36(start in minutes)`. The same workout sent twice — the Shortcut ran
  again, or Health rounded the seconds — lands on the same row. Under one minute is not a workout.
  The type is mapped onto the keys `workout.js` already translates (`running walking cycling hiit
  strength soccer other`).
- **Heart rate** from samples: each sample owns the time until the next one, **capped at two minutes**
  so a strap dropout is not billed to the last zone. That gives a time-weighted average, the peak, and
  minutes in each zone. Figures the watch sent itself (`avg_hr`, `max_hr`) win over computed ones.
- **Zones** are fractions of `settings.max_hr` (default 190, the "220 − age" rule at 30):
  z1 < 60% ≤ z2 < 70% ≤ z3 < 80% ≤ z4 < 90% ≤ z5. They are computed once, on arrival, so changing max HR
  applies to workouts that arrive afterwards — the Settings note says so.

A payload with nothing usable is not an error: the Shortcut gets `200` and «وصل الاتصال، بس ما فيه نوم
ولا تمارين».

### Storage rules (`migrations/002_health.sql`)
- A **night** is replaced whole on re-send (the later run has the more complete night), except that a
  missing `resting_hr` keeps the stored one.
- A **workout** re-send keeps every stored field the new one lacks, and **never touches `confirmed`**:
  running the Shortcut again cannot bring back a card the referee already answered.
- Both tables are RLS-on with no policies; only the security-definer functions reach them, with the
  same sha256 token check as `coach_get`. Rows older than 120 days are pruned on each add.

### Sync (`js/health.js`)
`syncHealth()` fetches the last 31 days and merges. The server is the truth for what the watch measured;
the device only knows better about one thing — that a workout was confirmed while its ack was still in
flight — so `confirmed` is OR-ed, and an ack the server has not seen is re-sent. It saves only when
something actually changed, because a no-op `save()` would mark the state dirty. The cache keeps 31
nights and 40 workouts. A pending workout older than 3 days stops showing its card, so the first sync's
backfill does not bury Today.

### The sleep score (`sleepScore()` in `js/health.js`)
0–100, from four parts:

| part | weight | full marks | zero |
|---|---|---|---|
| duration | 55 | 7 h 30 asleep (450 min) | 0 min, linear |
| deep share | 20 | deep ≥ 20% of asleep | 0%, linear |
| awake after sleep onset | 10 | 0 min | ≥ 60 min, linear |
| bedtime consistency | 15 | within 30 min of the 7-night median | ≥ 90 min off, linear |

Each part is clamped to 0–1, so a broken field costs only its own slice. A field that is **missing**
scores 0.6, not 0 — "unknown" should not read as "bad". Consistency needs at least 3 earlier nights;
before that it is 0.6. Bedtimes are compared with times before noon shifted by 24 h, so 23:00 and
01:00 are two hours apart, not twenty-two.

**Worked example** — the test night: in bed 23:05, asleep 415 min, deep 75, awake 15, no history yet.

```
duration     415/450          = 0.922 × 55 = 50.7
deep share   (75/415)/0.20    = 0.904 × 20 = 18.1
awake        1 − 15/60        = 0.750 × 10 =  7.5
consistency  (no history)     = 0.600 × 15 =  9.0
                                              ----
                                              85.3 → 85
```

"Last night" is the night filed under yesterday's date; one filed under today is accepted too, in case
a Shortcut run after midnight labels it that way.

### The sleep details sheet
Tapping the sleep card opens `openSleepSheet()` (`js/today.js`):

- **The night:** bedtime → wake time, time asleep, time in bed, and efficiency (asleep ÷ in bed).
- **Stages:** one stacked bar, deep / light (core = asleep − deep − REM) / REM / awake, with a legend of
  minutes and shares. The four colours (`--st-*` in `css/tokens.css`) were checked as a categorical set on
  `--surface` with the dataviz validator: lightness band, colour-blind and normal-vision separation of
  neighbours, and contrast all pass.
- **How the score was made:** each of the four parts as points out of its weight, with what it was
  measured from. It reads `sleepParts()`, which `sleepScore()` itself is now built on, so the breakdown and
  the ring cannot disagree (the test night still scores 85; the first real night scores 61). Under it, one
  tip about the part that **cost the most points**, not the one with the fewest.
- **Resting HR** against the average of the nights before it: ≥5 above reads as a warning, ≥3 below as
  good recovery.
- **The last 7 nights:** one series of columns (≤24px, 4px rounded tops), a hairline at the 7:30 target,
  the latest night the only label; tapping a column reads it out underneath. Each night is scored against
  the nights before it, the way the ring scores last night (`nightHistory()`).

### Readiness with the watch
When the three answers land, `stampReadiness()` writes the watch's score onto that day's entry as
`sleep_watch`. If the answers came first and the watch data later, the first sync after stamps it.
Once stamped it never changes, so the tile does not drift when the cache updates and a past day keeps
the number it had on the day.

`sleepTo5(score) = 1 + 4 × score/100` puts it on the answers' axis (100 → 5, 50 → 3, 0 → 1), and
`readyNow()` averages it with the sleep answer (§7).

**Worked example** — answers 3 / 3 / 3, watch 85:
`sleepTo5(85) = 4.4`; sleep becomes `(3 + 4.4)/2 = 3.7`; `(3.7 + 3 + 3)/3 = 3.23` → **65%**, where the
answers alone give 60%. A bad night pulls the other way: answers 3/3/3 with a watch score of 30 give
`(2.6 + 3 + 3)/3 = 2.87` → 57%.

The watch moves the sleep component by at most ±2 points on a 1–5 scale and the total by at most ±0.67,
so it can tip a borderline day across the 2.5 downgrade line but cannot override three answers on its own.

The coach's chat prompt now carries `sleep: healthContext()` (last night's score and parts) beside `load`.

### Verified, and not
Verified in this environment:
- the migration against PostgreSQL 16 with a Supabase-shaped schema (`extensions.digest`, `anon`), run
  twice to prove it re-runs; wrong token rejected; tables unreadable to `anon` directly; `confirmed` and
  `resting_hr` surviving a re-send;
- `server.js` end to end through a stand-in for Supabase's `/rest/v1/rpc` that forwards to those real
  functions: the Shortcut post with the passcode in the body, wrong passcode, empty payload, bad JSON,
  missing functions (`not_migrated`), the ack, and `/lib` + `/migrations` returning 403;
- the app in headless Chromium at 390 × 844: the sleep hero, readiness at 65% with the watch line, the
  Workout Summary zones cut at the stored max HR, confirm → log written + ack reaching the server,
  Settings' link test and max HR saving through to the server's copy.

**Not verified:** the Shortcut itself on a real iPhone (in particular whether "Workouts" is offered as a
Health sample type on the installed iOS — `SHORTCUT.md` flags it), and the migration on the real
Supabase project.

---

## 14. The law app's question bank

The law app — github.com/saud-ux/other-refereea, `other-refereea.onrender.com`, a separate Flask app with
its own accounts — owns a bank of **350 questions** from the 2026/27 laws, each with a stable id
(`L11-04`), article, topic, type (`mcq`/`tf`/`scenario`), difficulty 1–3, explanation, reference and page.
This app now uses that bank instead of its own 92.

### How it gets here
`scripts/export-law-bank.py <path to a clone of the law app>` imports its `questions.py` and writes
`js/lawbank.js`: the 350 questions in short keys, digits converted to 0-9 (§11), and the source commit in
the header. It asserts the ids are unique and every answer index is in range. A copy rather than a live
fetch, on purpose: the daily question and the mock exam keep working offline, and do not wait on a second
free-plan server waking up. When the bank changes there, re-run the script and commit the result.
`/scripts` is in `PRIVATE_DIRS`, and `js/lawbank.js` is in the service worker's shell list.

### What was kept from the old bank
The law app has no questions on the assistant referee's own job — positioning, signals, communication, the
book's practical guidelines on pp. 212–229 — and only 8 of its 350 mention the assistant at all. The 26 such
questions from the old bank (category `g`, «التمركز والإشارات») stay, as `G-01`…`G-26`, beside the 350:
**376 in all**. The other 66 old questions were replaced.

### Progress is keyed by id now
v2 keyed `answers`, `wrong` and `daily` by position in the old list, which is why the bank could not grow.
`migrateV2()` (`js/quiz.js`) runs inside `quizState()` the first time a v2 object is seen:

| old position | becomes | answers | wrong bank | daily |
|---|---|---|---|---|
| 62–87 (the AR questions) | `G-01`…`G-26` | kept | kept | kept |
| anything else | `old-<n>` | kept | dropped | dropped |

So the accuracy figure, the streak and the monthly report still count every answer ever given, while the
wrong bank and today's question only ever point at questions that exist. The per-article tiles and the
«x/376 صح» count read only ids still in the bank. The migration is deterministic, so two devices that
migrate the same v2 object independently end up identical.

### Using it: the law app's way
Rebuilt to work like the law app, from its `app.py` and `ui.py`:

- **Spaced review** (`recordAnswer()`, the law app's `record_answer()` step for step). Per question,
  `prog[id] = {seen, ok, wrong, streak, mastered, due}`. Right with no earlier mistake → mastered. Right
  after a mistake → due again in 2, 5, then 9 days (`SPACING`), mastered at three in a row. Wrong → streak
  0, due tomorrow if it has been missed twice, else in two days.
- **Priority** (`priority()`): due for review 0, never seen 1, got wrong 2, seen 3, mastered 4.
- **The daily question** is chosen once from the most urgent tier, seeded by the date, and fixed for the
  day. The answer and explanation show at once. «سؤال ثاني» draws from the same tier.
- **The test.** A one-line summary of the settings, «ابدأ الآن», «أخطائي (n)», and «تخصيص» for the
  fields: law (or all, or the AR questions), 5/10/20/30/50 questions, difficulty (all/easy/medium/hard —
  an addition the law app does not have), selection (ذكي by priority, عشوائي, الأصعب أولًا), and a
  timer of one minute a question or none. The settings are saved in `quiz.cfg` and synced.
  It runs like an exam: nothing revealed, free movement, tapping the chosen answer again clears it, and
  blanks count as wrong. Results: score out of the number asked, a verdict, then every wrong or blank
  question with your answer, the right one, the explanation and the page. Only answered questions are
  recorded, as in the law app. When the clock runs out the test submits itself.
- **«أخطائي»** tests the questions that are not mastered and have been missed, most-missed first.
- Tapping a law's tile selects it in the settings and opens them.
- The 26 AR questions carry no difficulty, so a difficulty filter leaves them out.

v3 → v4 (`migrateV3()`): each answered question gets a `prog` row. A v3 wrong-bank entry becomes "missed
`n` times, `fix` right since, due today"; a right answer with no wrong-bank entry is mastered. `wrong` is
dropped, `days` is seeded from the answer dates.

Verified in Chromium from a seeded v2 state through v3 to v4: the AR answer that was in the wrong bank
came through as `G-02`, missed once and due today; a right AR answer as `G-09`, mastered; the answer to a
replaced question still counts in the 67% accuracy as `old-5`. A test set to المادة 11 · 5 · صعب drew five
hard offside questions on a five-minute clock; clearing an answer by tapping it again, finishing with a
blank, and the review of all five all behaved, and the settings survived a reload.
