// health.js — Apple Health / Garmin data. Stub until phase 3.
//
// The watch syncs to Apple Health through Garmin Connect, an iOS Shortcut POSTs
// last night's sleep and the latest workout to /api/health, and the server keeps
// them in their own Supabase rows. This module will fetch what has not been
// confirmed yet, feed the sleep card, and write a confirmed workout into
// state.logs[date].
//
// Deliberately inert for now: main.js already imports and calls these, so phase 3
// is filling them in rather than re-wiring the app.

// Unconfirmed workouts waiting for the user to rate the effort.
export function pendingWorkouts(){ return []; }

// Last night's sleep, once there is any.
export function lastNightSleep(){ return null; }

// Fetch from /api/health. A no-op today; it must stay safe to call on every open.
export async function syncHealth(){ /* phase 3 */ }

// The sleep hero card on Today.
export function renderSleep(){ /* phase 3 */ }

// What goes into the coach's prompt alongside the schedule.
export function healthContext(){ return null; }
