# Status

Volatile working state. Update this as work moves. Durable rules live in `CLAUDE.md`.

## Similarity Scores tab (built and deployed 2026-08-20)

Replaced the NBA Comps tab under AI Analysis. The old tab held two hand-written blocks, 50 PCAL-to-NBA player comparisons and 15 "PCAL Player Twins" pairs, both pure prose with no computation behind them. Both are gone. They are recoverable from git history at 977e2da if any of that writing is wanted again.

The new tab computes Pro-Football-Reference similarity scores (the Doug Drinen method Basketball-Reference runs on Win Shares). Engine is `src/similarity.js`, pure functions, no React. `scripts/similarity.mjs` runs the same engine in Node off the live game_log the way `scripts/elo.mjs` does, so the numbers can be checked outside the browser.

Decisions Andrew made:

- Season value is AI Score, not Game Score. Game Score was tried first and made Ishak incomparable (best match 46.5, since a 21-season accumulation dwarfs everything). AI Score is a per-season rating, so shape drives the answer and Shehata comes out as a real comp.
- A player-year sums AI Score across teams when someone played for two clubs in a year, matching the career-total convention elsewhere in the app.
- Ceiling of 15 best seasons by default, with 5 and 10 selectable in the UI. The standard weight ladder (1, 0.95, 0.90 ...) reaches zero at season 21, which with 21-season careers on the books would silently discard a year. Any of the three ceilings keeps every weight positive.
- Pool is 3+ seasons and a career value above zero, the same gate PFR uses. That is 156 of 335 players.
- Both tables per player, through-year-n and full careers. With a 15 ceiling the two are identical for long careers and only diverge when the comparison player has more seasons than the target. Shacker is the case that earns it: through year 6 his top comps are all-timers, over full careers they are not.
- No positional filter. PCAL records no positions, so everyone is compared against everyone.

## Phase 3 (complete, not yet deployed)

Done 2026-06-06. Season DATA now derives entirely from GAME_LOG in the browser via `buildSeasonData` in App.jsx, and the old baked RAW array is deleted. game_log is the single source of truth. The full derive pipeline (DATA, AI Score, awards, leaders) moved from module-load time into `rebuildDerived()`, called from `installGameLog` after the log loads.

How the decisions landed:

- Game Score is recomputed from the box score with the standard formula, not read from the stored gmsc column (which was inconsistent for ~5% of games and inflated season totals, for example Sawiris 2014 stored-sum 88 vs formula 51). Formula: `PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA−FTM) + 0.5·REB + STL + 0.7·AST + 0.7·BLK − 0.4·FOUL`, applied per game in `installGameLog`, overriding row[19]. Counts R/P/C only; exhibition (X) excluded from every total including the AI Score share bonus.
- 2005-2010 had automatic free-throw-line points baked into PTS (no separate column; PTS exceeds 2·fgm+tpm+ftm by the automatic amount, ~13% of early-era scoring). Decision: keep those points (they were scored on the floor, so they count toward PTS/PPG/Game Score) but do NOT record them as made free throws. So FTM/FTA stay raw, FT% and TS% are left as the data has them, and no player gets fabricated shooting credit. 2005 has no FT data at all, so its Game Score carries no free-throw-miss penalty, which is correct since that era's free throws were automatic (no misses to penalize).
- AGE_MAP baked for 312 players (ages as of Aug 31). A player-year not listed is gap-filled by carrying the nearest known age by the year difference.
- 2018 Modesto and CIS consolidated to MCS in the derive (team relabel for all 2018 MOD/CIS rows). `MCS-2018` standings replace `MOD-2018` (1-8, Semis). CIS in 2014/2019/2021 stays standalone.
- Bassem Banoub's 2005 games corrected SRA to HAY in the derive.
- Voted 2024/2025 First Team (MVP and All-PCAL) baked as `VOTED_FIRST_TEAM` and seeded onto DATA before the awards recompute, since game_log carries no awards. Second Team for those years still recomputes from AI Score.
- Alias merges and guest naming applied in `installGameLog` (PLAYER_MERGE extended; anonymous placeholders become "{year} {team} Guest"; named guests keep "GUEST LASTNAME FIRSTNAME").

Verified end to end in Node against the live game_log: 1247 season rows, 200 awards, AI Score and leaders all compute, both voted MVPs (Simon 2024/2025) and hardcoded MVPs intact. The roster-level diff vs the old baked DATA is in `phase3_diff_report.md` (26 baked-only, 45 derived-only). Note: that report's Game Score value-diffs were generated during the earlier stored-sum exploration and predate the formula decision above, so the gmSc magnitudes there are superseded; the roster and base-stat findings still hold.

Original locked decisions (kept for the record):

- Count all games: regular, playoff, championship.
- Recompute First, Second, and MVP awards from Game Score for all years 2005 to 2025. Simon Abdelmalak is the confirmed 2024 and 2025 AI Score MVP.
- Age stays as a baked AGE_MAP extracted from RAW before deletion.
- VOTED_AWARDS_BY_YEAR stays baked and untouched as a separate honor layer.
- TEAM_SEASONS stays baked.
- Eleven name aliases confirmed for PLAYER_MERGE.
- 2018 combined Modesto/CIS team stays as MCS with an MCS-2018 TEAM_SEASONS entry. Do not create a separate MOD-2018 entry.
- Guest rows: anonymous placeholders become "{year} {team} Guest." Named guests (for example GUEST NAKHLA BESADA) stay as "GUEST LASTNAME FIRSTNAME" and never count toward real player career totals.
- "HANNA FR DAVID" is the canonical name for the Hayward priest. San Jose 2019 David Hanna is a separate person.

## Phase 2 (deployed and validated)

GAME_LOG loads from Supabase. Row count confirmed matching at 8,758. Career and season leaderboard totals still read from the baked DATA array, which is why Phase 3 was prioritized.

## Teams Hub tab (built)

2026 Standings table (regular season only, sorted by win pct, total wins, head to head, strength of wins). Rosters and Season Stats section with per player rows (jersey number, display name, G, PPG, RPG, best of APG/SPG/BPG, TS%), expandable player cards (avatar, name with gray age inline, experience, 2026 averages, season totals, shooting splits). Admin: Career links On/Off toggle and per team jersey number editing. All hub internal helpers prefixed with `th` to avoid collisions.

## Known data quality items

- 2005 has a systematic steals/assists column swap affecting many player seasons. Parked for game by game correction against original scoresheets. A blanket UPDATE is unsafe.
- PLE 2022 steals/assists swap, surfaced by Phase 3, same signature as 2005: HANNA ANDRE, MIKHAIL FADY, NAKHLA MARK, SEMARY MINA, TAWDROS MARIOS, plus NAKHLA JOHN (SRA 2012) and ISHAK ANDREW (SJO 2006). game_log has stl and ast swapped vs the old baked DATA. Parked for game by game correction.
- SRA 2012 cluster: KALDAS GEORGE, LOUIS PHILIP, NAGUIB WASSIM, OKI CHRIS, SHENOUDA STEVE, JACOUB MINA show assorted reb and fg entry differences vs old baked DATA. Parked.
- About 45 player-seasons differ only in foul count between game_log and the old baked DATA. Minor; game_log wins and the only downstream effect is Game Score.
- Hanna George career rebounds: 711 in game_log vs 716 in baked DATA. 2005 value drift, not a migration defect.
- Nashed George: 714 in game_log vs 707 in baked DATA. game_log correctly includes his 2011 playoff and championship games that DATA omitted.
- Full diff report at `phase3_diff_report.md`.

### Parked 2026-08-10: 2024 and 2025 game results disagree with TEAM_SEASONS

Recomputing team records from game_log does not reproduce the baked `TEAM_SEASONS` for 2024 or 2025. Andrew confirmed the baked table is the correct one in both years, so the errors are in game_log. 2023 reproduces exactly, which is also how the W-L convention was confirmed: regular season plus playoffs, exhibition excluded.

2024 is diagnosed and unambiguous. Two games are recorded with the winner undercounted, which flipped the result. The losing side's total is right in both.

- 7/7/2024, SJO vs HAY. Log has SJO 40, HAY 41. Correct is SJO 43, HAY 41. SJO is 3 points short.
- 8/4/2024, SAC vs MOD. Log has SAC 32, MOD 33. Correct is SAC 41, MOD 33. SAC is 9 points short.

Fixing those two brings 2024 into full agreement (SAC 10-2, SJO 7-4, MOD 3-7, HAY 2-8).

2025 is not resolved. The log gives HAY 3-7 and MOD 2-8 where the baked table says 2-8 and 3-7. Both HAY vs MOD games were checked and Hayward won both, so no head to head flip explains it.

- 6/15/2025, MOD vs HAY. Log has MOD 37, HAY 38. Correct is MOD 27, HAY 36. Both totals are wrong but Hayward still wins, so this changes stats and not the record.
- 6/29/2025, HAY 48, MOD 26. Log matches. No correction needed.

Exactly one two-game combination reconciles 2025: 7/20 PLE 46 HAY 47 becoming a Pleasanton win, plus 7/27 PLE 44 MOD 29 becoming a Modesto win. The first is a one-point game and plausible. The second is a 15-point margin and is not a scorekeeping slip, so this is probably the wrong explanation.

A Hayward forfeit to Modesto in 2025 would move one win exactly as needed with no box score being wrong. `team_forfeits` is empty for every season, so if that happened it was never entered. Check this before hunting for more score errors.

To fix any of it, the player-level box scores are needed. Team totals alone cannot say which player's line is wrong. Wanted: SJO 7/7/2024, SAC 8/4/2024, and both MOD and HAY for 6/15/2025. Use the `/boxscore` skill, which takes a pasted team line and emits the UPDATE SQL.

Nothing user-facing is wrong at the team level, since displayed records read from the baked `TEAM_SEASONS`. The damage is confined to player stats in those games and, through them, slightly wrong 2024 and 2025 AI Scores. Too small to move an award.

Related, found 2026-08-10 while building the Championship Games card: the 2010 final box score adds up to San Ramon 44, San Jose 36, but the official final score was 42-39. Andrew confirmed the official score from memory. Same class of error as the 2024 and 2025 games above, and it needs the same fix, the player level box score. For now `CHAMPIONSHIP_META[2010].score` overrides the number in the card header and the card says plainly that the box score below it disagrees. That override is display only and must never be used on a game where the correction would flip the winner.

### Found 2026-08-11 by the Elo run: the full scale of the game_log to TEAM_SEASONS gap

`node scripts/elo.mjs` now reconciles every derived season record against the baked `TEAM_SEASONS` and prints the disagreements. 92 of 118 season records reproduce exactly. The other 26 fall into two piles.

**13 games are missing from game_log entirely.** Neither side has a box score, so nothing derives them and Elo skips them. By year: 2005 (1), 2009 (3), 2010 (2), 2012 (1), 2016 (4), 2019 (1), 2021 (1). Separately, 13 team-games have one side logged and not the other, 7 of them in 2005 under a team code of SAC, which did not exist in 2005 and is probably a mislabel of one of the four teams that did.

**Three seasons have the right number of games with a result recorded backwards.** These are the same class as the 2024 pair above and each one needs a player level box score to fix.

- 2011, SAC is 4-7 in the log against 5-6 baked and CON is 2-8 against 1-9. The only CON win over SAC in the log is 6/18/2011, CON 46-45. A one point game, so this is the likely flip and the likeliest kind of scorekeeping slip.
- 2022, HAY is 4-6 against 3-7 baked and CON is 2-9 against 3-8. HAY beat CON twice in the log, 6/26 by 20 and 7/31 by 14. Neither margin looks like a slip, so this one probably is not a wrong score. A HAY forfeit to CON would move the win with no box score being wrong, same shape as the 2025 theory.
- 2025, the HAY and MOD swap already documented above.

Everything user facing still reads records from `TEAM_SEASONS`, so none of this is visible outside player stats and the Elo card, which says plainly that it inherits the gaps.

## Built 2026-08-11: Elo ratings

Live at `/stats/elo`, a tile in the Awards and History group. Engine in `src/elo.js`, shared by the card and by `scripts/elo.mjs` so the site and the terminal cannot drift.

Settings, all picked by grid search over the 617 rateable games (`node scripts/elo.mjs --tune`): start 1500, K 28, margin of victory on, offseason carryover 0.85. Log loss 0.5455 and 72.4% of games called right in hindsight, against 0.6931 for a coin flip. Margin of victory is worth having, 0.5455 with against 0.5643 without. Normalizing margins by era scoring was tested and made it worse, so the switch is in `buildElo` as `normalizeMargin` and left off. The K and carryover surface is flat from 24 to 32 and 0.80 to 0.95, so nothing hangs on the exact numbers.

Franchise lines follow `FRANCHISE_MAP`: San Ramon feeds Pleasanton, Norcal feeds Concord. Andrew chose to run the combined 2018 MCS team on the Modesto line. The two confirmed 2024 corrections are applied as `ELO_SCORE_FIXES` at the team total level, for Elo only, since without them Elo hands two wins to the wrong teams.

Peak ratings land where the history says they should: SAC 1894 in 2022 at 12-0, HAY 1867 in 2008 at the end of the 42 game win streak, PLE 1763 on the 2026 title.

The card carries, in order: the game by game chart, current standings, high and low per franchise, all 21 champions ranked by the rating they won with, all 21 finals ranked as matchups by combined rating at tipoff, the best 20 semifinals the same way, the 20 strongest games ever played, the biggest 12 climbs inside one season, the 20 strongest teams to lose a final on the rating they took into it, the best 12 seasons that missed the playoffs, and the 20 biggest upsets. `scripts/elo.mjs` prints those tables plus the ones the card no longer shows, so all of them can still be checked outside React.

Every one of the 20 strongest games ever played involves Sacramento, and 5 of them are finals, which is what a 20 season peak does to a list ranked on combined rating. Debut games do not contaminate the list either way: there are only 8 in league history and a debut sits at 3000 combined, which is mid-range.

In-season movement measures the first game of a season to the last, so the offseason carryover is out of it. Four seasons open on the 1500 placeholder because there was nothing to carry (2005 HAY, 2005 CON, 2008 MOD, 2014 CIS). They stay in the list with the start rating shown in the row, so the placeholder is visible rather than hidden. Biggest climb ever is 2026 PLE at +213 on the title season. (Biggest fall is 2022 PLE at -253 going 1-9, still printed by the script, no longer on the card.)

Fixed 2026-08-11, same day: `eloGames` built team-games without copying `game_type` onto them, so the `type` field it returned was always undefined and games inside one date sorted alphabetically by team code. Semifinals and the final share a date, so in 17 of 21 seasons a semifinal was rated after the final, and a beaten finalist could bank a win after the loss that ended its year. `TYPE_RANK` now orders R before P before C inside a date and all 21 seasons end on the final. Ratings moved a few points, 2006 HAY and 2017 SAC traded 8th and 9th among champions, and 2026 SAC came off an inflated 1772 to 1770. Hindsight went 72.4% to 72.6% accuracy and log loss 0.5455 to 0.5459, both noise.

The upsets panel sorts on the winner's win probability at tipoff, not on rating shift. Shift is margin weighted, so sorting on it ranked a blowout by a mild underdog above a one point shock. Shift is the tiebreak. Top of the list is 2009 6/21, SAC 57-44 over HAY at a 7% chance.

`eloFinals` in `src/elo.js` is what the finals tables read. It takes the winner off the box score rather than the baked `TEAM_SEASONS`, which is safe because the two known box score problems in finals, 2010 and 2024, miss on the score without touching who won.

Six champions were underdogs at tipoff by rating alone: 2010 PLE at 25%, 2016 PLE and 2019 SJO at 33%, 2026 PLE at 39%, 2011 SJO at 41%, 2012 HAY at 45%.

### Revised 2026-08-12 on Andrew's pass over the live card

Removed: the season window (year picker, slide arrows, span logic), the weakest 20 games, the biggest falls, and "Best teams that did not win it." The two chip toggles went with them, so those cards are single lists now.

The chart lines are lightly smoothed. This was not cosmetic polish, it was necessary: across the full 21 seasons a team's own games land about 1.3px apart at 340px wide, while one result can move the line 6px vertically, so the raw plot was a near-vertical sawtooth. Catmull-Rom corner rounding does nothing at that aspect ratio, so the values themselves get one pass of a weighted 3 point average at 1/8 on each side. That drops average jaggedness from 6.24px to 4.78px and shifts a plotted point an average of 4.1 rating points (worst 18.8), inside a single game's move. Endpoints are left exact. `NEIGHBOR` in `EloView` is the knob; the measurement script is disposable, rerun it before changing the value. The caption says the lines are smoothed and every number on the page is exact, which is true: only the SVG path is affected.

X axis labels moved to every odd calendar year, 11 of them, rather than every Nth season. Season parity would put labels on even years from 2021 on, since 2020 was cancelled. Tightest label gap is 15.4px against roughly 12px needed, so they clear at phone width.

"Runners-up" is now "Strongest teams to not win the final." Andrew's call: anything keyed to champions or beaten finalists shows all 21, one per season, never a top 20. That also settles the 2006 PLE against 2008 CON cut, where both rounded to 1442 and a fraction of a rating point decided which one fell off.

New card, "Each year's champions and runners-up," sitting between the champions list and Best championship matchups. All 118 team-seasons as one dot each, season-end rating against year. Champions filled, beaten finalists as open rings, everyone else small at 0.3 opacity. Hovering or tapping a dot reads out the year, team, record, result, and rating; transparent 6px hit circles sit over the 2px dots, sorted so a champion or finalist wins a tap in a crowded column. Tapping a franchise chip switches the emphasis to that franchise's whole history instead. Verified: 118 dots, 21 Champ, 21 Finals, 42 Semis, 34 Missed, nothing unmatched against TEAM_SEASONS, and exactly one champion and one finalist in every year.

PLE's chart color went from `#a16207` to `#b8860b` on Andrew's note that it read as vegas gold. That is hue 35 to hue 43, eight degrees toward yellow, at 3.25:1 against white. It cannot go much further: 3:1 is the floor for a stroke this thin and the brand yellow `#eab308` is 1.92:1, which vanishes at 1px. Nearest other chart color is SJK at RGB distance 103, so the two stay separable where they overlap in 2016.

The rings are open (`fill="none"`) and drawn after the filled dots on purpose. Seven seasons put the champion and the team it beat within 4px of each other at render size, 2026 SAC and PLE within 1.4px, so a white-filled ring would erase the champion underneath. Open rings let the near ties read as near ties. Do not "fix" this by filling them.

Copy rewritten to name Elo rather than say "it": the intro now explains what Elo is, who Arpad Elo was, and what happens on a win, a loss, and an offseason, in that order. The method card is "How Elo is calculated."

Still not done: the card has never been looked at in a browser. The Chrome extension was not connected on either pass, so the layout, and the smoothed chart in particular, is unverified by eye.

## In flight: Championship Games card

Paused 2026-08-10, deployed and live at `/stats/championships`. Built, ranked, and readable, but the writeups are a third done and Andrew is not happy with the layout yet.

Where things live. `CHAMPIONSHIP_META` in App.jsx holds one entry per year, keyed by year. Teams, scores, winner and date are never stored there: they derive from GAME_LOG on game_type "C", so they cannot drift from the box scores. The constant holds only judgment and outside facts, which is rank, headline, championship MVP, location, context line, and the writeup. `CHAMPIONSHIP_EXPLAINER` is the intro copy including the ranking criteria. `ChampionshipsView` renders it.

Done:

- All 21 finals derive correctly. A verification harness lives in the session scratchpad and checks that ranks are unique 1 to 21 and that every MVP resolves to a real box score row.
- Andrew's ranking, set by hand over three passes. 2026 first, then 2025, 2010, 2017, 2013, 2011.
- Headlines on all 21, drafted from data and his notes. He has not reviewed them.
- Championship MVP picked for all 21 by highest Game Score on the winning team. These are guesses. Andrew corrects them as we go, and he has confirmed none of them yet.
- Writeups for 2005 through 2011, in his voice, from his notes.
- Optional photo and video per game, both wired and both unused so far. Use `uploadPhoto()` for a URL.
- Sorts by rank, last played, first played.

Left to do:

- Writeups for 2012 through 2026, fourteen of them. The established loop: go oldest first, show him the score, records, date, location, context, the MVP pick and the top box score lines, take his notes, write it in his voice, verify every checkable claim against game_log before it goes in. That verification has already caught several things, including a headline claiming Hayward's era ended in 2011 when they won two more titles after it.
- Layout. Two passes done. The second removed all caps, cut the type scale from five sizes to three, and dropped the full width score banner. He still calls it messy. Nobody has seen it rendered: the Chrome extension is not connected, so everything so far has been verified through Node and by grepping the deployed bundle. A screenshot from him is the fastest way forward.

Open questions, none blocking:

- Should the cards collapse to rank, headline and score, expanding on tap? Probably the real fix for a 21 item ranked list, but it hides the writing behind a tap.
- The 14 unwritten games say "No writeup yet", which makes most of the page look unfinished. Hide them, or leave them.
- Venue strings are long and wrap on a phone. City only?
- The card is `adminOnly`, which hides the tile but not the route. `/stats/championships` is reachable by anyone who types it. Fine for now, and it needs a real gate if that changes.

## Backlog: app features

1. Add an "Explaining AI Score and Game Score" card at the top of analytics. AI Score is a season metric, Game Score is per game. Awards component covers the 2005 to 2023 pre voting era. Top 10 AI Score equals First plus Second Team. First Team is the top 5 via formula, then pick MVP from those 5.
2. Game dropdowns: top 3 by Game Score per team, main stats, box score link.
3. Rewrite Awards section: explainer plus per season table, top 10 by AI Score from 2005.
4. (Later) MVP and All-PCAL chips on season rows everywhere (for example Shehata 2005 MVP chip on the APG leaderboard).

First Team order: (1) highest total Game Score, (2) highest avg Game Score min 7G, (3) highest AI Score on the best regular season team, (4) next AI Score to fill the 5th.

MVP criteria 2005 to 2023: team 50% plus wins or made playoffs, no prior MVP given preference, judgment on highest avg Game Score min 7G, highest total Game Score, outstanding impact if close.

## Backlog: name alias cleanup

28 player seasons with 5 or more games have name mismatches between DATA and GAME_LOG, so they get 0 share bonus. Fix via PLAYER_MERGE. Andrew verifies before any merge is applied.

Likely merges:
- MASDARY JOSHUA = JOSH
- OKI CHRISTOPHER = CHRIS
- BOTROS JOHN = JOHNNY
- MOUSSA ANTHONY = TONY
- MALEK CHRIS = CHRISTOPHER
- GUIRGUIS KIROLOUS = KIRO
- ROUHANI DAVE = DAVID
- ELIA STEVE = STEPHEN
- MALEK JOHNNY = JOHN

To verify:
- SAWIRIS RAFY = RAFAEL
- HANNA JOE = JOSEPH

Double space bugs to fix: ABDELSHAID, GUIRGUIS.

## Backlog: 2026 operations

- Scheduling chart for June 7 (Livermore) and June 14 (Modesto) is built with game assignments, scoring duties, and headshot times.
- Social media plan finalized as a Word document.
- Drag and drop team assignment in the registrations admin view (pcal-database.jsx) was mentioned but not yet built.
