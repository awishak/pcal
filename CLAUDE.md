# PCAL (pcaLeague.com)

Basketball stats web app for the Northern California Coptic church league (PCAL). 20 seasons, 2005 to 2025, no 2020. Six teams: SAC, PDF, MOD, SJO, HAY, PLE. The 2026 season runs six Sundays (June 7, 14, 28, July 12, 26, August 2) with playoffs August 9.

Andrew Ishak is commissioner and developer. He is also a tracked player in the app.

For current migration state, in-flight work, and backlog, read `docs/STATUS.md`.

## Working rules

- No em dashes anywhere. Use commas, periods, or restructure.
- No emojis anywhere.
- Present the plan before writing code. Wait for approval before building or executing.
- Ask before assuming. If something is ambiguous, ask first as a numbered list, not widgets.
- Write in Andrew's voice. Do not polish, elevate, or formalize unless asked. No clipped punchy AI voice, no framing devices like "picture this." Prose should flow.
- No emotional management. No reassurance, cheerleading, validation, or softening. Direct and functional.
- Verify factual claims against data before writing any copy or blurb.

## Copy rules specific to PCAL

- Always include "according to PCAL AI Score" with any MVP or All-PCAL mention.
- Andrew is a tracked player. No GOAT claims and no unverified superlatives about his stats.
- AI Score is a season metric. Game Score is per game. Top 10 AI Score equals First Team plus Second Team. First Team is the top 5 via formula. MVP is picked from those 5.

## Tech stack and verify loop

- Vite + React, Supabase, Vercel.
- After every code change, run the project's esbuild compile to confirm it builds. The exact script is in package.json.
- Before delivering any file, grep for em dashes and remove them.
- Edits to large files use targeted string replacements with a sanity check, not full rewrites.

## File map

- `App.jsx` is the main app, roughly 16,000 lines.
- `LiveSection.jsx` is the live scoring section, roughly 4,000 lines.
- `supabase.js` is the data layer, roughly 800 lines.
- `pcal-database.jsx` is the registrations admin view.

Searching App.jsx by broad terms like "registration" is ineffective. Search for casual copy phrases like "welcome," "let's go," "here we go" to find message arrays.

## UI conventions

Mobile first, max-w-lg mx-auto, Outfit font, bg-white, pb-20. Bottom nav (stats, schedule, potw, Live), sticky top header. Cards are rounded-2xl border-gray-100. Active state bg-gray-900 text-white, inactive bg-gray-100 text-gray-600. Section labels are text-[10px] text-gray-400 uppercase tracking-widest. NAV_ITEMS uses SVG icon paths plus label. `section` state is the bottom nav, `tab` state is sub-pages. Prefer chips over dropdowns for stat category navigation. Prefer selectable tiles over text inputs for structured choices in forms.

## Data model

GAME_LOG row is an array. Index map:

```
[0] player    [1] team    [2] opp     [3] week    [4] date
[5] game_type [6] g       [7] pts     [8] reb     [9] stl
[10] ast      [11] blk    [12] fgm    [13] fga    [14] ftm
[15] fta      [16] tpm    [17] tpa    [18] foul   [19] gmsc
[20] year
```

- TS% = pts / (2 * (fga + 0.44 * fta))
- PPG computation must key on team, year, week, date, and opponent to avoid doubleheader collisions.
- PLAYER_PHOTOS[name] is module level. The photo index must be built case and whitespace insensitive to resolve key mismatches.
- Supabase range pagination needs `.order("id", {ascending:true})` as a tiebreaker to stay stable.

## Architecture

The app derives all season data from GAME_LOG in the browser via `buildSeasonData`, called by `rebuildDerived()` after the log loads in `installGameLog`. game_log is the single source of truth and the old baked RAW array is gone. Season DATA, AI Score, awards, and leaders all rebuild post-load, not at module load. Per-game stats roll up to season totals. Game Score is recomputed from the box score with the standard formula in `installGameLog` (overriding the stored gmsc column), counting R/P/C only with exhibition excluded. Names and teams are normalized in `installGameLog` (PLAYER_MERGE aliases, guest naming, 2018 MCS consolidation). Ages come from the baked AGE_MAP. Phase 2 (GAME_LOG loads from Supabase, 8,758 rows) and Phase 3 (derive season DATA from GAME_LOG) are both complete as of 2026-06-06. See `docs/STATUS.md`.

## Supabase and security

- Project: msvgstunqxjmmsmmumgg.supabase.co
- game_log has public read RLS.
- Admin writes gate on the `has_admin_or_commish()` RPC.
- Registrar role (Sharkawy, Tawdros) can list and update registrations but not delete.
- Admin UI must require both `adminUnlocked` AND `isRealAdmin` (checking actual user_roles). Stale localStorage tokens from the old master password flow caused a prior security incident. Do not reintroduce a token-only admin gate.

## People

- Andrew Ishak: commissioner, developer, tracked player.
- Simon Abdelmalak: SJO rep, 2024 and 2025 AI Score MVP.
- Moses Abdelshaid: SAC rep.
- Marios Tawdros: PLE rep, 2025 DPOY, registrar.
- Mark Abdalla: HAY rep.
- Daniel Elsakr: MOD rep.
- Andrew Sharkawy: media and social, registrar.

## Standings and tiebreakers

Top 4 make the playoffs. 1 seed vs 4 seed, 2 seed vs 3 seed, winners meet in the final. The 1 seed chooses whether its semifinal is played first or second (rule 1.32).

Tiebreaker ladder, in order. This is rule 1.34 in the app rules and is implemented in `sortStandings` / `resolveGroup2026` in App.jsx.

1. Win percentage
2. Fewer forfeits
3. Head to head, the combined record against the other teams in the tie
4. Fewer spiritual fouls
5. Strength of Wins
6. Bible trivia

- **Strength of Wins** is the sum of the current win totals of every team beaten, counted once per win. Sweeping an opponent counts that opponent twice. It reads current win totals, not the totals held on the day of the win, so it moves every week.
- **Restart rule**: when a step separates a single team out of a tie of three or more, that team is placed and the remaining teams start over at step 1, not at the next step.
- A forfeit is also a loss in the record, so it costs a team twice. That is deliberate. Forfeited games are recorded 1-0.
- Point differential is displayed nowhere in the ladder. It is not a tiebreaker.
- All tiebreakers are subject to change. Say so wherever they are shown.

Forfeits and spiritual fouls live in the `team_forfeits` and `team_spiritual_fouls` tables, public read, admin write via `has_admin_or_commish()`. They are not in game_log. Spiritual fouls are also captured during live scoring as `foul_subtype` on `live_events`, but the standings read the dedicated table, so a foul assessed outside a live-scored game must be entered there by hand.

Clinch and elimination badges enumerate every remaining outcome, capped at 4096 scenarios (12 remaining games). Above that no badge is shown. Tie possibility for the TB Over column uses win-window overlap instead, since enumeration is 2^30 in week 1.

## Schedule rules (for any scheduling work)

6 teams, 6 weeks, 5 games per week at 3, 4, 5, 6, 7pm. Games are 1 hour. Each team plays 2 games per week with 1 bye. Double round robin, 30 total games. Byes rotate in team order.

- No back to back games. Minimum 1 hour wait, a gap of 2 or more time slots.
- Weeks 1 and 2 must be all first meetings. All 15 unique matchups complete by week 4.
- No team plays 7pm more than 3 times. Balance time slots and waits. SAC gets more early exits.
- Location rules: SAC bye means San Jose, SJO plays 7pm. SJO bye means Sacramento, SAC plays 4pm and 7pm, PDF plays 3pm and 5pm. PDF plays the last game of the season.
- Home weeks: MOD is the PDF bye week, SAC is the SJO bye week, SJO is the SAC bye week. HAY and PLE have no designated home week.
- Scoring: each team scores 5 games, ideally between their two playing games. Max one week per team with both 3pm and 7pm engagements (playing or scoring), except SAC, SJO, MOD may use their home week for this.

## Social

Instagram instagram.com/pcaleague. Approved hashtags #PCAL2026 and #pcaleague. Team: Marios Tawdros, Andrew Sharkawy, Smyrna Agib, Youana Gendy, Nataly Hanna.
