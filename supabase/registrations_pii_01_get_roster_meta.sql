-- STEP 1 OF 2. Run this one FIRST. Safe to run right now.
--
-- Purely additive: it creates one function and grants execute on it. Nothing
-- is revoked, nothing is modified, no existing behaviour changes. Running it
-- and then stopping leaves the site exactly as it is today.
--
-- Split out of the original lock_registrations_pii.sql so there is no window
-- where the database has been tightened but the deployed bundle has not caught
-- up. Order is: this file, then deploy the client change, then step 2.
--
-- Why it exists: App.jsx built dobMap / cityMap / caMap by pulling raw dob and
-- zip to the browser, then reducing them to an age and a "lives in CA"
-- boolean. Do that reduction on the server so the raw values never leave it.
--
-- Age parsing mirrors ageFromDob() in App.jsx exactly: MM/DD/YYYY only, null
-- for anything else. Four of the 81 rows are malformed and already produced
-- null in the client, so behaviour is unchanged. to_date is used rather than
-- make_date because it is lenient with impossible dates instead of raising.

begin;

create or replace function public.get_roster_meta()
returns table (
  linked_player text,
  first_name    text,
  last_name     text,
  age           int,
  city          text,
  ca_zip        boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    r.linked_player,
    r.first_name,
    r.last_name,
    case
      when r.dob ~ '^\d{1,2}/\d{1,2}/\d{4}$'
        then extract(year from age(to_date(r.dob, 'MM/DD/YYYY')))::int
      else null
    end,
    r.city,
    case
      when btrim(coalesce(r.zip, '')) ~ '^\d{5}'
        then substring(btrim(r.zip) from 1 for 5)::int between 90000 and 96199
      else null
    end
  from public.registrations r;
$function$;

revoke all on function public.get_roster_meta() from public;
grant execute on function public.get_roster_meta() to anon, authenticated;

commit;

-- Check it worked. Should return rows with an age and no dob:
--
--   select * from get_roster_meta() limit 5;
--
-- Then deploy the client change before running step 2.
