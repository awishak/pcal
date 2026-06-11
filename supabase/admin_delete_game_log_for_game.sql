-- Corrected reverse-approval delete for game_log.
--
-- Bug this fixes: the previous version matched rows by year + week + date +
-- team in (home, away), ignoring the opponent. On a doubleheader day every
-- team plays two games on the same date, so reversing one game deleted that
-- team's rows from its OTHER same-day game too. This silently wiped
-- PDF@game101 and PLE@game105 when game 103 (PDF vs PLE) was reverse-approved
-- on 2026-06-07. live_events stayed intact, but game_log lost 16 rows.
--
-- The fix scopes the delete to the specific matchup:
--   (team = home AND opp = away) OR (team = away AND opp = home)
-- which uniquely identifies one game's rows even with doubleheaders.
--
-- Gated server-side by has_admin_or_commish(), matching the other admin RPCs.
-- Returns { ok, deleted } so the client (adminDeleteGameLogForGame in
-- src/supabase.js) can report the row count.
--
-- Run once in the Supabase SQL editor.

create or replace function public.admin_delete_game_log_for_game(
  p_year  int,
  p_week  int,
  p_date  text,
  p_home  text,
  p_away  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if not has_admin_or_commish() then
    raise exception 'not authorized';
  end if;

  delete from public.game_log
   where year = p_year
     and week = p_week
     and date = p_date
     and (
       (team = p_home and opp = p_away)
       or (team = p_away and opp = p_home)
     );

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

grant execute on function public.admin_delete_game_log_for_game(int, int, text, text, text) to authenticated;
