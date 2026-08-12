// Team Elo verification run. Pulls game_log from Supabase, runs the same
// engine the app uses (src/elo.js), and prints the history plus the checks
// that say whether the ratings are worth trusting.
//
//   node scripts/elo.mjs            full report
//   node scripts/elo.mjs --tune     grid search K and offseason carryover
//
// The app computes this in the browser off the already-loaded GAME_LOG. This
// script exists so the numbers can be checked outside React.

import { readFileSync } from "node:fs";
import { buildElo, eloHindsight, eloFinals, eloTeam, ELO_K, ELO_CARRYOVER } from "../src/elo.js";

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
  // Positional rows, matching the shape App.jsx keeps GAME_LOG in.
  return rows.map(r => [
    r.player, r.team, r.opp, r.week, r.date, r.game_type, r.g, r.pts, r.reb,
    r.stl, r.ast, r.blk, r.fgm, r.fga, r.ftm, r.fta, r.tpm, r.tpa, r.foul,
    r.gmsc, r.year,
  ]);
}

const r0 = n => Math.round(n);

// The baked TEAM_SEASONS table out of App.jsx, scraped rather than duplicated
// so this check cannot go stale. Andrew has confirmed that table is the
// authority on records, so any year where the log disagrees is a game_log
// problem, and Elo inherits it.
function bakedRecords() {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const block = src.match(/const TEAM_SEASONS = \{([\s\S]*?)\n\};/);
  if (!block) return null;
  const out = {};
  for (const m of block[1].matchAll(/"([A-Z]{3})-(\d{4})":\{final:"(\w+)",w:(\d+),l:(\d+)\}/g)) {
    const year = Number(m[2]);
    const team = eloTeam(m[1], year);
    const key = year + "|" + team;
    // A franchise line can hold two codes in one year only if the data is
    // wrong, so a collision here is worth knowing about.
    out[key] = { team, year, final: m[3], w: Number(m[4]), l: Number(m[5]) };
  }
  return out;
}

function reconcile(seasons) {
  const baked = bakedRecords();
  if (!baked) { console.log("Could not read TEAM_SEASONS out of App.jsx, skipping the records check.\n"); return; }
  const bad = [];
  for (const row of seasons) {
    const b = baked[row.year + "|" + row.team];
    if (!b) { bad.push(`  ${row.year} ${row.team}  derived ${row.w}-${row.l}, no baked season`); continue; }
    if (b.w !== row.w || b.l !== row.l) bad.push(`  ${row.year} ${row.team}  derived ${row.w}-${row.l}, baked ${b.w}-${b.l}`);
  }
  const derivedKeys = new Set(seasons.map(r => r.year + "|" + r.team));
  for (const key of Object.keys(baked)) if (!derivedKeys.has(key)) bad.push(`  ${key.replace("|", " ")}  baked ${baked[key].w}-${baked[key].l}, no games found`);
  console.log(`Records check against the baked TEAM_SEASONS: ${seasons.length - bad.length} of ${seasons.length} season records reproduce exactly`);
  if (bad.length) { console.log("Disagreements, each one a game_log problem the Elo run inherits:"); console.log(bad.join("\n")); }
  console.log();
}

const score = (gameLog, opts) => eloHindsight(buildElo(gameLog, opts).games);

function tune(gameLog) {
  console.log("Grid search, log loss (lower is better), 617 games\n");
  console.log("  K   carry   mov    n    acc     logloss");
  const rowsOut = [];
  for (const mov of [true, false]) {
    for (const k of [12, 16, 20, 24, 28, 32, 40]) {
      for (const carryover of [1, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5]) {
        const s = score(gameLog, { k, carryover, mov });
        rowsOut.push({ k, carryover, mov, ...s });
      }
    }
  }
  rowsOut.sort((a, b) => a.logloss - b.logloss);
  for (const r of rowsOut.slice(0, 12)) {
    console.log(`  ${String(r.k).padStart(2)}  ${r.carryover.toFixed(2)}  ${r.mov ? "on " : "off"}  ${r.n}  ${(r.acc * 100).toFixed(1)}%  ${r.logloss.toFixed(4)}`);
  }
  console.log("\nBaseline, always pick the coin flip:", Math.log(2).toFixed(4));
}

function report(gameLog) {
  const elo = buildElo(gameLog);
  const { games, unpaired, seasons, teams, current, peaks } = elo;

  console.log(`Games rated: ${games.length}   unpaired and skipped: ${unpaired.length}`);
  console.log(`Settings: K=${ELO_K}, offseason carryover=${ELO_CARRYOVER}, margin of victory on\n`);

  const s = score(gameLog, {});
  console.log(`Predictive check: ${(s.acc * 100).toFixed(1)}% of ${s.n} games called right, log loss ${s.logloss.toFixed(4)} vs 0.6931 for a coin flip\n`);

  reconcile(seasons);

  if (unpaired.length) {
    console.log("Skipped, only one side is in the log:");
    for (const u of unpaired) console.log(`  ${u.year} ${u.date} ${u.team} vs ${u.opp} (${u.pts} pts logged)`);
    console.log();
  }

  console.log("End of season ratings\n");
  const years = [...new Set(seasons.map(r => r.year))];
  for (const y of years) {
    const rows = seasons.filter(r => r.year === y);
    console.log(`  ${y}  ` + rows.map(r => `${r.team} ${r0(r.elo)} (${r.w}-${r.l})`).join("  "));
  }

  console.log("\nRatings today, after the 2026 final\n");
  for (const c of current) console.log(`  ${c.team.padEnd(4)} ${r0(c.elo)}   last played ${c.lastYear}`);

  console.log("\nPeak and trough, any point in league history\n");
  const byPeak = [...peaks.entries()].sort((a, b) => b[1].high - a[1].high);
  for (const [team, p] of byPeak) {
    console.log(`  ${team.padEnd(4)} high ${r0(p.high)} (${p.highAt.year} ${p.highAt.date})   low ${r0(p.low)} (${p.lowAt.year} ${p.lowAt.date})`);
  }

  // Same order the card uses: by the winner's chance at tipoff, shift breaking
  // ties. Sorting on shift instead ranks blowouts over long shots.
  console.log("\nTwenty biggest upsets\n");
  const swings = [...games]
    .map(g => ({ g, p: g.aPts > g.bPts ? g.expA : 1 - g.expA }))
    .sort((x, y) => x.p - y.p || y.g.shift - x.g.shift)
    .slice(0, 20);
  for (const { g, p } of swings) {
    const winner = g.aPts > g.bPts ? g.a : g.b;
    const loser = g.aPts > g.bPts ? g.b : g.a;
    const wPre = g.aPts > g.bPts ? g.aPre : g.bPre;
    const lPre = g.aPts > g.bPts ? g.bPre : g.aPre;
    console.log(`  ${g.year} ${g.date.padStart(5)}  ${winner} ${Math.max(g.aPts, g.bPts)}-${Math.min(g.aPts, g.bPts)} ${loser}   win prob ${(p * 100).toFixed(0)}%   ${winner} was ${r0(wPre)} vs ${r0(lPre)}, moved ${r0(g.shift)}`);
  }

  console.log("\nBest single season by end-of-year rating\n");
  const bestSeasons = [...seasons].sort((a, b) => b.elo - a.elo).slice(0, 12);
  for (const r of bestSeasons) console.log(`  ${r.year} ${r.team.padEnd(4)} ${r0(r.elo)}  (${r.w}-${r.l})`);

  // The champion and near-miss tables the Elo card shows. Both read the baked
  // TEAM_SEASONS finish, mapped onto the franchise line.
  const baked = bakedRecords();
  if (baked) {
    const finish = row => (baked[row.year + "|" + row.team] || {}).final || null;

    console.log("\nEvery champion, ranked by the rating they won it with\n");
    const champs = seasons.filter(r => finish(r) === "Champ").sort((a, b) => b.elo - a.elo);
    champs.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}  ${r.year} ${r.team.padEnd(4)} ${r0(r.elo)}  (${r.w}-${r.l})`));
    const missing = Object.values(baked).filter(b => b.final === "Champ").length - champs.length;
    if (missing) console.log(`  (${missing} champion seasons have no rated games and are missing here)`);

    console.log("\nBest teams that did not win it, on their season-end rating\n");
    const near = seasons.filter(r => finish(r) && finish(r) !== "Champ").sort((a, b) => b.elo - a.elo).slice(0, 12);
    near.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}  ${r.year} ${r.team.padEnd(4)} ${r0(r.elo)}  (${r.w}-${r.l})  ${finish(r)}`));

    console.log("\nBest teams that missed the playoffs\n");
    const out = seasons.filter(r => finish(r) === "Missed").sort((a, b) => b.elo - a.elo).slice(0, 12);
    out.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}  ${r.year} ${r.team.padEnd(4)} ${r0(r.elo)}  (${r.w}-${r.l})`));
  }

  // Finals measured at tipoff. Both tables read the C game rather than the
  // season-end rating, so nobody is judged on the game being described.
  const finals = eloFinals(games);
  console.log(`\nBest championship matchups, combined rating at tipoff (${finals.length} finals)\n`);
  [...finals].sort((a, b) => b.combined - a.combined).forEach((f, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${f.year}  ${f.champ.padEnd(4)} ${r0(f.champPre)} vs ${f.loser.padEnd(4)} ${r0(f.loserPre)}   combined ${r0(f.combined)}   champ odds ${(f.champOdds * 100).toFixed(0)}%   final ${f.champPts}-${f.loserPts}`);
  });

  console.log("\nRunners-up, ranked on the rating they took into the final\n");
  [...finals].sort((a, b) => b.loserPre - a.loserPre).forEach((f, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${f.year} ${f.loser.padEnd(4)} ${r0(f.loserPre)}  lost ${f.loserPts}-${f.champPts} to ${f.champ}  (left at ${r0(f.loserPost)})`);
  });

  const semis = games.filter(g => g.type === "P").map(g => ({ ...g, combined: g.aPre + g.bPre }));
  console.log(`\nBest semifinals, combined rating at tipoff (${semis.length} played)\n`);
  [...semis].sort((a, b) => b.combined - a.combined).slice(0, 20).forEach((g, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${g.year}  ${g.a.padEnd(4)} ${r0(g.aPre)} vs ${g.b.padEnd(4)} ${r0(g.bPre)}   combined ${r0(g.combined)}   ${g.aPts}-${g.bPts}`);
  });

  // Rating at tipoff says nothing about who won, which is the point: these are
  // the games that were worth the most and the least walking in.
  const byStrength = games.map(g => ({ ...g, combined: g.aPre + g.bPre }));
  const label = g => (g.type === "C" ? " final" : g.type === "P" ? " semi" : "");
  const strengthRow = (g, i) =>
    `  ${String(i + 1).padStart(2)}  ${g.year} ${g.date.padStart(5)}  ${g.a.padEnd(4)} ${r0(g.aPre)} vs ${g.b.padEnd(4)} ${r0(g.bPre)}   combined ${r0(g.combined)}   ${g.aPts}-${g.bPts}${label(g)}`;

  console.log("\nStrongest 20 games ever played, combined rating at tipoff\n");
  [...byStrength].sort((a, b) => b.combined - a.combined).slice(0, 20).forEach((g, i) => console.log(strengthRow(g, i)));

  console.log("\nWeakest 20 games ever played, combined rating at tipoff\n");
  [...byStrength].sort((a, b) => a.combined - b.combined).slice(0, 20).forEach((g, i) => console.log(strengthRow(g, i)));

  // First game of a season to its last, so the offseason carryover is out of
  // it. A debut season opens on 1500 because there is nothing to carry, which
  // the start column makes visible.
  const moves = seasons.map(r => ({ ...r, delta: r.elo - r.startElo }));
  const moveRow = (r, i) =>
    `  ${String(i + 1).padStart(2)}  ${r.year} ${r.team.padEnd(4)} ${r0(r.startElo)} to ${r0(r.elo)}   ${r.delta >= 0 ? "+" : ""}${r0(r.delta)}   (${r.w}-${r.l}, ${r.g} g)`;

  console.log("\nBiggest climbs inside one season\n");
  [...moves].sort((a, b) => b.delta - a.delta).slice(0, 12).forEach((r, i) => console.log(moveRow(r, i)));

  console.log("\nBiggest falls inside one season\n");
  [...moves].sort((a, b) => a.delta - b.delta).slice(0, 12).forEach((r, i) => console.log(moveRow(r, i)));

  console.log("\nSeason count per franchise\n");
  for (const [team, rows] of Object.entries(teams)) {
    console.log(`  ${team.padEnd(4)} ${String(rows.length).padStart(2)} seasons, ${rows[0].year} to ${rows[rows.length - 1].year}`);
  }
}

const gameLog = await loadGameLog();
console.log(`Loaded ${gameLog.length} game_log rows\n`);
if (process.argv.includes("--tune")) tune(gameLog);
else report(gameLog);
