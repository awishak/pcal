-- Recovery: re-insert PDF@game101 and PLE@game105 box scores that were
-- collaterally deleted when game 103 (PDF vs PLE) was reverse-approved.
-- The old reverse matched team+date+week without opponent, so it wiped
-- these two teams' OTHER same-day games. Rebuilt from live_events.
-- Run once in the Supabase SQL editor.

insert into public.game_log (player,team,opp,week,date,game_type,g,pts,reb,stl,ast,blk,fgm,fga,ftm,fta,tpm,tpa,foul,gmsc,year)
values
  ('NAKHLA Besada', 'PDF', 'MOD', 1, '6/7', 'R', 1, 7, 2, 1, 0, 0, 3, 10, 1, 4, 0, 3, 0, 4.4, 2026),
  ('ISHAK Andrew', 'PDF', 'MOD', 1, '6/7', 'R', 1, 6, 11, 2, 2, 0, 2, 13, 2, 3, 0, 6, 1, 6.6, 2026),
  ('NASHED George', 'PDF', 'MOD', 1, '6/7', 'R', 1, 2, 4, 0, 0, 1, 1, 5, 0, 1, 0, 0, 1, 1.6, 2026),
  ('SHARKAWY Mathew', 'PDF', 'MOD', 1, '6/7', 'R', 1, 0, 12, 0, 0, 0, 0, 5, 0, 2, 0, 5, 1, 2.9, 2026),
  ('HANNA Joe', 'PDF', 'MOD', 1, '6/7', 'R', 1, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2.0, 2026),
  ('SHEHATA George', 'PDF', 'MOD', 1, '6/7', 'R', 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -0.7, 2026),
  ('MIKHAIL Fady', 'PLE', 'SJO', 1, '6/7', 'R', 1, 11, 2, 1, 1, 0, 5, 10, 0, 0, 1, 2, 0, 8.7, 2026),
  ('TAWDROS Marios', 'PLE', 'SJO', 1, '6/7', 'R', 1, 10, 4, 0, 3, 2, 4, 11, 2, 2, 0, 3, 0, 9.4, 2026),
  ('NAGUIB Mitchell', 'PLE', 'SJO', 1, '6/7', 'R', 1, 7, 3, 3, 0, 0, 2, 7, 1, 1, 2, 6, 1, 7.0, 2026),
  ('HANNA Andre', 'PLE', 'SJO', 1, '6/7', 'R', 1, 4, 0, 2, 0, 0, 2, 7, 0, 0, 0, 1, 0, 1.9, 2026),
  ('GERGES Timothy', 'PLE', 'SJO', 1, '6/7', 'R', 1, 4, 3, 0, 2, 0, 2, 3, 0, 0, 0, 0, 1, 5.2, 2026),
  ('MANKABADY Youssef', 'PLE', 'SJO', 1, '6/7', 'R', 1, 4, 1, 0, 0, 0, 2, 6, 0, 0, 0, 3, 0, 1.1, 2026),
  ('NAGUIB Gabriel', 'PLE', 'SJO', 1, '6/7', 'R', 1, 2, 5, 1, 0, 0, 1, 4, 0, 0, 0, 2, 1, 2.7, 2026),
  ('HANNA Alex', 'PLE', 'SJO', 1, '6/7', 'R', 1, 0, 2, 0, 4, 0, 0, 4, 0, 0, 0, 0, 1, 0.6, 2026),
  ('GEBREMICAEL Eisayas', 'PLE', 'SJO', 1, '6/7', 'R', 1, 0, 3, 2, 0, 0, 0, 7, 0, 0, 0, 6, 0, -1.4, 2026),
  ('MIKHAIL Yousef', 'PLE', 'SJO', 1, '6/7', 'R', 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 2026);
