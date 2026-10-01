// plan.js — the week's numbers, shared by the app and the server.
//
// The first 4 weeks build up, then a repeating 4-week cycle (3 steady weeks and a
// lighter one). Pure on purpose, like js/matchplan.js: the server imports it to
// write each day's watch workout (lib/intervals.js), so the counts on the watch
// are the counts in the app.
//   run  endurance-run minutes   sp  sprint reps   ar  ARIET reps   str  strength rounds

export const PLAN_START = '2026-09-27';
export const BUILD = [
  {run:25,sp:5,ar:6,str:2},{run:30,sp:6,ar:8,str:3},
  {run:35,sp:6,ar:10,str:3},{run:40,sp:8,ar:12,str:3,slow:true}];
export const CYCLE = [
  {run:40,sp:8,ar:12,str:3},{run:45,sp:8,ar:14,str:3},
  {run:45,sp:10,ar:15,str:3,slow:true},{run:25,sp:4,ar:6,str:2,light:true}];

// Calendar arithmetic on 'YYYY-MM-DD' in UTC, so the answer is the same in the
// browser and on the server whatever their timezones.
const day = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function weekParams(date){
  const w = Math.floor((day(date) - day(PLAN_START)) / (7 * 864e5));
  return w < 0 ? BUILD[0] : w < 4 ? BUILD[w] : CYCLE[(w - 4) % 4];
}
