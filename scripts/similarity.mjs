// Similarity score verification run. Pulls game_log from Supabase, derives the
// season data and AI Scores the way the app does, then runs the same engine
// (src/similarity.js) and prints the tables.
//
//   node scripts/similarity.mjs                     default player, best 15
//   node scripts/similarity.mjs "ISHAK ANDREW" 10   one player at a chosen ceiling
//
// The app computes this in the browser off the already-derived DATA. This
// script exists so the numbers can be checked outside React.

import { readFileSync } from "node:fs";
import { PLAYER_MERGE } from "../src/playerNames.js";
import { buildCareers, eligiblePool, similarityTables, DEFAULT_CEILING, MIN_SEASONS } from "../src/similarity.js";

const SUPABASE_URL = "https://msvgstunqxjmmsmmumgg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdmdzdHVucXhqbW1zbW11bWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMTU4MjIsImV4cCI6MjA5MTg5MTgyMn0.QkOb0eu5dlHrItsFeFCU8KxAakgQnYjM7pqv7zzmURU";

async function loadGameLog() {
  const cols = "player,team,opp,week,date,game_type,g,pts,reb,stl,ast,blk,fgm,fga,ftm,fta,tpm,tpa,foul,gmsc,year";
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/game_log?select=${cols}&order=id.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } });
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error("game_log fetch failed: " + JSON.stringify(page));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(r => [
    r.player, r.team, r.opp, r.week, r.date, r.game_type, r.g, r.pts, r.reb,
    r.stl, r.ast, r.blk, r.fgm, r.fga, r.ftm, r.fta, r.tpm, r.tpa, r.foul,
    r.gmsc, r.year,
  ]);
}

// TEAM_SEASONS scraped out of App.jsx rather than duplicated, the same way
// scripts/elo.mjs does it, so this check cannot go stale.
function bakedTeamSeasons() {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const block = src.match(/const TEAM_SEASONS = \{([\s\S]*?)\n\};/);
  const out = {};
  for (const m of block[1].matchAll(/"([A-Z]{3})-(\d{4})":\{final:"(\w+)",w:(\d+),l:(\d+)\}/g))
    out[m[1] + "-" + m[2]] = { final: m[3], w: +m[4], l: +m[5] };
  return out;
}

const TEAM_SEASONS = bakedTeamSeasons();
const COUNTED = new Set(["R", "P", "C"]);
const isAnonymousGuest = n => /^PLAYER\b.*Guest$/i.test(n) || /^#\d+$/.test(n);
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;

const GAME_LOG = await loadGameLog();
// installGameLog: normalize names and teams, recompute Game Score per game.
for (const row of GAME_LOG) {
  const year = row[20];
  let name = (row[0] || "").toUpperCase();
  if (isAnonymousGuest(name)) name = year + " " + row[1] + " Guest";
  else if (PLAYER_MERGE[name]) name = PLAYER_MERGE[name];
  row[0] = name;
  if (year === 2018 && (row[1] === "MOD" || row[1] === "CIS")) row[1] = "MCS";
  else if (year === 2005 && name === "BANOUB BASSEM" && row[1] === "SRA") row[1] = "HAY";
  row[19] = r1(row[7] + 0.4 * row[12] - 0.7 * row[13] - 0.4 * (row[15] - row[14])
    + 0.5 * row[8] + row[9] + 0.7 * row[10] + 0.7 * row[11] - 0.4 * row[18]);
}

const TEAM_GMSC = {}, PLAYER_GMSC = {};
for (const r of GAME_LOG) {
  if (r[6] !== 1 || !COUNTED.has(r[5])) continue;
  TEAM_GMSC[r[1] + "-" + r[20]] = (TEAM_GMSC[r[1] + "-" + r[20]] || 0) + r[19];
  const pk = r[0] + "-" + r[1] + "-" + r[20];
  PLAYER_GMSC[pk] = (PLAYER_GMSC[pk] || 0) + r[19];
}

// buildSeasonData
const groups = new Map();
for (const row of GAME_LOG) {
  if (row[6] !== 1 || !COUNTED.has(row[5])) continue;
  const k = row[0] + "|" + row[1] + "|" + row[20];
  let a = groups.get(k);
  if (!a) {
    a = { player: row[0], team: row[1], year: row[20], g: 0, pts: 0, reb: 0, stl: 0, ast: 0,
      blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, tpa: 0, foul: 0, gmSc: 0 };
    groups.set(k, a);
  }
  a.g += 1;
  a.pts += row[7]; a.reb += row[8]; a.stl += row[9]; a.ast += row[10]; a.blk += row[11];
  a.fgm += row[12]; a.fga += row[13]; a.ftm += row[14]; a.fta += row[15];
  a.tpm += row[16]; a.tpa += row[17]; a.foul += row[18]; a.gmSc += row[19];
}
const DATA = [...groups.values()].map(a => ({
  ...a,
  ppg: a.g ? r1(a.pts / a.g) : 0, rpg: a.g ? r1(a.reb / a.g) : 0,
  spg: a.g ? r1(a.stl / a.g) : 0, apg: a.g ? r1(a.ast / a.g) : 0, bpg: a.g ? r1(a.blk / a.g) : 0,
  ts: (a.fga || a.fta) ? r3(a.pts / (2 * (a.fga + 0.44 * a.fta))) : 0,
  gmSc: r1(a.gmSc),
}));

// AI Score, matching rankScore / getTeamMultiplier / getShareBonus in App.jsx.
const YEARS = [...new Set(DATA.map(d => d.year))].sort((a, b) => a - b);
const leagueTS = {};
for (const y of YEARS) {
  const s = DATA.filter(r => r.year === y && r.g >= 1);
  const pts = s.reduce((t, r) => t + r.pts, 0);
  const fga = s.reduce((t, r) => t + r.fga, 0);
  const fta = s.reduce((t, r) => t + r.fta, 0);
  leagueTS[y] = pts / Math.max(2 * (fga + 0.44 * fta), 1);
}
const GP_FACTOR = { 7: 0.95, 6: 0.85, 5: 0.70, 4: 0.55, 3: 0.40, 2: 0.25, 1: 0.15 };
function rankScore(r, lts) {
  const tsDiff = r.ts - lts;
  const effBonus = r.fga > 0 ? tsDiff * r.ppg * (tsDiff >= 0 ? 1.0 : 1.5) : 0;
  const rawPG = r.ppg + effBonus + r.rpg + r.apg * 1.6 + (r.spg + r.bpg) * 1.8
    - (r.foul / Math.max(r.g, 1)) * 0.3;
  return r1(rawPG * (r.g >= 8 ? 1 : GP_FACTOR[r.g] ?? 0));
}
function teamMultiplier(team, year) {
  const ts = TEAM_SEASONS[team + "-" + year];
  if (!ts) return 1.0;
  let m = 1.0;
  if (ts.final === "Champ") m *= 1.10;
  else if (ts.final === "Finals") m *= 1.03;
  else if (ts.final === "Missed") m *= 0.95;
  if (ts.l > ts.w) m *= 0.95;
  return m;
}
function shareBonus(r) {
  if (r.g < 5) return 0;
  const teamGmsc = TEAM_GMSC[r.team + "-" + r.year];
  if (!teamGmsc || teamGmsc <= 0) return 0;
  const share = (PLAYER_GMSC[r.player + "-" + r.team + "-" + r.year] || 0) / teamGmsc;
  if (share < 0.20) return 0;
  const ts = TEAM_SEASONS[r.team + "-" + r.year];
  if (!ts) return 0;
  const total = ts.w + ts.l;
  if (total <= 0) return 0;
  return (share - 0.20) * 10 * (0.5 + ts.w / total);
}
for (const r of DATA) r.aiScore = r1(rankScore(r, leagueTS[r.year]) * teamMultiplier(r.team, r.year) + shareBonus(r));

const careers = buildCareers(DATA);
const ceiling = Number(process.argv[3] || DEFAULT_CEILING);
const pool = eligiblePool(careers, ceiling);
const who = (process.argv[2] || careers[0].player).toUpperCase();

console.log(`season value = AI Score | best ${ceiling} | pool ${pool.length} of ${careers.length} (min ${MIN_SEASONS} seasons)\n`);

const t = similarityTables(careers, who, ceiling);
if (!t) {
  console.log(`No career found for "${who}".`);
  console.log("Top of the pool: " + pool.slice(0, 10).map(c => c.player).join(", "));
} else {
  console.log(`${t.target.player}  ${t.target.seasons} seasons  ${t.target.first}-${t.target.last}`
    + `  career AI ${t.target.careerAi}  career value ${t.careerValue}`);
  console.log(`best ${ceiling}: ${t.capped.join(" ")}\n`);
  const show = (label, rows) => {
    console.log(label);
    rows.forEach((r, i) => console.log(
      `  ${String(i + 1).padStart(2)}. ${r.score.toFixed(1).padStart(5)}  `
      + `${r.career.player.padEnd(22)} ${String(r.career.seasons).padStart(2)}sns  `
      + `${r.career.first}-${r.career.last}`));
    console.log("");
  };
  show(`THROUGH YEAR ${t.target.seasons}`, t.through);
  show("FULL CAREERS", t.career);
}
