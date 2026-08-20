// Similarity scores, the method Doug Drinen built for Pro-Football-Reference and
// Basketball-Reference uses for Win Shares. It does not look for players who
// played alike. It looks for careers of the same quality and the same shape:
// how many seasons, how far the best year sits above the worst, whether the
// peak was short and high or long and level.
//
// PCAL substitutes AI Score for Win Shares, one value per player-season, summed
// across teams when someone played for two clubs in a year. PCAL records no
// positions, so every player is compared against every other player rather than
// against a positional group.
//
// The app computes this in the browser off the already-derived DATA.
// scripts/similarity.mjs runs the same functions in Node so the numbers can be
// checked outside React.

// A career is truncated to its best N seasons before anything is compared.
// Andrew set the default at 15 and exposed the other two in the UI.
export const CEILINGS = [5, 10, 15];
export const DEFAULT_CEILING = 15;

// A player needs this many seasons before they appear in the pool, matching
// the three-year gate Pro-Football-Reference uses.
export const MIN_SEASONS = 3;

export const TABLE_ROWS = 10;

// Best season counts full, second-best 0.95, third 0.90, and so on. At the
// 15-season ceiling the last slot still carries 0.30, so nothing a player did
// is thrown away outright.
const weight = i => Math.max(0, 1 - 0.05 * i);

const isGuest = name => /^GUEST\b/i.test(name || "") || /\bGuest$/i.test(name || "");

// Fold DATA (one row per player-team-season) into one vector per player.
// `chron` holds the seasons in career order, `sorted` holds them best to worst,
// which is the order every comparison runs in.
export function buildCareers(data) {
  const byPlayer = new Map();
  for (const r of data) {
    if (isGuest(r.player)) continue;
    let p = byPlayer.get(r.player);
    if (!p) { p = { player: r.player, byYear: new Map(), g: 0, careerAi: 0 }; byPlayer.set(r.player, p); }
    p.byYear.set(r.year, (p.byYear.get(r.year) || 0) + (r.aiScore || 0));
    p.g += r.g;
    p.careerAi += r.aiScore || 0;
  }
  const out = [];
  for (const p of byPlayer.values()) {
    const years = [...p.byYear.keys()].sort((a, b) => a - b);
    const chron = years.map(y => Math.round(p.byYear.get(y) * 10) / 10);
    out.push({
      player: p.player, years, chron,
      sorted: [...chron].sort((a, b) => b - a),
      seasons: years.length, first: years[0], last: years[years.length - 1],
      g: p.g, careerAi: Math.round(p.careerAi * 10) / 10,
    });
  }
  return out.sort((a, b) => b.careerAi - a.careerAi);
}

// Weighted sum of a career, best season first. A negative season would only
// drag the denominator down and make every score look better, so the floor
// at zero keeps a bad year from flattering the comparison.
export function careerValue(vec, ceiling) {
  let s = 0;
  const n = Math.min(vec.length, ceiling);
  for (let i = 0; i < n; i++) s += weight(i) * Math.max(vec[i], 0);
  return s;
}

// 100 means identical. Null when either career has nothing to compare, which
// is the point where Pro-Football-Reference stops too.
export function simScore(a, b, ceiling) {
  const A = a.slice(0, ceiling), B = b.slice(0, ceiling);
  const n = Math.max(A.length, B.length);
  while (A.length < n) A.push(0);
  while (B.length < n) B.push(0);
  const cvA = careerValue(A, ceiling), cvB = careerValue(B, ceiling);
  if (cvA <= 0 || cvB <= 0) return null;
  let penalty = 0;
  for (let i = 0; i < n; i++) penalty += weight(i) * Math.abs(A[i] - B[i]);
  return 100 * (1 - (2 * penalty) / (cvA + cvB));
}

// The first n seasons of a career, then sorted best to worst like any other
// vector. This is what makes the through-year-n table different from the
// career table: a 21-season player gets cut back to the length of whoever
// they are being measured against.
export function throughN(career, n) {
  return [...career.chron.slice(0, n)].sort((a, b) => b - a);
}

export function eligiblePool(careers, ceiling) {
  return careers.filter(c => c.seasons >= MIN_SEASONS && careerValue(c.sorted, ceiling) > 0);
}

// Both tables for one player. `through` runs every other career truncated to
// the target's season count; `career` runs them at full length. For a player
// who already has the longest career in the league the two are identical.
export function similarityTables(careers, targetName, ceiling) {
  const target = careers.find(c => c.player === targetName);
  if (!target) return null;
  const pool = eligiblePool(careers, ceiling).filter(c => c.player !== targetName);
  // `vec` is the season row that actually went into the comparison, so the
  // table can print the numbers the score was built from rather than a
  // different set. In the through-year-n table those are truncated careers.
  const rank = vecOf => pool
    .map(c => {
      const vec = vecOf(c).slice(0, ceiling);
      return { career: c, vec, score: simScore(target.sorted, vec, ceiling) };
    })
    .filter(r => r.score !== null)
    .sort((a, b) => b.score - a.score || a.career.player.localeCompare(b.career.player))
    .slice(0, TABLE_ROWS);
  return {
    target,
    ceiling,
    capped: target.sorted.slice(0, ceiling),
    careerValue: Math.round(careerValue(target.sorted, ceiling) * 10) / 10,
    through: rank(c => throughN(c, target.seasons)),
    career: rank(c => c.sorted),
  };
}
