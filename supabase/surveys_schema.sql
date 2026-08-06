-- =====================================================================
-- surveys: Supabase schema
--
-- Run once per project (Supabase SQL Editor, or save as a migration).
-- Re-running is safe: tables are guarded, functions/policies are replaced.
--
-- Design notes:
--   * A "survey" is just a survey with one question. Same tables either way.
--   * All reads and writes go through SECURITY DEFINER functions so the
--     raw response rows are never selectable by clients. That is what
--     makes anonymity real rather than advisory.
--   * The respondent key is a per-survey hash of a device id (see
--     respondent.ts), so the same device cannot be correlated across
--     two different surveys.
-- =====================================================================

-- gen_random_uuid() is core since Postgres 13, so no pgcrypto needed.

-- ---------------------------------------------------------------- tables

create table if not exists surveys (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  title                   text not null,
  description             text,
  status                  text not null default 'draft'
                            check (status in ('draft', 'open', 'closed')),
  -- when true, survey_responses.user_id is always null (enforced below)
  anonymous               boolean not null default true,
  randomize_questions     boolean not null default false,
  one_response_per_device boolean not null default true,
  show_results            text not null default 'after_response'
                            check (show_results in ('always', 'after_response', 'never')),
  -- free-text answers can deanonymize; off unless you opt in
  show_text_answers       boolean not null default false,
  -- when true, only signed-in users may respond, and each account gets
  -- exactly one response (identity is still hidden if anonymous is on)
  require_auth            boolean not null default false,
  -- when true, only accounts on survey_voters may respond. Implies
  -- require_auth. See survey_voters below for why it is a separate table.
  restrict_to_voters      boolean not null default false,
  -- accepted responses per source per hour; 0 disables the limit
  rate_limit_per_hour     int not null default 60,
  opens_at                timestamptz,
  closes_at               timestamptz,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table surveys add column if not exists rate_limit_per_hour int not null default 60;
alter table surveys add column if not exists require_auth boolean not null default false;
alter table surveys add column if not exists restrict_to_voters boolean not null default false;

-- A fixed electorate: only these addresses may respond.
--
-- Deliberately a separate table from the responses, and the two are never
-- joined. voted_at records THAT someone voted; it says nothing about what they
-- chose. That is what lets a survey publish turnout ("who voted") while the
-- ballots themselves stay anonymous, which is how a real election works.
--
-- Keyed by email rather than user_id because the roll usually has to exist
-- before anyone has signed in, so there are no user ids yet to point at.
create table if not exists survey_voters (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references surveys(id) on delete cascade,
  email        text not null,
  -- what the turnout list shows. Never the email, which is not public.
  display_name text,
  voted_at     timestamptz,
  added_at     timestamptz not null default now()
);

-- Addresses are matched case and whitespace insensitively, so the index has
-- to agree with the lookup or a roll with " Bob@x.com " would admit twice.
create unique index if not exists survey_voters_unique
  on survey_voters (survey_id, lower(btrim(email)));

create table if not exists survey_questions (
  id                uuid primary key default gen_random_uuid(),
  survey_id           uuid not null references surveys(id) on delete cascade,
  position          int not null default 0,
  type              text not null,
  prompt            text not null,
  help_text         text,
  image_url         text,
  required          boolean not null default true,
  randomize_options boolean not null default false,
  min_selections    int,
  max_selections    int,
  rating_min        int not null default 1,
  rating_max        int not null default 5,
  rating_min_label  text,
  rating_max_label  text,
  -- how many head-to-head comparisons a 'pairwise' question asks for
  pair_count        int not null default 5,
  -- 'ranked' only: points for 1st, 2nd, 3rd... e.g. {5,3,1}. Null means
  -- Borda, where N places award N, N-1 ... 1. A vector shorter than the
  -- number of places falls back to Borda for the places it does not cover.
  rank_weights      int[],
  -- optional visibility rule; see survey_question_visible()
  show_if           jsonb
);

alter table survey_questions add column if not exists pair_count int not null default 5;
alter table survey_questions add column if not exists rank_weights int[];
alter table survey_questions add column if not exists show_if jsonb;

-- Stated as an explicit constraint so adding a type is an in-place migration
-- rather than something `create table if not exists` would silently skip.
alter table survey_questions drop constraint if exists survey_questions_type_check;
alter table survey_questions add constraint survey_questions_type_check
  check (type in ('single', 'multi', 'text', 'rating', 'pairwise', 'ranked'));

create table if not exists survey_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references survey_questions(id) on delete cascade,
  position    int not null default 0,
  label       text,
  image_url   text,
  image_alt   text,
  -- an option needs to render as something
  constraint survey_options_not_empty check (label is not null or image_url is not null)
);

create table if not exists survey_responses (
  id             uuid primary key default gen_random_uuid(),
  survey_id        uuid not null references surveys(id) on delete cascade,
  -- carries the duplicate guard; unique per survey
  respondent_key text not null,
  -- the device hash as sent. Equal to respondent_key when the survey allows
  -- one response per device; kept separately so that surveys allowing repeat
  -- responses can still tell "has this device answered before?", which is
  -- what unlocks `after_response` results.
  device_key     text,
  user_id        uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (survey_id, respondent_key)
);

alter table survey_responses add column if not exists device_key text;

create table if not exists survey_answers (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references survey_responses(id) on delete cascade,
  question_id  uuid not null references survey_questions(id) on delete cascade,
  option_id    uuid references survey_options(id) on delete cascade,
  text_value   text,
  rating_value int,
  -- pairwise only: option_id beat versus_option_id in one head-to-head
  versus_option_id uuid references survey_options(id) on delete cascade,
  -- ranked only: 1 for 1st place, 2 for 2nd, and so on. One row per place.
  rank         int
);

alter table survey_answers add column if not exists versus_option_id uuid
  references survey_options(id) on delete cascade;
alter table survey_answers add column if not exists rank int;

-- One row per accepted response, used only to enforce rate_limit_per_hour.
-- Deliberately holds no answer data. It is a counter, not a record.
create table if not exists survey_rate_events (
  id         bigserial primary key,
  survey_id    uuid not null references surveys(id) on delete cascade,
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index if not exists survey_rate_events_lookup_idx
  on survey_rate_events (survey_id, bucket, created_at);

create index if not exists survey_questions_poll_idx   on survey_questions (survey_id, position);
create index if not exists survey_options_question_idx on survey_options (question_id, position);
create index if not exists survey_responses_poll_idx   on survey_responses (survey_id);
create index if not exists survey_responses_device_idx on survey_responses (survey_id, device_key);
create index if not exists survey_answers_response_idx on survey_answers (response_id);
create index if not exists survey_answers_question_idx on survey_answers (question_id, option_id);

-- Belt and braces: an anonymous survey can never carry an identity, even if
-- something else in the app inserts directly.
create or replace function survey_strip_identity()
returns trigger
language plpgsql
as $$
begin
  if (select anonymous from surveys where id = new.survey_id) then
    new.user_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists survey_responses_strip_identity on survey_responses;
create trigger survey_responses_strip_identity
  before insert or update on survey_responses
  for each row execute function survey_strip_identity();

-- ------------------------------------------------------------------ rls
-- Everything is locked down. Clients go through the functions below.

alter table surveys            enable row level security;
alter table survey_questions   enable row level security;
alter table survey_options     enable row level security;
alter table survey_responses   enable row level security;
alter table survey_answers     enable row level security;
alter table survey_rate_events enable row level security;
alter table survey_voters      enable row level security;

drop policy if exists surveys_read_published on surveys;
create policy surveys_read_published on surveys
  for select using (status <> 'draft' or created_by = auth.uid());

drop policy if exists surveys_owner_write on surveys;
create policy surveys_owner_write on surveys
  for all using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists survey_questions_owner on survey_questions;
create policy survey_questions_owner on survey_questions
  for all using (exists (select 1 from surveys p where p.id = survey_id and p.created_by = auth.uid()));

drop policy if exists survey_options_owner on survey_options;
create policy survey_options_owner on survey_options
  for all using (exists (
    select 1 from survey_questions q join surveys p on p.id = q.survey_id
    where q.id = question_id and p.created_by = auth.uid()));

-- No policies at all on survey_responses / survey_answers: raw rows are
-- unreadable to every client. Tallies come from survey_results().
--
-- Same for survey_voters, which holds addresses. Turnout comes from
-- survey_turnout(), which returns display names and never an email.

-- ------------------------------------------------------------- functions

create or replace function survey_is_accepting(
  p_status    text,
  p_opens_at  timestamptz,
  p_closes_at timestamptz
) returns boolean
language sql
stable
as $$
  select p_status = 'open'
     and (p_opens_at  is null or now() >= p_opens_at)
     and (p_closes_at is null or now() <  p_closes_at);
$$;

-- Dedup key for an account on one survey.
--
-- Hashed and salted per survey so that storing it does not amount to storing
-- "user X answered survey Y" in plain sight, which matters because an
-- auth-gated survey can still be anonymous. It is computed server-side only
-- and never accepted from a client, so it does not need to resist a
-- preimage attack; it only needs to be stable and non-obvious.
create or replace function survey_account_key(p_poll_id uuid, p_uid uuid)
returns text
language sql
immutable
as $$ select md5('survey-account:' || p_poll_id::text || ':' || p_uid::text) $$;

-- Evaluate a question's show_if rule against the answers submitted so far.
--
-- The same rules run client-side in branching.ts. They have to agree: the
-- client decides what to display, but the server decides what "required"
-- means, and a required question hidden by a branch must not be demanded.
--
-- show_if shape:
--   {"question_id": uuid,
--    "op": "answered" | "not_answered" | "is" | "is_not" | "includes"
--        | "gte" | "lte",
--    "value": <option id | number>}
create or replace function survey_question_visible(p_show_if jsonb, p_answers jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_target  uuid;
  v_op      text;
  v_value   text;
  v_answer  jsonb;
  v_options text[];
  v_rating  numeric;
begin
  if p_show_if is null or jsonb_typeof(p_show_if) <> 'object' then
    return true;                       -- no rule means always visible
  end if;

  v_target := nullif(p_show_if->>'question_id', '')::uuid;
  v_op     := coalesce(p_show_if->>'op', 'answered');
  v_value  := p_show_if->>'value';

  if v_target is null then
    return true;
  end if;

  select a into v_answer
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  where (a->>'question_id')::uuid = v_target
  limit 1;

  -- an answer of "nothing selected" counts as unanswered
  if v_answer is not null then
    select coalesce(array_agg(e), '{}'::text[]) into v_options
    from jsonb_array_elements_text(coalesce(v_answer->'option_ids', '[]'::jsonb)) e;

    if coalesce(array_length(v_options, 1), 0) = 0
       and nullif(btrim(coalesce(v_answer->>'text_value', '')), '') is null
       and v_answer->>'rating_value' is null then
      v_answer := null;
    end if;
  end if;

  if v_op = 'answered' then
    return v_answer is not null;
  elsif v_op = 'not_answered' then
    return v_answer is null;
  end if;

  if v_answer is null then
    return false;                      -- every other test needs an answer
  end if;

  -- Every branch below is wrapped in coalesce: comparing against a field the
  -- answer does not carry yields NULL, and a NULL leaking out here would make
  -- `if not survey_question_visible(...)` silently fall through in survey_submit.
  -- The TypeScript side returns a plain false, so this must too.
  if v_op = 'includes' then
    return coalesce(v_value = any (v_options), false);
  elsif v_op = 'is' then
    return coalesce(
      (coalesce(array_length(v_options, 1), 0) = 1 and v_options[1] = v_value)
      or v_answer->>'text_value' = v_value
      or v_answer->>'rating_value' = v_value,
      false);
  elsif v_op = 'is_not' then
    return not coalesce(
      v_value = any (v_options)
      or v_answer->>'text_value' = v_value
      or v_answer->>'rating_value' = v_value,
      false);
  elsif v_op in ('gte', 'lte') then
    begin
      v_rating := (v_answer->>'rating_value')::numeric;
    exception when others then
      return false;
    end;
    if v_rating is null or v_value is null then
      return false;
    end if;
    if v_op = 'gte' then
      return v_rating >= v_value::numeric;
    else
      return v_rating <= v_value::numeric;
    end if;
  end if;

  return true;
end;
$$;

-- Fetch a survey with its questions and options. Drafts are visible only
-- to their creator.
create or replace function survey_get(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',                      p.id,
    'slug',                    p.slug,
    'title',                   p.title,
    'description',             p.description,
    'status',                  p.status,
    'anonymous',               p.anonymous,
    'randomize_questions',     p.randomize_questions,
    'one_response_per_device', p.one_response_per_device,
    'show_results',            p.show_results,
    'show_text_answers',       p.show_text_answers,
    'rate_limit_per_hour',     p.rate_limit_per_hour,
    'require_auth',            p.require_auth,
    'restrict_to_voters',      p.restrict_to_voters,
    'opens_at',                p.opens_at,
    'closes_at',               p.closes_at,
    'accepting',               survey_is_accepting(p.status, p.opens_at, p.closes_at),
    'is_owner',                p.created_by is not distinct from auth.uid() and auth.uid() is not null,
    'questions', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.position)
      from (
        select
          qq.id, qq.position, qq.type, qq.prompt, qq.help_text, qq.image_url,
          qq.required, qq.randomize_options, qq.min_selections, qq.max_selections,
          qq.rating_min, qq.rating_max, qq.rating_min_label, qq.rating_max_label,
          qq.pair_count, qq.rank_weights, qq.show_if,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',        o.id,
              'position',  o.position,
              'label',     o.label,
              'image_url', o.image_url,
              'image_alt', o.image_alt
            ) order by o.position)
            from survey_options o where o.question_id = qq.id
          ), '[]'::jsonb) as options
        from survey_questions qq
        where qq.survey_id = p.id
      ) q
    ), '[]'::jsonb)
  )
  from surveys p
  where p.slug = p_slug
    and (p.status <> 'draft' or p.created_by = auth.uid());
$$;

-- Has this device already responded?
create or replace function survey_has_responded(p_slug text, p_respondent_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from survey_responses r
    join surveys p on p.id = r.survey_id
    where p.slug = p_slug
      and (
        r.device_key = p_respondent_key
        -- an auth-gated survey follows the account, not the browser, so it
        -- still reads as "answered" from a different device
        or (p.require_auth
            and auth.uid() is not null
            and r.respondent_key = survey_account_key(p.id, auth.uid()))
      )
  );
$$;

-- Submit a whole response atomically: validates the survey is open, that
-- required questions are answered, and that each answer fits its question.
--
-- p_answers: [{"question_id": uuid,
--              "option_ids": [uuid],      -- single / multi
--              "text_value": text,        -- text
--              "rating_value": int}]      -- rating
create or replace function survey_submit(
  p_slug           text,
  p_respondent_key text,
  p_answers        jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll        surveys;
  v_key         text;
  v_response_id uuid;
  v_q           survey_questions;
  v_answer      jsonb;
  v_option_ids  uuid[];
  v_valid       int;
  v_min         int;
  v_max         int;
  v_text        text;
  v_rating      int;
  v_oid         uuid;
  v_bucket      text;
  v_hits        int;
  v_pairs       jsonb;
  v_pair        jsonb;
  v_winner      uuid;
  v_loser       uuid;
  v_seen        int;
  v_places      int;
  v_rank        int;
  v_needs_auth  boolean;
  v_email       text;
  v_voter_id    uuid;
begin
  select * into v_poll from surveys where slug = p_slug;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0002';
  end if;

  if not survey_is_accepting(v_poll.status, v_poll.opens_at, v_poll.closes_at) then
    raise exception 'survey_closed' using errcode = 'P0001';
  end if;

  -- A restricted electorate is meaningless without an account to check
  -- against, so it implies require_auth rather than being combinable with it.
  v_needs_auth := v_poll.require_auth or v_poll.restrict_to_voters;

  if v_needs_auth and auth.uid() is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  -- The electorate check. This is the whole point of the setting: hiding the
  -- button in a UI stops nobody, because survey_submit is granted to every
  -- authenticated role and anyone can create an account.
  if v_poll.restrict_to_voters then
    select u.email into v_email from auth.users u where u.id = auth.uid();

    select v.id into v_voter_id
    from survey_voters v
    where v.survey_id = v_poll.id
      and lower(btrim(v.email)) = lower(btrim(coalesce(v_email, '')))
    limit 1;

    if v_voter_id is null then
      raise exception 'not_an_eligible_voter' using errcode = 'P0001';
    end if;
  end if;

  if p_respondent_key is null or length(p_respondent_key) < 16 then
    raise exception 'bad_respondent_key' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'bad_answers_payload' using errcode = 'P0001';
  end if;

  -- Rate limit by client IP where PostgREST exposes one, falling back to the
  -- device key. The fallback is weak on its own (a fresh key resets the
  -- count), so the IP is what does the real work in production.
  --
  -- Note this counts *accepted* responses only: a rejected submission rolls
  -- back its own counter row with the rest of the transaction. It is a
  -- ballot-stuffing guard, not a request-flood guard. Put a WAF rule in
  -- front of PostgREST if you need the latter.
  if v_poll.rate_limit_per_hour > 0 then
    v_bucket := coalesce(
      nullif(
        btrim(split_part(
          coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json
            ->> 'x-forwarded-for',
          ',', 1)),
        ''),
      p_respondent_key
    );

    delete from survey_rate_events
     where survey_id = v_poll.id and created_at < now() - interval '1 hour';

    select count(*) into v_hits
    from survey_rate_events
    where survey_id = v_poll.id
      and bucket = v_bucket
      and created_at > now() - interval '1 hour';

    if v_hits >= v_poll.rate_limit_per_hour then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

    insert into survey_rate_events (survey_id, bucket) values (v_poll.id, v_bucket);
  end if;

  -- The unique index on (survey_id, respondent_key) carries the duplicate
  -- guard, so the key is chosen to make it mean the right thing:
  --   auth-gated  -> one per account (device is irrelevant)
  --   device-gated-> the device hash the client sent
  --   unlimited   -> a fresh random key, which can never collide
  if v_needs_auth then
    v_key := survey_account_key(v_poll.id, auth.uid());
  elsif v_poll.one_response_per_device then
    v_key := p_respondent_key;
  else
    v_key := gen_random_uuid()::text;
  end if;

  begin
    insert into survey_responses (survey_id, respondent_key, device_key, user_id)
    values (v_poll.id, v_key, p_respondent_key, auth.uid())  -- trigger nulls user_id if anonymous
    returning id into v_response_id;
  exception when unique_violation then
    raise exception 'already_responded' using errcode = 'P0001';
  end;

  -- Turnout. Records THAT this voter voted, never what they chose, and rides
  -- the same transaction so it can never drift from the ballot count. The
  -- roll and the responses are never joined anywhere.
  if v_voter_id is not null then
    update survey_voters set voted_at = now() where id = v_voter_id;
  end if;

  for v_q in
    select * from survey_questions where survey_id = v_poll.id order by position
  loop
    -- A question hidden by a branch is not asked, so it cannot be required.
    -- Evaluated here rather than trusted from the client: otherwise anyone
    -- could skip a required question by claiming it was branched away.
    if not survey_question_visible(v_q.show_if, p_answers) then
      continue;
    end if;

    select a into v_answer
    from jsonb_array_elements(p_answers) a
    where (a->>'question_id')::uuid = v_q.id
    limit 1;

    if v_answer is null then
      if v_q.required then
        raise exception 'missing_required_answer:%', v_q.id using errcode = 'P0001';
      end if;
      continue;
    end if;

    if v_q.type in ('single', 'multi') then
      -- distinct: picking the same option twice is one selection, not a
      -- reason to reject the whole response
      select coalesce(array_agg(distinct (e)::uuid), '{}'::uuid[])
        into v_option_ids
      from jsonb_array_elements_text(coalesce(v_answer->'option_ids', '[]'::jsonb)) e;

      -- every id must actually belong to this question
      select count(*) into v_valid
      from survey_options o
      where o.question_id = v_q.id and o.id = any (v_option_ids);

      if v_valid <> coalesce(array_length(v_option_ids, 1), 0) then
        raise exception 'unknown_option_for_question:%', v_q.id using errcode = 'P0001';
      end if;

      if v_q.type = 'single' then
        v_min := case when v_q.required then 1 else 0 end;
        v_max := 1;
      else
        v_min := coalesce(v_q.min_selections, case when v_q.required then 1 else 0 end);
        v_max := coalesce(v_q.max_selections, v_valid);
      end if;

      if v_valid < v_min or v_valid > v_max then
        raise exception 'selection_count_out_of_range:%', v_q.id using errcode = 'P0001';
      end if;

      foreach v_oid in array v_option_ids loop
        insert into survey_answers (response_id, question_id, option_id)
        values (v_response_id, v_q.id, v_oid);
      end loop;

    elsif v_q.type = 'text' then
      v_text := nullif(btrim(coalesce(v_answer->>'text_value', '')), '');
      if v_text is null then
        if v_q.required then
          raise exception 'missing_required_answer:%', v_q.id using errcode = 'P0001';
        end if;
        continue;
      end if;
      insert into survey_answers (response_id, question_id, text_value)
      values (v_response_id, v_q.id, left(v_text, 4000));

    elsif v_q.type = 'rating' then
      v_rating := (v_answer->>'rating_value')::int;
      if v_rating is null then
        if v_q.required then
          raise exception 'missing_required_answer:%', v_q.id using errcode = 'P0001';
        end if;
        continue;
      end if;
      if v_rating < v_q.rating_min or v_rating > v_q.rating_max then
        raise exception 'rating_out_of_range:%', v_q.id using errcode = 'P0001';
      end if;
      insert into survey_answers (response_id, question_id, rating_value)
      values (v_response_id, v_q.id, v_rating);

    elsif v_q.type = 'ranked' then
      -- p_answers entry: {"option_ids": [1st, 2nd, 3rd]}. The ORDER IS THE
      -- ANSWER, so this deliberately does not reuse the single/multi branch
      -- above: its array_agg(distinct ...) sorts by uuid, which would quietly
      -- rewrite the ballot into a different ranking.
      if jsonb_typeof(coalesce(v_answer->'option_ids', '[]'::jsonb)) <> 'array' then
        raise exception 'bad_answers_payload' using errcode = 'P0001';
      end if;

      select coalesce(array_agg(t.e::uuid order by t.ord), '{}'::uuid[])
        into v_option_ids
      from jsonb_array_elements_text(coalesce(v_answer->'option_ids', '[]'::jsonb))
        with ordinality as t(e, ord);

      v_seen := coalesce(array_length(v_option_ids, 1), 0);

      -- Ranking the same option twice is a contradiction, not a typo to
      -- absorb: 1st and 3rd cannot both be true of one name. Single/multi
      -- collapse duplicates; ranked has to reject them.
      if v_seen <> (select count(distinct e) from unnest(v_option_ids) e) then
        raise exception 'duplicate_rank:%', v_q.id using errcode = 'P0001';
      end if;

      select count(*) into v_valid
      from survey_options o
      where o.question_id = v_q.id and o.id = any (v_option_ids);

      if v_valid <> v_seen then
        raise exception 'unknown_option_for_question:%', v_q.id using errcode = 'P0001';
      end if;

      select coalesce(v_q.max_selections, count(*)::int) into v_places
      from survey_options o where o.question_id = v_q.id;

      -- A required ranked question defaults to every place filled. A partial
      -- ballot is allowed only where min_selections says so explicitly.
      v_min := coalesce(v_q.min_selections, case when v_q.required then v_places else 0 end);

      if v_seen < v_min or v_seen > v_places then
        raise exception 'selection_count_out_of_range:%', v_q.id using errcode = 'P0001';
      end if;

      v_rank := 0;
      foreach v_oid in array v_option_ids loop
        v_rank := v_rank + 1;
        insert into survey_answers (response_id, question_id, option_id, rank)
        values (v_response_id, v_q.id, v_oid, v_rank);
      end loop;

    elsif v_q.type = 'pairwise' then
      -- p_answers entry: {"pairs": [{"winner": uuid, "loser": uuid}, ...]}
      v_pairs := coalesce(v_answer->'pairs', '[]'::jsonb);
      if jsonb_typeof(v_pairs) <> 'array' then
        raise exception 'bad_answers_payload' using errcode = 'P0001';
      end if;

      v_seen := 0;
      for v_pair in select * from jsonb_array_elements(v_pairs)
      loop
        v_winner := nullif(v_pair->>'winner', '')::uuid;
        v_loser  := nullif(v_pair->>'loser', '')::uuid;

        if v_winner is null or v_loser is null or v_winner = v_loser then
          raise exception 'bad_pair:%', v_q.id using errcode = 'P0001';
        end if;

        select count(*) into v_valid
        from survey_options o
        where o.question_id = v_q.id and o.id in (v_winner, v_loser);

        if v_valid <> 2 then
          raise exception 'unknown_option_for_question:%', v_q.id using errcode = 'P0001';
        end if;

        insert into survey_answers (response_id, question_id, option_id, versus_option_id)
        values (v_response_id, v_q.id, v_winner, v_loser);
        v_seen := v_seen + 1;
      end loop;

      if v_q.required and v_seen = 0 then
        raise exception 'missing_required_answer:%', v_q.id using errcode = 'P0001';
      end if;

      -- guard against a client inventing thousands of comparisons
      if v_seen > greatest(v_q.pair_count * 2, 20) then
        raise exception 'too_many_pairs:%', v_q.id using errcode = 'P0001';
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end;
$$;

-- Aggregate tallies. Never returns individual response rows, so it is
-- safe to expose to anon. Respects the survey's show_results setting.
create or replace function survey_results(
  p_slug           text,
  p_respondent_key text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_poll  surveys;
  v_owner boolean;
  v_total int;
begin
  select * into v_poll from surveys where slug = p_slug;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0002';
  end if;

  v_owner := auth.uid() is not null and v_poll.created_by = auth.uid();

  if not v_owner then
    if v_poll.show_results = 'never' then
      raise exception 'results_hidden' using errcode = 'P0001';
    end if;
    if v_poll.show_results = 'after_response'
       and not coalesce(survey_has_responded(p_slug, p_respondent_key), false) then
      raise exception 'results_locked' using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_total from survey_responses where survey_id = v_poll.id;

  return jsonb_build_object(
    'survey_id',         v_poll.id,
    'slug',            v_poll.slug,
    'title',           v_poll.title,
    'total_responses', v_total,
    'questions', coalesce((
      select jsonb_agg(qr order by qr.position)
      from (
        select
          q.id, q.position, q.type, q.prompt, q.rating_min, q.rating_max,
          (select count(distinct a.response_id)
             from survey_answers a where a.question_id = q.id) as answered,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',        o.id,
              'position',  o.position,
              'label',     o.label,
              'image_url', o.image_url,
              'image_alt', o.image_alt,
              'votes',     v.votes,
              'pct',       case when v_total = 0 then 0
                                else round((v.votes::numeric * 100) / v_total, 1) end,
              -- pairwise only; zero elsewhere
              'wins',      v.wins,
              'losses',    v.losses,
              'win_rate',  case when v.wins + v.losses = 0 then 0
                                else round((v.wins::numeric * 100) / (v.wins + v.losses), 1)
                           end,
              -- ranked only; zero elsewhere
              'points',            v.points,
              'first_place_votes', v.first_place_votes,
              'rank_counts',       v.rank_counts
            ) order by
              case when q.type = 'pairwise'
                   then -(case when v.wins + v.losses = 0 then 0
                               else v.wins::numeric / (v.wins + v.losses) end)
                   when q.type = 'ranked'
                   then -v.points::numeric
                   else -v.votes::numeric
              end,
              -- a ranked tie on points goes to whoever got more firsts
              case when q.type = 'ranked' then -v.first_place_votes::numeric else 0 end,
              o.position)
            from survey_options o
            cross join lateral (
              select
                -- a pairwise "vote" is a win; for every other type each
                -- answer row is one selection
                count(*) filter (
                  where a.option_id = o.id and a.versus_option_id is null
                )::int as votes,
                count(*) filter (
                  where a.option_id = o.id and a.versus_option_id is not null
                )::int as wins,
                count(*) filter (where a.versus_option_id = o.id)::int as losses,
                count(*) filter (
                  where a.option_id = o.id and a.rank = 1
                )::int as first_place_votes,
                -- weight per place, defaulting to Borda for any place the
                -- vector does not cover (and for a question with no vector)
                coalesce(sum(
                  case when a.option_id = o.id and a.rank is not null then
                    coalesce(
                      q.rank_weights[a.rank],
                      greatest(
                        coalesce(
                          q.max_selections,
                          (select count(*)::int from survey_options o2
                            where o2.question_id = q.id)
                        ) - a.rank + 1,
                        0)
                    )
                  else 0 end
                ), 0)::int as points,
                coalesce((
                  select jsonb_object_agg(t.rank::text, t.n)
                  from (
                    select a2.rank, count(*)::int as n
                    from survey_answers a2
                    where a2.option_id = o.id and a2.rank is not null
                    group by a2.rank
                  ) t
                ), '{}'::jsonb) as rank_counts
              from survey_answers a
              where a.option_id = o.id or a.versus_option_id = o.id
            ) v
            where o.question_id = q.id
          ), '[]'::jsonb) as options,
          (select round(avg(a.rating_value)::numeric, 2)
             from survey_answers a where a.question_id = q.id) as rating_average,
          coalesce((
            select jsonb_object_agg(t.rating_value::text, t.n)
            from (
              select a.rating_value, count(*)::int as n
              from survey_answers a
              where a.question_id = q.id and a.rating_value is not null
              group by a.rating_value
            ) t
          ), '{}'::jsonb) as rating_histogram,
          case
            when q.type = 'text' and (v_owner or v_poll.show_text_answers) then
              coalesce((
                select jsonb_agg(a.text_value order by a.id)
                from survey_answers a
                where a.question_id = q.id and a.text_value is not null
              ), '[]'::jsonb)
            else '[]'::jsonb
          end as text_answers
        from survey_questions q
        where q.survey_id = v_poll.id
      ) qr
    ), '[]'::jsonb)
  );
end;
$$;

-- Create or update a survey and its questions/options in one transaction.
-- Questions and options carried over by id keep their existing answers;
-- anything absent from the payload is deleted.
create or replace function survey_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := nullif(p_payload->>'id', '')::uuid;
  v_uid    uuid := auth.uid();
  v_qids   uuid[] := '{}';
  v_oids   uuid[] := '{}';
  v_q      jsonb;
  v_o      jsonb;
  v_qid    uuid;
  v_oid    uuid;
  v_qpos   int := 0;
  v_opos   int;
  v_weights int[];
  v_slug   text := btrim(coalesce(p_payload->>'slug', ''));
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if v_slug = '' then
    raise exception 'slug_required' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into surveys (
      slug, title, description, status, anonymous, randomize_questions,
      one_response_per_device, show_results, show_text_answers,
      rate_limit_per_hour, require_auth, restrict_to_voters,
      opens_at, closes_at, created_by
    ) values (
      v_slug,
      coalesce(p_payload->>'title', 'Untitled'),
      p_payload->>'description',
      coalesce(p_payload->>'status', 'draft'),
      coalesce((p_payload->>'anonymous')::boolean, true),
      coalesce((p_payload->>'randomize_questions')::boolean, false),
      coalesce((p_payload->>'one_response_per_device')::boolean, true),
      coalesce(p_payload->>'show_results', 'after_response'),
      coalesce((p_payload->>'show_text_answers')::boolean, false),
      coalesce((p_payload->>'rate_limit_per_hour')::int, 60),
      coalesce((p_payload->>'require_auth')::boolean, false),
      coalesce((p_payload->>'restrict_to_voters')::boolean, false),
      nullif(p_payload->>'opens_at', '')::timestamptz,
      nullif(p_payload->>'closes_at', '')::timestamptz,
      v_uid
    )
    returning id into v_id;
  else
    update surveys set
      slug                    = v_slug,
      title                   = coalesce(p_payload->>'title', title),
      description             = p_payload->>'description',
      status                  = coalesce(p_payload->>'status', status),
      anonymous               = coalesce((p_payload->>'anonymous')::boolean, anonymous),
      randomize_questions     = coalesce((p_payload->>'randomize_questions')::boolean, randomize_questions),
      one_response_per_device = coalesce((p_payload->>'one_response_per_device')::boolean, one_response_per_device),
      show_results            = coalesce(p_payload->>'show_results', show_results),
      show_text_answers       = coalesce((p_payload->>'show_text_answers')::boolean, show_text_answers),
      rate_limit_per_hour     = coalesce((p_payload->>'rate_limit_per_hour')::int, rate_limit_per_hour),
      require_auth            = coalesce((p_payload->>'require_auth')::boolean, require_auth),
      restrict_to_voters      = coalesce((p_payload->>'restrict_to_voters')::boolean, restrict_to_voters),
      opens_at                = nullif(p_payload->>'opens_at', '')::timestamptz,
      closes_at               = nullif(p_payload->>'closes_at', '')::timestamptz,
      updated_at              = now()
    where id = v_id and created_by = v_uid;

    if not found then
      raise exception 'not_found_or_not_owner' using errcode = 'P0001';
    end if;
  end if;

  for v_q in select * from jsonb_array_elements(coalesce(p_payload->'questions', '[]'::jsonb))
  loop
    v_qid := nullif(v_q->>'id', '')::uuid;

    -- Ranked point weights, validated here so a bad vector cannot reach the
    -- tally. Absent or non-array clears it, which means Borda.
    v_weights := null;
    if jsonb_typeof(v_q->'rank_weights') = 'array' then
      if jsonb_array_length(v_q->'rank_weights') > 100 then
        raise exception 'bad_rank_weights' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_q->'rank_weights') w
        where jsonb_typeof(w) <> 'number'
           or (w #>> '{}')::numeric < 0
           or (w #>> '{}')::numeric <> floor((w #>> '{}')::numeric)
      ) then
        raise exception 'bad_rank_weights' using errcode = 'P0001';
      end if;
      select array_agg(w.v::int order by w.ord) into v_weights
      from jsonb_array_elements_text(v_q->'rank_weights') with ordinality as w(v, ord);
    end if;

    if v_qid is null or not exists (
      select 1 from survey_questions where id = v_qid and survey_id = v_id
    ) then
      insert into survey_questions (
        survey_id, position, type, prompt, help_text, image_url, required,
        randomize_options, min_selections, max_selections,
        rating_min, rating_max, rating_min_label, rating_max_label,
        pair_count, rank_weights, show_if
      ) values (
        v_id, v_qpos,
        coalesce(v_q->>'type', 'single'),
        coalesce(v_q->>'prompt', ''),
        v_q->>'help_text',
        v_q->>'image_url',
        coalesce((v_q->>'required')::boolean, true),
        coalesce((v_q->>'randomize_options')::boolean, false),
        nullif(v_q->>'min_selections', '')::int,
        nullif(v_q->>'max_selections', '')::int,
        coalesce((v_q->>'rating_min')::int, 1),
        coalesce((v_q->>'rating_max')::int, 5),
        v_q->>'rating_min_label',
        v_q->>'rating_max_label',
        coalesce((v_q->>'pair_count')::int, 5),
        v_weights,
        case when jsonb_typeof(v_q->'show_if') = 'object' then v_q->'show_if' end
      )
      returning id into v_qid;
    else
      update survey_questions set
        position          = v_qpos,
        type              = coalesce(v_q->>'type', type),
        prompt            = coalesce(v_q->>'prompt', prompt),
        help_text         = v_q->>'help_text',
        image_url         = v_q->>'image_url',
        required          = coalesce((v_q->>'required')::boolean, required),
        randomize_options = coalesce((v_q->>'randomize_options')::boolean, randomize_options),
        min_selections    = nullif(v_q->>'min_selections', '')::int,
        max_selections    = nullif(v_q->>'max_selections', '')::int,
        rating_min        = coalesce((v_q->>'rating_min')::int, rating_min),
        rating_max        = coalesce((v_q->>'rating_max')::int, rating_max),
        rating_min_label  = v_q->>'rating_min_label',
        rating_max_label  = v_q->>'rating_max_label',
        pair_count        = coalesce((v_q->>'pair_count')::int, pair_count),
        rank_weights      = v_weights,
        show_if           = case when jsonb_typeof(v_q->'show_if') = 'object'
                                 then v_q->'show_if' end
      where id = v_qid;
    end if;

    v_qids := v_qids || v_qid;
    v_opos := 0;

    for v_o in select * from jsonb_array_elements(coalesce(v_q->'options', '[]'::jsonb))
    loop
      v_oid := nullif(v_o->>'id', '')::uuid;

      if v_oid is null or not exists (
        select 1 from survey_options where id = v_oid and question_id = v_qid
      ) then
        insert into survey_options (question_id, position, label, image_url, image_alt)
        values (v_qid, v_opos,
                nullif(v_o->>'label', ''),
                nullif(v_o->>'image_url', ''),
                nullif(v_o->>'image_alt', ''))
        returning id into v_oid;
      else
        update survey_options set
          position  = v_opos,
          label     = nullif(v_o->>'label', ''),
          image_url = nullif(v_o->>'image_url', ''),
          image_alt = nullif(v_o->>'image_alt', '')
        where id = v_oid;
      end if;

      v_oids := v_oids || v_oid;
      v_opos := v_opos + 1;
    end loop;

    v_qpos := v_qpos + 1;
  end loop;

  -- prune anything the payload dropped (cascades to its answers)
  delete from survey_options o
   using survey_questions q
   where o.question_id = q.id
     and q.survey_id = v_id
     and not (o.id = any (v_oids));

  delete from survey_questions
   where survey_id = v_id and not (id = any (v_qids));

  return survey_get(v_slug);
end;
$$;

-- Surveys you created, for an admin list screen.
create or replace function survey_list_mine()
returns table (
  id uuid, slug text, title text, status text,
  responses bigint, created_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.slug, p.title, p.status,
         (select count(*) from survey_responses r where r.survey_id = p.id),
         p.created_at, p.updated_at
  from surveys p
  where auth.uid() is not null and p.created_by = auth.uid()
  order by p.updated_at desc;
$$;

-- Copy a survey's structure under a new slug. Responses are never copied,
-- the duplicate starts as an empty draft.
create or replace function survey_duplicate(p_slug text, p_new_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src   surveys;
  v_uid   uuid := auth.uid();
  v_new   uuid;
  v_slug  text := btrim(coalesce(p_new_slug, ''));
  v_q     record;
  v_qid   uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if v_slug = '' then
    raise exception 'slug_required' using errcode = 'P0001';
  end if;

  select * into v_src from surveys where slug = p_slug and created_by = v_uid;
  if not found then
    raise exception 'not_found_or_not_owner' using errcode = 'P0001';
  end if;

  if exists (select 1 from surveys where slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  insert into surveys (
    slug, title, description, status, anonymous, randomize_questions,
    one_response_per_device, show_results, show_text_answers,
    rate_limit_per_hour, require_auth, restrict_to_voters, created_by
  )
  values (
    v_slug, v_src.title || ' (copy)', v_src.description, 'draft',
    v_src.anonymous, v_src.randomize_questions, v_src.one_response_per_device,
    v_src.show_results, v_src.show_text_answers, v_src.rate_limit_per_hour,
    v_src.require_auth, v_src.restrict_to_voters, v_uid
  )
  returning id into v_new;

  -- The electorate is structure, so it copies. The voted_at stamps are
  -- results, so they do not: the duplicate starts with nobody having voted.
  insert into survey_voters (survey_id, email, display_name)
  select v_new, sv.email, sv.display_name
  from survey_voters sv where sv.survey_id = v_src.id;

  for v_q in
    select * from survey_questions where survey_id = v_src.id order by position
  loop
    insert into survey_questions (
      survey_id, position, type, prompt, help_text, image_url, required,
      randomize_options, min_selections, max_selections,
      rating_min, rating_max, rating_min_label, rating_max_label, pair_count,
      rank_weights
    )
    values (
      v_new, v_q.position, v_q.type, v_q.prompt, v_q.help_text, v_q.image_url,
      v_q.required, v_q.randomize_options, v_q.min_selections, v_q.max_selections,
      v_q.rating_min, v_q.rating_max, v_q.rating_min_label, v_q.rating_max_label,
      v_q.pair_count, v_q.rank_weights
    )
    returning id into v_qid;

    insert into survey_options (question_id, position, label, image_url, image_alt)
    select v_qid, o.position, o.label, o.image_url, o.image_alt
    from survey_options o
    where o.question_id = v_q.id
    order by o.position;
  end loop;

  return survey_get(v_slug);
end;
$$;

-- ------------------------------------------------------------ electorate

-- Replace the roll wholesale. Owner only.
--
-- p_voters: [{"email": "...", "display_name": "..."}, ...]
--
-- Re-adding an address that has already voted keeps its voted_at, so fixing a
-- typo in someone's display name does not erase the fact that they voted.
-- Removing an address drops the row entirely, stamp included, which is the
-- point: they are off the roll.
create or replace function survey_set_voters(p_slug text, p_voters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll surveys;
  v_kept text[];
begin
  select * into v_poll from surveys where slug = p_slug;
  if not found or auth.uid() is null or v_poll.created_by is distinct from auth.uid() then
    raise exception 'not_found_or_not_owner' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_voters) <> 'array' then
    raise exception 'bad_voter_list' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_voters) e
    where nullif(btrim(coalesce(e->>'email', '')), '') is null
  ) then
    raise exception 'bad_voter_list' using errcode = 'P0001';
  end if;

  insert into survey_voters (survey_id, email, display_name)
  select v_poll.id, btrim(e->>'email'), nullif(btrim(coalesce(e->>'display_name', '')), '')
  from jsonb_array_elements(p_voters) e
  on conflict (survey_id, lower(btrim(email)))
  do update set display_name = excluded.display_name;

  select coalesce(array_agg(lower(btrim(e->>'email'))), '{}'::text[]) into v_kept
  from jsonb_array_elements(p_voters) e;

  delete from survey_voters
   where survey_id = v_poll.id
     and not (lower(btrim(email)) = any (v_kept));

  return jsonb_build_object(
    'ok', true,
    'voters', (select count(*) from survey_voters where survey_id = v_poll.id)
  );
end;
$$;

-- Turnout: who is on the roll and whether they have voted.
--
-- Safe to expose publicly because it returns display names and a boolean,
-- never an address and never an answer. It says that someone voted, not how.
create or replace function survey_turnout(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'display_name', t.display_name,
           'voted',        t.voted_at is not null
         ) order by t.display_name nulls last), '[]'::jsonb)
  from survey_voters t
  join surveys p on p.id = t.survey_id
  where p.slug = p_slug;
$$;

-- What the caller may do: used to pick which screen to render. The screen is
-- a convenience; survey_submit enforces the same rule regardless.
create or replace function survey_my_voter_status(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_poll  surveys;
  v_email text;
  v_row   survey_voters;
begin
  select * into v_poll from surveys where slug = p_slug;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0002';
  end if;

  if auth.uid() is null then
    return jsonb_build_object('signed_in', false, 'eligible', false, 'voted', false);
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  if not v_poll.restrict_to_voters then
    return jsonb_build_object('signed_in', true, 'eligible', true, 'voted',
      coalesce(survey_has_responded(p_slug, survey_account_key(v_poll.id, auth.uid())), false));
  end if;

  select * into v_row from survey_voters
   where survey_id = v_poll.id
     and lower(btrim(email)) = lower(btrim(coalesce(v_email, '')))
   limit 1;

  return jsonb_build_object(
    'signed_in',    true,
    'eligible',     found,
    'voted',        found and v_row.voted_at is not null,
    'display_name', case when found then v_row.display_name end
  );
end;
$$;

-- Owner-only dump of every response, for CSV export.
--
-- This exposes which answers came from the same respondent. On an anonymous
-- survey that linkage can still identify someone when the answer combination is
-- distinctive, so it is restricted to the owner and never surfaced publicly.
create or replace function survey_export(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_poll surveys;
begin
  select * into v_poll from surveys where slug = p_slug;
  if not found or v_poll.created_by is distinct from auth.uid() or auth.uid() is null then
    raise exception 'not_found_or_not_owner' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'slug',      v_poll.slug,
    'title',     v_poll.title,
    'anonymous', v_poll.anonymous,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'position', q.position, 'prompt', q.prompt, 'type', q.type
      ) order by q.position)
      from survey_questions q where q.survey_id = v_poll.id
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',         r.id,
        'created_at', r.created_at,
        'answers', coalesce((
          select jsonb_object_agg(s.question_id::text, s.value)
          from (
            select
              a.question_id,
              jsonb_build_object(
                -- ranked answers come out 1st, 2nd, 3rd. Every other type has
                -- a null rank throughout, so it falls through to option order.
                'labels', coalesce(
                  jsonb_agg(o.label order by a.rank nulls last, o.position)
                    filter (where a.option_id is not null),
                  '[]'::jsonb),
                'text',   max(a.text_value),
                'rating', max(a.rating_value)
              ) as value
            from survey_answers a
            left join survey_options o on o.id = a.option_id
            where a.response_id = r.id
            group by a.question_id
          ) s
        ), '{}'::jsonb)
      ) order by r.created_at)
      from survey_responses r where r.survey_id = v_poll.id
    ), '[]'::jsonb)
  );
end;
$$;

-- --------------------------------------------------------------- grants

-- Postgres grants EXECUTE to PUBLIC on every new function, and anon /
-- authenticated inherit that. Revoking from those two roles alone would do
-- nothing. The revoke has to name PUBLIC.
revoke all on function survey_get(text)                   from public;
revoke all on function survey_has_responded(text, text)   from public;
revoke all on function survey_submit(text, text, jsonb)   from public;
revoke all on function survey_results(text, text)         from public;
revoke all on function survey_save(jsonb)                 from public;
revoke all on function survey_list_mine()                 from public;
revoke all on function survey_duplicate(text, text)       from public;
revoke all on function survey_export(text)                from public;
revoke all on function survey_set_voters(text, jsonb)     from public;
revoke all on function survey_turnout(text)               from public;
revoke all on function survey_my_voter_status(text)       from public;
revoke all on function survey_is_accepting(text, timestamptz, timestamptz) from public;
revoke all on function survey_account_key(uuid, uuid)     from public;
revoke all on function survey_question_visible(jsonb, jsonb) from public;

grant execute on function survey_get(text)                to anon, authenticated;
grant execute on function survey_has_responded(text,text) to anon, authenticated;
grant execute on function survey_submit(text,text,jsonb)  to anon, authenticated;
grant execute on function survey_results(text,text)       to anon, authenticated;
grant execute on function survey_save(jsonb)              to authenticated;
grant execute on function survey_list_mine()              to authenticated;
grant execute on function survey_duplicate(text, text)    to authenticated;
grant execute on function survey_export(text)             to authenticated;
grant execute on function survey_set_voters(text, jsonb)  to authenticated;
-- anon too: the page calls this before anyone signs in, to decide whether to
-- show a login button. Signed out it returns all-false and nothing else.
grant execute on function survey_my_voter_status(text)    to anon, authenticated;
-- turnout is display names plus a boolean, never an address or an answer
grant execute on function survey_turnout(text)            to anon, authenticated;
