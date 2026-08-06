-- PCAL 2026 awards ballot.
--
-- Run AFTER surveys_schema.sql, and AFTER the voter roll script (which is
-- kept out of this repo because it carries 30 email addresses).
--
-- Re-running replaces the questions and options in place. It does NOT touch
-- responses or the voter roll, so it is safe to run again to fix a typo
-- mid-vote. Deleting a question would delete its answers, so do not remove
-- one once voting has opened.
--
-- Option position encodes ballot order, and it is the only place that
-- encodes it: positions under 100 are the priority names that team reps
-- put forward first, 100 and above are everyone else. The client shuffles
-- within each band and shows the low band first, so no name list has to be
-- duplicated in the app.

begin;

do $$
declare
  v_owner uuid;
  v_survey uuid;
  v_q uuid;
begin
  select id into v_owner from auth.users where lower(email) = 'andrewishak@gmail.com';
  if v_owner is null then
    raise exception 'No auth user for andrewishak@gmail.com. Log in to pcaleague.com once first.';
  end if;

  insert into surveys (
    slug, title, description, status, anonymous, randomize_questions,
    one_response_per_device, show_results, show_text_answers,
    rate_limit_per_hour, require_auth, restrict_to_voters,
    closes_at, created_by
  ) values (
    'awards-2026',
    '2026 PCAL Awards',
    'Ranked voting for the 2026 PCAL individual awards and favorite team.',
    'open',
    true,    -- ballots carry no identity, enforced by trigger
    false,   -- question order is fixed; the client shuffles options itself
    false,   -- irrelevant here: restrict_to_voters keys the guard to the account
    'never', -- nobody sees tallies during voting. The owner always can.
    false,
    60,
    true,
    true,
    timestamptz '2026-08-08 12:00:00 America/Los_Angeles',
    v_owner
  )
  on conflict (slug) do update set
    title = excluded.title, description = excluded.description,
    status = excluded.status, anonymous = excluded.anonymous,
    show_results = excluded.show_results, require_auth = excluded.require_auth,
    restrict_to_voters = excluded.restrict_to_voters,
    closes_at = excluded.closes_at, updated_at = now()
  returning id into v_survey;


  -- Q1
  select id into v_q from survey_questions
   where survey_id = v_survey and position = 0;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections, rank_weights)
    values (v_survey, 0, 'ranked', 'Most VALUABLE Player (MVP)', 'Please choose 3 players, in order (1st is best), who you believe to be this year''s most valuable players. You must choose 3 and only 3.',
      true, false, 3, 3, '{5,3,1}')
    returning id into v_q;
  else
    update survey_questions set
      type = 'ranked', prompt = 'Most VALUABLE Player (MVP)', help_text = 'Please choose 3 players, in order (1st is best), who you believe to be this year''s most valuable players. You must choose 3 and only 3.',
      required = true, randomize_options = false,
      min_selections = 3, max_selections = 3, rank_weights = '{5,3,1}'
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 0, 'Mark Shacker (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 1, 'Andrew Ishak (PDF)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 2, 'Yousef Mikhail (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 3, 'Andrew Badroos (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Marios Tawdros (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 101, 'Andre Muqhar (MOD)')
    on conflict do nothing;
  update survey_options o set position = v.pos
    from (values ('Mark Shacker (SJO)', 0), ('Andrew Ishak (PDF)', 1), ('Yousef Mikhail (PLE)', 2), ('Andrew Badroos (SAC)', 3), ('Marios Tawdros (PLE)', 100), ('Andre Muqhar (MOD)', 101)) as v(label, pos)
   where o.question_id = v_q and o.label = v.label;
  delete from survey_options where question_id = v_q and label not in ('Mark Shacker (SJO)', 'Andrew Ishak (PDF)', 'Yousef Mikhail (PLE)', 'Andrew Badroos (SAC)', 'Marios Tawdros (PLE)', 'Andre Muqhar (MOD)');

  -- Q2
  select id into v_q from survey_questions
   where survey_id = v_survey and position = 1;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections, rank_weights)
    values (v_survey, 1, 'ranked', 'Most IMPROVED Player (MIP)', 'Please choose 3 players, in order (1st is best), who you believe to be this year''s most improved players. You must choose 3 and only 3.',
      true, false, 3, 3, '{5,3,1}')
    returning id into v_q;
  else
    update survey_questions set
      type = 'ranked', prompt = 'Most IMPROVED Player (MIP)', help_text = 'Please choose 3 players, in order (1st is best), who you believe to be this year''s most improved players. You must choose 3 and only 3.',
      required = true, randomize_options = false,
      min_selections = 3, max_selections = 3, rank_weights = '{5,3,1}'
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 0, 'John Ramzy (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Kero Abdalla (HAY)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 101, 'Andrew Sharkawy (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 102, 'Lamek Hagos (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 103, 'Bishoy Abdelshaid (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 104, 'Fady Mikhail (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 105, 'Mark Awad (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 106, 'Joe Hanna (PDF)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 107, 'John Ameen (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 108, 'Mark Abdalla (HAY)')
    on conflict do nothing;
  update survey_options o set position = v.pos
    from (values ('John Ramzy (MOD)', 0), ('Kero Abdalla (HAY)', 100), ('Andrew Sharkawy (MOD)', 101), ('Lamek Hagos (SJO)', 102), ('Bishoy Abdelshaid (SAC)', 103), ('Fady Mikhail (PLE)', 104), ('Mark Awad (SAC)', 105), ('Joe Hanna (PDF)', 106), ('John Ameen (MOD)', 107), ('Mark Abdalla (HAY)', 108)) as v(label, pos)
   where o.question_id = v_q and o.label = v.label;
  delete from survey_options where question_id = v_q and label not in ('John Ramzy (MOD)', 'Kero Abdalla (HAY)', 'Andrew Sharkawy (MOD)', 'Lamek Hagos (SJO)', 'Bishoy Abdelshaid (SAC)', 'Fady Mikhail (PLE)', 'Mark Awad (SAC)', 'Joe Hanna (PDF)', 'John Ameen (MOD)', 'Mark Abdalla (HAY)');

  -- Q3
  select id into v_q from survey_questions
   where survey_id = v_survey and position = 2;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections, rank_weights)
    values (v_survey, 2, 'ranked', 'DEFENSIVE Player of the Year (DPOY)', 'Please choose 3 players, in order (1st is best), who you believe to be this year''s best defensive players. You must choose 3 and only 3.',
      true, false, 3, 3, '{5,3,1}')
    returning id into v_q;
  else
    update survey_questions set
      type = 'ranked', prompt = 'DEFENSIVE Player of the Year (DPOY)', help_text = 'Please choose 3 players, in order (1st is best), who you believe to be this year''s best defensive players. You must choose 3 and only 3.',
      required = true, randomize_options = false,
      min_selections = 3, max_selections = 3, rank_weights = '{5,3,1}'
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 0, 'Andre Muqhar (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Mark Abdalla (HAY)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 101, 'Matthew Gebraeil (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 102, 'Elijah Yosef (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 103, 'Mark Awad (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 104, 'Fady Mikhail (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 105, 'Bishoy Awad (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 106, 'Anthony Kelada (PDF)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 107, 'Marios Tawdros (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 108, 'Alex Hanna (PLE)')
    on conflict do nothing;
  update survey_options o set position = v.pos
    from (values ('Andre Muqhar (MOD)', 0), ('Mark Abdalla (HAY)', 100), ('Matthew Gebraeil (SJO)', 101), ('Elijah Yosef (SAC)', 102), ('Mark Awad (SAC)', 103), ('Fady Mikhail (PLE)', 104), ('Bishoy Awad (SAC)', 105), ('Anthony Kelada (PDF)', 106), ('Marios Tawdros (PLE)', 107), ('Alex Hanna (PLE)', 108)) as v(label, pos)
   where o.question_id = v_q and o.label = v.label;
  delete from survey_options where question_id = v_q and label not in ('Andre Muqhar (MOD)', 'Mark Abdalla (HAY)', 'Matthew Gebraeil (SJO)', 'Elijah Yosef (SAC)', 'Mark Awad (SAC)', 'Fady Mikhail (PLE)', 'Bishoy Awad (SAC)', 'Anthony Kelada (PDF)', 'Marios Tawdros (PLE)', 'Alex Hanna (PLE)');

  -- Q4
  select id into v_q from survey_questions
   where survey_id = v_survey and position = 3;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections, rank_weights)
    values (v_survey, 3, 'ranked', 'RISING STAR (RS)', 'Please choose 3 players, in order (1st is best), who you believe to be this year''s rising stars. Rising Star is limited to players 21 and younger in their 3rd year or earlier. You must choose 3 and only 3.',
      true, false, 3, 3, '{5,3,1}')
    returning id into v_q;
  else
    update survey_questions set
      type = 'ranked', prompt = 'RISING STAR (RS)', help_text = 'Please choose 3 players, in order (1st is best), who you believe to be this year''s rising stars. Rising Star is limited to players 21 and younger in their 3rd year or earlier. You must choose 3 and only 3.',
      required = true, randomize_options = false,
      min_selections = 3, max_selections = 3, rank_weights = '{5,3,1}'
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 0, 'Lamek Hagos (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 1, 'Kyrillous Ibrahim (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 2, 'Yousef Mikhail (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Alex Hanna (PLE)')
    on conflict do nothing;
  update survey_options o set position = v.pos
    from (values ('Lamek Hagos (SJO)', 0), ('Kyrillous Ibrahim (SAC)', 1), ('Yousef Mikhail (PLE)', 2), ('Alex Hanna (PLE)', 100)) as v(label, pos)
   where o.question_id = v_q and o.label = v.label;
  delete from survey_options where question_id = v_q and label not in ('Lamek Hagos (SJO)', 'Kyrillous Ibrahim (SAC)', 'Yousef Mikhail (PLE)', 'Alex Hanna (PLE)');

  -- Q5
  select id into v_q from survey_questions
   where survey_id = v_survey and position = 4;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections, rank_weights)
    values (v_survey, 4, 'ranked', 'BEST TEAMMATE', 'Please choose 3 players, in order (1st is best), who you believe to be this year''s best teammates. You must choose 3 and only 3.',
      true, false, 3, 3, '{5,3,1}')
    returning id into v_q;
  else
    update survey_questions set
      type = 'ranked', prompt = 'BEST TEAMMATE', help_text = 'Please choose 3 players, in order (1st is best), who you believe to be this year''s best teammates. You must choose 3 and only 3.',
      required = true, randomize_options = false,
      min_selections = 3, max_selections = 3, rank_weights = '{5,3,1}'
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 0, 'Ethan William (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 1, 'Simon Abdelmalak (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 2, 'Joe Hanna (PDF)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 3, 'Paul Ramsey (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Adam Abdelmalek (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 101, 'Kero Agaiby (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 102, 'Mark Henry (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 103, 'Andre Hanna (PLE)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 104, 'Youssef Daoud (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 105, 'Mark Amin (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 106, 'George Hermina (HAY)')
    on conflict do nothing;
  update survey_options o set position = v.pos
    from (values ('Ethan William (SJO)', 0), ('Simon Abdelmalak (SJO)', 1), ('Joe Hanna (PDF)', 2), ('Paul Ramsey (SAC)', 3), ('Adam Abdelmalek (MOD)', 100), ('Kero Agaiby (SAC)', 101), ('Mark Henry (PLE)', 102), ('Andre Hanna (PLE)', 103), ('Youssef Daoud (SJO)', 104), ('Mark Amin (MOD)', 105), ('George Hermina (HAY)', 106)) as v(label, pos)
   where o.question_id = v_q and o.label = v.label;
  delete from survey_options where question_id = v_q and label not in ('Ethan William (SJO)', 'Simon Abdelmalak (SJO)', 'Joe Hanna (PDF)', 'Paul Ramsey (SAC)', 'Adam Abdelmalek (MOD)', 'Kero Agaiby (SAC)', 'Mark Henry (PLE)', 'Andre Hanna (PLE)', 'Youssef Daoud (SJO)', 'Mark Amin (MOD)', 'George Hermina (HAY)');

  -- Q6, single pick. "Besides your own" is filtered by the client using the
  -- voter's own team; it is not enforced here, because the feature has no way
  -- to hide one option from one respondent.
  select id into v_q from survey_questions where survey_id = v_survey and position = 5;
  if v_q is null then
    insert into survey_questions (survey_id, position, type, prompt, help_text,
      required, randomize_options, min_selections, max_selections)
    values (v_survey, 5, 'single', 'FAVORITE TEAM',
      'Please choose a team, besides your own, who you consider to be your favorite team this season.',
      true, false, null, null)
    returning id into v_q;
  else
    update survey_questions set
      type = 'single', prompt = 'FAVORITE TEAM',
      help_text = 'Please choose a team, besides your own, who you consider to be your favorite team this season.',
      required = true, randomize_options = false
    where id = v_q;
  end if;
  insert into survey_options (question_id, position, label) values (v_q, 100, 'Sacramento (SAC)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 101, 'Port of Deliverance (PDF)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 102, 'Modesto (MOD)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 103, 'San Jose (SJO)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 104, 'Hayward (HAY)')
    on conflict do nothing;
  insert into survey_options (question_id, position, label) values (v_q, 105, 'Pleasanton (PLE)')
    on conflict do nothing;
  delete from survey_options where question_id = v_q and label not in ('Sacramento (SAC)', 'Port of Deliverance (PDF)', 'Modesto (MOD)', 'San Jose (SJO)', 'Hayward (HAY)', 'Pleasanton (PLE)');

end $$;

commit;

-- Check:
--   select prompt, type, min_selections, max_selections, rank_weights
--     from survey_questions q join surveys s on s.id = q.survey_id
--    where s.slug = 'awards-2026' order by position;
--   select count(*) from survey_options o
--     join survey_questions q on q.id = o.question_id
--     join surveys s on s.id = q.survey_id where s.slug = 'awards-2026';
--   -- expect 6 questions and 47 options (6+10+10+4+11 players, 6 teams)