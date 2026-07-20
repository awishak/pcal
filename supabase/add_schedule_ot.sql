-- Overtime flag on scheduled games.
--
-- Nothing recorded overtime for 2026: game_log has no OT column and the
-- schedule table had no flag. The 2025 season shows "FINAL/OT" only because
-- that schedule is a baked array in App.jsx with the values typed in by hand.
--
-- Additive. No existing column or row is altered beyond the two games below.

alter table schedule add column if not exists ot boolean not null default false;

-- game_id 116: July 12 2026, 3:00 PM, PDF vs PLE. Final 45-48.
-- game_id 109: June 14 2026, 6:00 PM, HAY vs SAC. Final 38-43.
update schedule set ot = true where game_id in (116, 109);

-- Verify: expect exactly the two rows above.
select game_id, game_date, game_time, home_team, away_team, ot
from schedule
where season = 2026 and ot = true
order by game_date;
