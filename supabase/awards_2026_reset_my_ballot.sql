-- Clear ONE person's 2026 awards ballot so they can vote again.
--
-- Set the email on the line marked below. It defaults to the commissioner.
--
-- WHY THIS IS POSSIBLE AT ALL, given ballots are anonymous:
-- survey_responses.user_id is null on this survey, enforced by a trigger, so
-- there is no identity stored on a ballot. What identifies a row is
-- respondent_key, which for an auth-gated survey is
-- survey_account_key(survey_id, user_id) = md5('survey-account:'||survey||':'||uid).
-- That is deterministic, so a superuser who already knows exactly whose
-- account they are looking for can recompute one person's key and find their
-- row. It does not let anyone read a ballot, and it does not let anyone work
-- backwards from a row to a person: you have to name the account first.
--
-- WHAT IT DOES
--   1. Deletes that account's response. survey_answers cascades with it.
--   2. Clears their voted_at, so the turnout page reads correctly again.
-- Everyone else's ballot is untouched. The script refuses to run if it would
-- match more than one response, which it never should.
--
-- WARNING: this destroys a real ballot. Their picks are gone, not archived.
-- Run it to preview the ballot before voting is serious, not after someone
-- has cast the vote they meant to keep.

begin;

do $$
declare
  v_email   text := 'andrewishak@gmail.com';   -- <<< the voter to reset
  v_survey  uuid;
  v_uid     uuid;
  v_key     text;
  v_deleted int;
begin
  select id into v_survey from surveys where slug = 'awards-2026';
  if v_survey is null then
    raise exception 'No survey with slug awards-2026.';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(btrim(v_email));
  if v_uid is null then
    raise exception 'No auth user for %. They have never logged in.', v_email;
  end if;

  v_key := survey_account_key(v_survey, v_uid);

  select count(*) into v_deleted
  from survey_responses
  where survey_id = v_survey and respondent_key = v_key;

  if v_deleted > 1 then
    raise exception 'Refusing to run: % responses match one account key.', v_deleted;
  end if;

  delete from survey_responses
   where survey_id = v_survey and respondent_key = v_key;

  update survey_voters
     set voted_at = null
   where survey_id = v_survey
     and lower(btrim(email)) = lower(btrim(v_email));

  raise notice 'Cleared % ballot(s) for %. They can vote again.', v_deleted, v_email;
end $$;

commit;

-- Check: their name should read "Not yet" again, and the total should drop.
--   select survey_turnout('awards-2026');
--   select count(*) from survey_responses r join surveys s on s.id = r.survey_id
--    where s.slug = 'awards-2026';
