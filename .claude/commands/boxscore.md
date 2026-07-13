---
description: Correct one team's stats for one game in game_log from a pasted box score
---

The user is pasting a tab-separated box score for ONE team in ONE game, to correct
that team's rows in `game_log`.

Their paste is below. It may or may not include the `GAME:` and `TEAM:` header lines.

<paste>
$ARGUMENTS
</paste>

Do this:

1. If the `GAME:` and `TEAM:` lines are missing or ambiguous, ask for them. Do not guess
   the date or the teams. Format is `GAME: 6/28 SAC vs PDF` then `TEAM: SAC`.

2. Write the paste verbatim to a file in your scratchpad directory. Preserve the tabs
   exactly. Do not reformat, re-align, or "clean up" the columns.

3. Run `node scripts/boxscore.mjs <that file>`.

4. Show the user the diff, the team totals, and the flags. Then give them the SQL to
   paste into the Supabase SQL editor.

Rules the script enforces, which you must not work around:

- Fouls are never written. The existing DB value is preserved and used to recompute gmsc.
- pts, fgm, fga, tpm, tpa are derived from 2P/2PA/3P/3PA/FT, never taken from the paste.
- Nothing is inserted or deleted. Unmatched players and missing players are flagged only.
- If a player has impossible stats (makes > attempts), no SQL is emitted. Report it and stop.

Do not do the arithmetic yourself and do not hand-write the SQL. The script is the source
of truth for every number. If the script errors, fix the input or the script, then rerun it.
