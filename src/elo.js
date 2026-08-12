// Team Elo, derived from game_log. Shared by App.jsx (the Elo Ratings card)
// and scripts/elo.mjs (the verification run), so the numbers on the site and
// the numbers in the terminal can never drift apart.
//
// Elo is a rating that only moves when you play. Beat a team rated above you
// and you take a lot; beat a team rated below you and you take a little.
// Every point one team gains, the other loses, so the league always averages
// out to the starting rating.

// A new franchise enters at 1500. Nothing about the number is magic, it is
// just the middle.
export const ELO_START = 1500;

// How far a single game can move a team. Calibrated by grid search over 617
// games of history (`node scripts/elo.mjs --tune`): K=28 with the margin
// multiplier below sits at the log loss floor. Higher K chases hot streaks,
// lower K takes too long to notice a roster that turned over. The surface is
// flat from 24 to 32, so nothing hangs on the exact value.
export const ELO_K = 28;

// Offseason regression toward 1500, applied once per year elapsed. 0.85 hands
// back 15% of a team's edge (or deficit) before the next June. That is milder
// than the 25% a pro league uses, and it is what the data asked for: PCAL
// franchises hold their level across winters better than roster churn would
// suggest, which is the Hayward and Sacramento dynasties showing up in the
// math. A franchise that sits out regresses again for that year, which is
// also how the cancelled 2020 season is handled without a special case.
export const ELO_CARRYOVER = 0.85;

// Franchise lines. NOR became CON, SRA became PLE (San Ramon moved to
// Pleasanton). MCS is the combined 2018 Modesto/CIS team, which runs on the
// Modesto line. CIS in 2014, 2019 and 2021 is its own team and stays separate.
export const ELO_FRANCHISE = { NOR: "CON", SRA: "PLE", MCS: "MOD" };

// Resolve a game_log team code to its franchise line. The 2018 case is
// handled by year because App.jsx relabels those rows to MCS on load while a
// raw pull from Supabase still says MOD or CIS.
export function eloTeam(team, year) {
  if (year === 2018 && (team === "MOD" || team === "CIS")) return "MOD";
  return ELO_FRANCHISE[team] || team;
}

// Known-wrong team totals, from the parked reconciliation in docs/STATUS.md.
// Both are games where the winner is undercounted in game_log badly enough to
// flip the result, and Andrew confirmed the baked TEAM_SEASONS records are
// the correct ones. Without these, Elo hands two wins to the wrong teams.
// The player-level box scores are still wrong; only the team total is patched
// here, and only for Elo.
export const ELO_SCORE_FIXES = [
  { year: 2024, date: "7/7", team: "SJO", opp: "HAY", pts: 43 },
  { year: 2024, date: "8/4", team: "SAC", opp: "MOD", pts: 41 },
];

// Game types that count. Exhibition (X) is excluded, matching every other
// total in the app. Regular season and playoffs both move the rating.
const COUNTED = new Set(["R", "P", "C"]);

// Playoff day puts the semifinals and the final on one date, so date alone
// does not order them. Ranking by type inside a date is what makes the final
// the last game of the season, which the champion and near-miss lists both
// depend on: without it a semifinal can land after the final and credit a
// beaten finalist for a win it had already banked.
const TYPE_RANK = { R: 0, P: 1, C: 2 };

const dateKey = (d) => {
  const [m, day] = String(d || "").split("/").map(Number);
  return (m || 0) * 100 + (day || 0);
};

// Pair the per-player rows into team-vs-team results. A team-game is keyed on
// year, date, team and opponent so a doubleheader does not merge into one
// game. Returns games in the order they were played.
export function eloGames(gameLog, fixes = ELO_SCORE_FIXES) {
  const totals = new Map();
  for (const r of gameLog) {
    if (r[6] !== 1) continue;
    if (!COUNTED.has(r[5])) continue;
    const year = r[20], date = r[4];
    const team = eloTeam(r[1], year), opp = eloTeam(r[2], year);
    if (!team || !opp || !date || team === opp) continue;
    const key = year + "|" + date + "|" + team + "|" + opp;
    const cur = totals.get(key) || { year, date, team, opp, week: r[3], type: r[5], pts: 0 };
    cur.pts += r[7] || 0;
    totals.set(key, cur);
  }

  for (const f of fixes) {
    const key = f.year + "|" + f.date + "|" + eloTeam(f.team, f.year) + "|" + eloTeam(f.opp, f.year);
    const row = totals.get(key);
    if (row) { row.pts = f.pts; row.fixed = true; }
  }

  const games = [], seen = new Set();
  const unpaired = [];
  for (const [key, row] of totals) {
    const mirrorKey = row.year + "|" + row.date + "|" + row.opp + "|" + row.team;
    const mirror = totals.get(mirrorKey);
    // One side logged and not the other. Cannot be rated, so it is reported
    // rather than guessed at.
    if (!mirror) { unpaired.push(row); continue; }
    const dedupe = [row.year, row.date, ...[row.team, row.opp].sort()].join("|");
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    games.push({
      year: row.year, date: row.date, week: row.week, type: row.type,
      a: row.team, b: row.opp, aPts: row.pts, bPts: mirror.pts,
      fixed: !!(row.fixed || mirror.fixed),
      _k: key,
    });
  }

  games.sort((x, y) =>
    x.year - y.year ||
    dateKey(x.date) - dateKey(y.date) ||
    (TYPE_RANK[x.type] ?? 0) - (TYPE_RANK[y.type] ?? 0) ||
    (x.week || 0) - (y.week || 0) ||
    (x.a < y.a ? -1 : 1));

  return { games, unpaired };
}

// Expected win probability for a team rated `mine` against `theirs`.
export const eloExpected = (mine, theirs) => 1 / (1 + Math.pow(10, (theirs - mine) / 400));

// Margin of victory multiplier. A 20 point win moves the rating more than a
// 2 point win, but on a log curve so a blowout cannot run away with it. The
// denominator damps wins by an already-favored team, which is what stops a
// dominant team from inflating itself against the same weak opponent twice a
// season. Standard FiveThirtyEight form.
export const eloMov = (margin, winnerEdge) =>
  Math.log(Math.abs(margin) + 1) * (2.2 / (0.001 * winnerEdge + 2.2));

// Walk every game in order and return the full rating history.
//
//   games      each game with both teams' rating before and after
//   seasons    end-of-season rating per franchise per year
//   teams      { [franchise]: [season rows in year order] }
//   current    latest rating per franchise, sorted high to low
//   peaks      best and worst rating each franchise ever held
export function buildElo(gameLog, opts = {}) {
  const K = opts.k ?? ELO_K;
  const carry = opts.carryover ?? ELO_CARRYOVER;
  const start = opts.start ?? ELO_START;
  const useMov = opts.mov ?? true;
  // Scoring is not flat across eras (2005 to 2010 carried automatic
  // free-throw points inside PTS, so margins ran large). Normalizing divides
  // each margin by its season's average before the log, putting a 20 point
  // 2008 win and a 20 point 2026 win on different footing. Tested and it does
  // not improve prediction, so it is off, but the switch stays for auditing.
  const normalize = opts.normalizeMargin ?? false;

  const { games, unpaired } = eloGames(gameLog, opts.fixes);

  let marginScale = null;
  if (normalize) {
    const byYear = new Map();
    for (const g of games) {
      const y = byYear.get(g.year) || { n: 0, sum: 0 };
      y.n++; y.sum += Math.abs(g.aPts - g.bPts);
      byYear.set(g.year, y);
    }
    const all = [...byYear.values()].reduce((s, y) => s + y.sum, 0) /
                [...byYear.values()].reduce((s, y) => s + y.n, 0);
    marginScale = new Map([...byYear].map(([y, v]) => [y, all / (v.sum / v.n)]));
  }
  const rating = new Map();     // franchise -> current rating
  const lastYear = new Map();   // franchise -> year of its last rated game
  const peak = new Map();       // franchise -> { high, low, ... }
  const seasonEnd = new Map();  // year|franchise -> season row
  const rated = [];

  // Bring a team up to the current season, regressing once per year elapsed.
  const ready = (team, year) => {
    if (!rating.has(team)) {
      rating.set(team, start);
      lastYear.set(team, year);
      return;
    }
    let gap = year - lastYear.get(team);
    // 2020 was cancelled, so it is not a year a team sat out by choice. It
    // still regresses, since a season passed either way.
    while (gap > 0) {
      rating.set(team, start + (rating.get(team) - start) * carry);
      gap--;
    }
    lastYear.set(team, year);
  };

  const touchPeak = (team, year, date, elo) => {
    const p = peak.get(team);
    if (!p) { peak.set(team, { high: elo, highAt: { year, date }, low: elo, lowAt: { year, date } }); return; }
    if (elo > p.high) { p.high = elo; p.highAt = { year, date }; }
    if (elo < p.low) { p.low = elo; p.lowAt = { year, date }; }
  };

  for (const g of games) {
    ready(g.a, g.year);
    ready(g.b, g.year);
    const aPre = rating.get(g.a), bPre = rating.get(g.b);

    // Ties do not exist anywhere in 21 seasons of the log, but if one ever
    // lands, treat it as half a win rather than dropping the game.
    const aScore = g.aPts > g.bPts ? 1 : g.aPts < g.bPts ? 0 : 0.5;
    const rawMargin = Math.abs(g.aPts - g.bPts);
    const margin = marginScale ? rawMargin * (marginScale.get(g.year) || 1) : rawMargin;
    const winnerEdge = aScore === 1 ? aPre - bPre : aScore === 0 ? bPre - aPre : 0;
    const mult = useMov && margin > 0 ? eloMov(margin, winnerEdge) : 1;
    const shift = K * mult * (aScore - eloExpected(aPre, bPre));

    const aPost = aPre + shift, bPost = bPre - shift;
    rating.set(g.a, aPost);
    rating.set(g.b, bPost);
    touchPeak(g.a, g.year, g.date, aPost);
    touchPeak(g.b, g.year, g.date, bPost);

    // `i` is the game's position in league history, which is the x axis the
    // game-by-game chart plots against.
    rated.push({ ...g, i: rated.length, aPre, bPre, aPost, bPost, shift: Math.abs(shift), expA: eloExpected(aPre, bPre) });

    for (const [team, pts, opPts, post] of [[g.a, g.aPts, g.bPts, aPost], [g.b, g.bPts, g.aPts, bPost]]) {
      const key = g.year + "|" + team;
      const row = seasonEnd.get(key) || { year: g.year, team, elo: post, startElo: team === g.a ? aPre : bPre, w: 0, l: 0, g: 0 };
      row.elo = post;
      row.g++;
      if (pts > opPts) row.w++; else if (pts < opPts) row.l++;
      seasonEnd.set(key, row);
    }
  }

  const seasons = [...seasonEnd.values()].sort((a, b) => a.year - b.year || b.elo - a.elo);
  const teams = {};
  for (const row of seasons) (teams[row.team] = teams[row.team] || []).push(row);

  const current = [...rating.entries()]
    .map(([team, elo]) => ({ team, elo, lastYear: lastYear.get(team) }))
    .sort((a, b) => b.elo - a.elo);

  return { games: rated, unpaired, seasons, teams, current, peaks: peak, ratings: rating };
}

// How well the ratings called the games they have already seen. Accuracy is
// the readable number; log loss is the honest one, since it punishes a
// confident wrong call harder than a hedged one (0.6931 is what you score by
// calling every game a coin flip). Games where either team is playing its
// first ever game are skipped, because 1500 against 1500 is not a prediction.
export function eloHindsight(games) {
  const seen = new Set();
  let n = 0, hits = 0, loss = 0;
  for (const g of games) {
    const fresh = !seen.has(g.a) || !seen.has(g.b);
    seen.add(g.a); seen.add(g.b);
    if (fresh) continue;
    const p = eloExpected(g.aPre, g.bPre);
    const won = g.aPts > g.bPts ? 1 : 0;
    n++;
    if ((p > 0.5) === (won === 1)) hits++;
    loss += -(won * Math.log(p) + (1 - won) * Math.log(1 - p));
  }
  return { n, acc: n ? hits / n : 0, logloss: n ? loss / n : 0 };
}

// One row per final, measured at tipoff rather than after the fact. A team
// that loses the final is rated below what it was worth walking in, so a
// runner-up read from its season-end rating is being marked down for the one
// game the list is about. `pre` is the number before the final moved anything.
//
// Winner comes off the box score, which is what Elo rated, not off the baked
// TEAM_SEASONS. The two agree on every final: the known box score problems
// (2010, 2024) miss on the score without touching who won.
export function eloFinals(games) {
  const out = [];
  for (const g of games) {
    if (g.type !== "C") continue;
    const aWon = g.aPts > g.bPts;
    out.push({
      year: g.year, date: g.date, game: g,
      champ: aWon ? g.a : g.b,
      champPre: aWon ? g.aPre : g.bPre,
      champPost: aWon ? g.aPost : g.bPost,
      champPts: Math.max(g.aPts, g.bPts),
      loser: aWon ? g.b : g.a,
      loserPre: aWon ? g.bPre : g.aPre,
      loserPost: aWon ? g.bPost : g.aPost,
      loserPts: Math.min(g.aPts, g.bPts),
      combined: g.aPre + g.bPre,
      // Chance the eventual champion had at tipoff, by rating alone.
      champOdds: aWon ? g.expA : 1 - g.expA,
    });
  }
  return out;
}
