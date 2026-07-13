// Box score corrector. Reads a tab-separated paste for ONE team in ONE game,
// validates it, diffs it against the live game_log rows, and emits UPDATE SQL
// to paste into the Supabase SQL editor.
//
//   node scripts/boxscore.mjs <input.txt>
//
// Input file:
//
//   GAME: 6/28 SAC vs PDF
//   TEAM: SAC
//   Player            2P  2PA  3P  3PA  FT  FTA  R  S  A  B
//   Moses Abdelshaid   4    9   2    5   0    0  6  1  2  0
//
// (YEAR: defaults to 2026. Columns are tab-separated. Blank cell means 0.)
//
// Rules, per the spec:
//   - Every supplied column is replaced, including blanks (which mean 0).
//   - `foul` is NEVER written. The existing DB value is preserved.
//   - pts, fgm, fga, tpm, tpa are DERIVED, never pasted.
//   - gmsc is always recomputed from the merged row (new stats + existing foul).
//   - Nothing is inserted or deleted. Unmatched players are flagged only.

import { readFileSync } from "node:fs";

const SUPABASE_URL = "https://msvgstunqxjmmsmmumgg.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdmdzdHVucXhqbW1zbW11bWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMTU4MjIsImV4cCI6MjA5MTg5MTgyMn0.QkOb0eu5dlHrItsFeFCU8KxAakgQnYjM7pqv7zzmURU";

const DEFAULT_YEAR = 2026;

// PCAL Game Score. Mirrors computeGmSc in src/LiveSection.jsx. Rebound weight
// is 0.5 (no ORB/DRB split) and missed FTs ADD 0.4, which is non-standard but
// is how every historical PCAL row was computed. Depends on `foul`, which is
// why a partial update still has to read the existing row.
function computeGmSc(s) {
  const v =
    s.pts +
    0.4 * s.fgm -
    0.7 * s.fga +
    0.4 * (s.fta - s.ftm) +
    0.5 * s.reb +
    s.stl +
    0.7 * s.ast +
    0.7 * s.blk -
    0.4 * s.foul;
  return Math.round(v * 10) / 10;
}

// Header alias map. Anything not listed here is rejected rather than dropped,
// so a column we don't understand can never be silently ignored.
const ALIASES = {
  player: "player", name: "player", "": "player", // Sheets exports leave A1 blank
  "2p": "p2m", "2pm": "p2m",
  "2pa": "p2a",
  "3p": "p3m", "3pm": "p3m", tpm: "p3m",
  "3pa": "p3a", tpa: "p3a",
  ft: "ftm", ftm: "ftm",
  fta: "fta",
  r: "reb", reb: "reb", trb: "reb",
  s: "stl", stl: "stl",
  a: "ast", ast: "ast",
  b: "blk", blk: "blk",
  // Accepted but never written. Flagged loudly if present.
  pf: "foul", f: "foul", foul: "foul", fouls: "foul",
  // Accepted and used only as a cross-check against the derived value.
  pts: "pts", p: "pts",
  // Accepted and ignored. Not columns in game_log.
  pos: "_skip", min: "_skip", mp: "_skip", to: "_skip",
};

const REQUIRED = ["player", "p2m", "p2a", "p3m", "p3a", "ftm", "fta", "reb", "stl", "ast", "blk"];

// Normalize a name to a sorted token list so "SHACKER Mark" (the DB's LAST
// First format) matches a pasted "Mark Shacker". Punctuation and case stripped.
function tokens(name) {
  return (name || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) fail(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function parseInput(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  let year = DEFAULT_YEAR;
  let date = null, team = null, opp = null, myTeam = null;
  const maps = {};
  const body = [];

  for (const line of lines) {
    const m = line.match(/^\s*(GAME|TEAM|YEAR|MAP)\s*:\s*(.+)$/i);
    if (!m) { body.push(line); continue; }
    const key = m[1].toUpperCase();
    const val = m[2].trim();
    if (key === "YEAR") year = Number(val);
    else if (key === "TEAM") myTeam = val.toUpperCase();
    else if (key === "MAP") {
      // MAP: Mat = SHARKAWY Mathew
      const p = val.split("=");
      if (p.length !== 2) fail(`Could not parse MAP line: "${val}"\nExpected: MAP: Mat = SHARKAWY Mathew`);
      maps[p[0].trim().toUpperCase()] = p[1].trim();
    }
    else if (key === "GAME") {
      // "6/28 SAC vs PDF"  or  "6/28 SAC @ PDF"
      const g = val.match(/^(\S+)\s+([A-Za-z]{3})\s*(?:vs\.?|@|v)\s*([A-Za-z]{3})\s*$/i);
      if (!g) fail(`Could not parse GAME line: "${val}"\nExpected: GAME: 6/28 SAC vs PDF`);
      date = g[1];
      team = g[2].toUpperCase();
      opp = g[3].toUpperCase();
    }
  }

  if (!date) fail("Missing GAME: line. Expected: GAME: 6/28 SAC vs PDF");
  if (!myTeam) fail("Missing TEAM: line. Which of the two teams is this box score for?");
  if (myTeam !== team && myTeam !== opp) {
    fail(`TEAM: ${myTeam} is not one of the teams in the GAME line (${team}, ${opp}).`);
  }
  // Orient team/opp so `team` is the side we're updating.
  if (myTeam === opp) [team, opp] = [opp, team];

  if (body.length < 2) fail("Need a header row and at least one player row.");

  // Accept either a spreadsheet paste (tabs) or a CSV export (commas). Pick
  // whichever delimiter actually splits the header into more columns.
  const delim = body[0].split("\t").length >= body[0].split(",").length ? "\t" : ",";

  const rawHeader = body[0].split(delim).map((h) => h.trim());
  if (rawHeader.length < 2) {
    fail("Header row has only one column. Paste it as TSV or CSV, not space-aligned text.");
  }
  const cols = rawHeader.map((h) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    const canon = ALIASES[key];
    if (!canon) fail(`Unrecognized column header: "${h}"\nKnown: 2P 2PA 3P 3PA FT FTA R S A B (plus Player, PTS, POS)`);
    return canon;
  });

  for (const need of REQUIRED) {
    if (!cols.includes(need)) fail(`Missing required column: ${need === "player" ? "Player" : need}`);
  }

  const rows = body.slice(1).map((line, i) => {
    const cells = line.split(delim);
    const rec = {};
    cols.forEach((c, j) => {
      const raw = (cells[j] ?? "").trim();
      if (c === "_skip") return;
      if (c === "player") { rec.player = raw; return; }
      // Blank means 0. This is deliberate: the spec is replace-all-cells.
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        fail(`Row ${i + 1} (${cells[0] || "?"}): column ${c} has invalid value "${raw}"`);
      }
      rec[c] = n;
      if (raw === "") (rec._blanks ||= []).push(c);
    });
    if (!rec.player) fail(`Row ${i + 1} has no player name.`);
    return rec;
  });

  return { year, date, team, opp, rows, cols, maps };
}

// Resolve a pasted name to one of this game's DB rows. Tiered, and every tier
// requires a UNIQUE hit, so an ambiguous name is never silently guessed:
//   1. exact token-set match     "Mark Shacker"  -> SHACKER Mark
//   2. unique subset match       "Andrew"        -> ISHAK Andrew
//   3. unique prefix match       "Mat"           -> SHARKAWY Mathew
// Uniqueness is only checked within one team's rows for one game, which is a
// dozen names at most, so prefix matching is far safer here than it sounds.
// A MAP: line in the input always wins over all of this.
function matchPlayer(pasted, dbRows, maps) {
  const override = maps[pasted.toUpperCase()];
  if (override) {
    const hit = dbRows.find((d) => d.player.toUpperCase() === override.toUpperCase());
    if (!hit) fail(`MAP: "${pasted}" = "${override}" but no row named "${override}" exists in this game.`);
    return { row: hit, how: "MAP: override" };
  }

  const want = tokens(pasted);
  const cand = dbRows.map((d) => ({ d, toks: tokens(d.player) }));

  const exact = cand.filter((c) => c.toks.join(" ") === want.join(" "));
  if (exact.length === 1) return { row: exact[0].d, how: "exact" };

  const subset = cand.filter((c) => want.every((w) => c.toks.includes(w)));
  if (subset.length === 1) return { row: subset[0].d, how: "partial name" };
  if (subset.length > 1) return { row: null, how: `ambiguous: matches ${subset.map((c) => c.d.player).join(", ")}` };

  const prefix = cand.filter((c) => want.every((w) => c.toks.some((t) => t.startsWith(w))));
  if (prefix.length === 1) return { row: prefix[0].d, how: "prefix" };
  if (prefix.length > 1) return { row: null, how: `ambiguous: matches ${prefix.map((c) => c.d.player).join(", ")}` };

  return { row: null, how: "no match" };
}

// Turn a pasted row into the full set of DB columns we will write.
function derive(r, existingFoul) {
  const fgm = r.p2m + r.p3m;
  const fga = r.p2a + r.p3a;
  const pts = 2 * r.p2m + 3 * r.p3m + r.ftm;
  const s = {
    pts,
    reb: r.reb, stl: r.stl, ast: r.ast, blk: r.blk,
    fgm, fga,
    ftm: r.ftm, fta: r.fta,
    tpm: r.p3m, tpa: r.p3a,
    foul: existingFoul, // never written, only used for gmsc
  };
  s.gmsc = computeGmSc(s);
  return s;
}

function validate(r) {
  const errs = [];
  if (r.p2m > r.p2a) errs.push(`2P ${r.p2m} > 2PA ${r.p2a}`);
  if (r.p3m > r.p3a) errs.push(`3P ${r.p3m} > 3PA ${r.p3a}`);
  if (r.ftm > r.fta) errs.push(`FT ${r.ftm} > FTA ${r.fta}`);
  return errs;
}

// Columns we write. `foul` is conspicuously absent and stays absent.
const WRITE_COLS = ["pts", "reb", "stl", "ast", "blk", "fgm", "fga", "ftm", "fta", "tpm", "tpa", "gmsc"];

async function main() {
  const file = process.argv[2];
  if (!file) fail("Usage: node scripts/boxscore.mjs <input.txt>");

  const { year, date, team, opp, rows, cols, maps } = parseInput(readFileSync(file, "utf8"));

  // Live rows for exactly this team in exactly this game. Including `opp` in
  // the key is what makes doubleheaders unambiguous.
  const dbRows = await rest(
    `game_log?year=eq.${year}&date=eq.${encodeURIComponent(date)}&team=eq.${team}&opp=eq.${opp}&order=id.asc`
  );

  // Best-effort schedule lookup, purely informational. The two teams meet
  // twice (double round robin), so narrow to the meeting on this date by
  // comparing game_date ("2026-06-07") to the M/D the game_log uses ("6/7").
  const allMeetings = await rest(
    `schedule?season=eq.${year}&or=(and(home_team.eq.${team},away_team.eq.${opp}),and(home_team.eq.${opp},away_team.eq.${team}))`
  );
  const shortDate = (iso) => {
    const [, m, d] = (iso || "").split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const sched = allMeetings.filter((g) => shortDate(g.game_date) === date);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`GAME     ${year} ${date}  ${team} vs ${opp}   (updating ${team})`);
  if (sched.length === 1) {
    const g = sched[0];
    console.log(`SCHEDULE game_id ${g.game_id}, week ${g.week}, ${g.game_date}, ${g.location}`);
  } else {
    console.log(`SCHEDULE no unique match on ${date}. These two teams meet on: ${allMeetings.map((g) => shortDate(g.game_date)).join(", ") || "(none found)"}`);
  }
  console.log(`DB       ${dbRows.length} existing game_log rows for ${team}`);
  console.log(`PASTE    ${rows.length} players`);
  console.log("=".repeat(64));

  if (dbRows.length === 0) {
    fail(`No game_log rows found for ${team} vs ${opp} on ${date}, ${year}.\nCheck the date format (game_log uses M/D, e.g. 6/28) and the team codes.`);
  }

  if (cols.includes("foul")) {
    console.log(`\nNOTE: your paste has a fouls column. It is being ignored. Existing DB fouls are preserved, as specified.`);
  }

  const updates = [];
  const flags = [];
  const matchedIds = new Set();

  console.log(`\n--- NAME MATCHING ---`);
  for (const r of rows) {
    const errs = validate(r);
    if (errs.length) flags.push(`IMPOSSIBLE STATS  ${r.player}: ${errs.join("; ")}`);

    const { row: db, how } = matchPlayer(r.player, dbRows, maps);
    if (!db) {
      console.log(`  ${r.player.padEnd(18)} ->  NO MATCH (${how})`);
      flags.push(`NO MATCHING ROW   "${r.player}" (${how}). Not inserted. Add a MAP: line to resolve.`);
      continue;
    }
    console.log(`  ${r.player.padEnd(18)} ->  ${db.player.padEnd(24)} id ${db.id}   [${how}]`);
    if (matchedIds.has(db.id)) fail(`Two paste rows both resolved to ${db.player}. Disambiguate with a MAP: line.`);
    matchedIds.add(db.id);

    const next = derive(r, db.foul || 0);

    // If they sent a PTS column, it is an independent check on the shooting
    // columns. A mismatch means the paste contradicts itself, so refuse.
    if (r.pts !== undefined && r.pts !== next.pts) {
      errs.push(`PTS column says ${r.pts} but 2P/3P/FT derive to ${next.pts}`);
      flags.push(`PTS MISMATCH      ${r.player}: paste says ${r.pts}, shooting columns give ${next.pts}`);
    }

    // A blank cell is written as 0 (your rule). Call it out when that actually
    // destroys a nonzero value, since a blank is often just an unfilled cell.
    for (const c of r._blanks || []) {
      const col = { p2m: "fgm", p2a: "fga", p3m: "tpm", p3a: "tpa", ftm: "ftm", fta: "fta", reb: "reb", stl: "stl", ast: "ast", blk: "blk" }[c];
      if (col && Number(db[col] ?? 0) !== 0 && Number(next[col]) === 0) {
        flags.push(`BLANK ZEROES OUT  ${db.player}: ${col} was ${db[col]}, blank cell sets it to 0`);
      }
    }

    const changed = WRITE_COLS.filter((c) => Number(db[c] ?? 0) !== Number(next[c]));
    updates.push({ db, next, changed, errs });
  }

  for (const d of dbRows) {
    if (!matchedIds.has(d.id)) {
      flags.push(`NOT IN PASTE      ${d.player} (id ${d.id}) has a game_log row but is missing from your paste. Left untouched.`);
    }
  }

  // Diff report
  console.log(`\n--- DIFF ---`);
  let changedCount = 0;
  for (const u of updates) {
    if (u.changed.length === 0) {
      console.log(`\n  ${u.db.player}  (id ${u.db.id})  no change`);
      continue;
    }
    changedCount++;
    console.log(`\n  ${u.db.player}  (id ${u.db.id})  foul ${u.db.foul} preserved`);
    for (const c of u.changed) {
      console.log(`      ${c.padEnd(5)} ${String(u.db[c] ?? 0).padStart(6)}  ->  ${String(u.next[c]).padStart(6)}`);
    }
  }

  // Team totals, old vs new, so a transcription error shows up against the
  // actual final score.
  const oldPts = dbRows.reduce((a, d) => a + (d.pts || 0), 0);
  const newPts = updates.reduce((a, u) => a + u.next.pts, 0)
    + dbRows.filter((d) => !matchedIds.has(d.id)).reduce((a, d) => a + (d.pts || 0), 0);
  console.log(`\n--- TEAM TOTALS (${team}) ---`);
  console.log(`  PTS  ${oldPts}  ->  ${newPts}`);
  console.log(`  Check this against the actual final score before running the SQL.`);

  if (flags.length) {
    console.log(`\n--- FLAGS (${flags.length}) ---`);
    for (const f of flags) console.log(`  ${f}`);
  }

  const blocking = updates.some((u) => u.errs.length);
  if (blocking) {
    console.log(`\nNo SQL emitted: at least one player has impossible stats (makes > attempts). Fix the paste and rerun.\n`);
    process.exit(1);
  }

  if (changedCount === 0) {
    console.log(`\nNothing to update. The DB already matches your paste.\n`);
    return;
  }

  console.log(`\n--- SQL (${changedCount} rows) ---\n`);
  console.log("BEGIN;");
  for (const u of updates) {
    if (u.changed.length === 0) continue;
    const sets = WRITE_COLS.map((c) => `${c} = ${u.next[c]}`).join(", ");
    // The player name goes on its own line ABOVE the statement, never trailing
    // it. A long UPDATE line can get soft-wrapped on the way into the SQL
    // editor, and a wrapped trailing comment spills its text onto the next
    // line as bare SQL, which is a syntax error.
    console.log(`-- ${u.db.player} (id ${u.db.id})`);
    console.log(`UPDATE game_log SET ${sets}, updated_at = now() WHERE id = ${u.db.id};`);
  }
  console.log("COMMIT;");
  console.log(`\nPaste into the Supabase SQL editor. Review the row count before COMMIT.`);
  console.log(`updated_at moves, so every client picks this up on their next page load.\n`);
}

main();
