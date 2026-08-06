-- Fix: PDF is Pacific. The ballot shipped with "Port of Deliverance (PDF)",
-- which is not a name this league has ever used. TEAM_NAMES in App.jsx has
-- PDF: "Pacific", and the franchise name is "Pacific Desert Fathers".
--
-- This updates the label in place so the option keeps its id. Re-running
-- awards_2026_ballot.sql would also fix it, but that path deletes an option
-- whose label changed and inserts a new one, which would discard any votes
-- already cast for it. This does not.
--
-- Safe to run whether or not anyone has voted.

begin;

update survey_options o
   set label = 'Pacific (PDF)'
  from survey_questions q
  join surveys s on s.id = q.survey_id
 where o.question_id = q.id
   and s.slug = 'awards-2026'
   and o.label = 'Port of Deliverance (PDF)';

commit;

-- Check: expect Sacramento, Pacific, Modesto, San Jose, Hayward, Pleasanton.
--   select o.label from survey_options o
--     join survey_questions q on q.id = o.question_id
--     join surveys s on s.id = q.survey_id
--    where s.slug = 'awards-2026' and q.type = 'single'
--    order by o.position;
