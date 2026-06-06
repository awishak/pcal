# Status

Volatile working state. Update this as work moves. Durable rules live in `CLAUDE.md`.

## Phase 3 (active, not deployed)

Deriving season DATA entirely from GAME_LOG in browser so game_log is the single source of truth and DATA vs log drift goes away. A `buildSeasonData` derive function is written and validated in Node. Remaining work is App.jsx surgery: fill the AGE_MAP and complete the migration.

Locked decisions:

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
- Hanna George career rebounds: 711 in game_log vs 716 in baked DATA. 2005 value drift, not a migration defect.
- Nashed George: 714 in game_log vs 707 in baked DATA. game_log correctly includes his 2011 playoff and championship games that DATA omitted.
- Full diff report at `phase3_diff_report.md`.

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
