-- STEP 2 OF 2. Run this one LAST.
--
-- DO NOT RUN THIS UNTIL BOTH ARE TRUE:
--   1. Step 1 (registrations_pii_01_get_roster_meta.sql) has been run.
--   2. The client change is DEPLOYED to production, not just committed:
--        - App.jsx:18109      selects dob and zip. Must use get_roster_meta().
--        - LiveSection.jsx:1818  does select("*"). Must be narrowed to
--                                first_name, last_name, team_pref.
--
-- Run it early and the deployed bundle starts getting "permission denied for
-- column dob" on Teams Hub, which silently drops age, city and the CA badge
-- from every player card, and "permission denied" on the scorekeeper login
-- lookup.
--
-- These three reads are already safe and need no change:
--   App.jsx:2142          first_name, last_name
--   App.jsx:19650         first_name, last_name, team_pref, dates
--   LiveSection.jsx:762   first_name, last_name, team_pref
--
-- What this fixes: registrations is readable in full by the anon role. All 81
-- rows and all 35 columns, including pin_hash, address, dob, phone,
-- emergency_contact and emergency_phone. The anon key is hardcoded in
-- src/supabase.js and ships in the pcaleague.com bundle, so this is public to
-- anyone who opens devtools. Confirmed still live on 2026-08-06.
--
-- Only privileges change here. No data is touched.

begin;

revoke select on public.registrations from anon;

-- Everything except pin_hash, address, dob, phone, emergency_contact and
-- emergency_phone. email stays for now because three client call sites look a
-- registration up by it; remove it once those move to an RPC.
grant select (
  id, created_at, updated_at,
  first_name, last_name, email, gender,
  team_pref, dates, linked_player,
  city, zip,
  roles, tshirt_size, jersey_number_last_year,
  headshot_url, reg_quote,
  display_name_override, announcement_override, announcement_hidden,
  announce_registration, eligibility, community_team, reg_basis,
  buyout_volunteer, conflicts_note, admin_override,
  email_verified, last_edited_by_player_at
) on public.registrations to anon;

commit;

-- ------------------------------------------------------------ verification
--
-- Should return zero rows:
--
--   select column_name from information_schema.column_privileges
--    where table_name = 'registrations' and grantee = 'anon'
--      and column_name in ('pin_hash','address','dob','phone',
--                          'emergency_contact','emergency_phone');
--
-- And from the browser console on pcaleague.com:
--
--   await supabase.from('registrations').select('dob').limit(1)
--     -> permission denied for column dob
--   await supabase.rpc('get_roster_meta')
--     -> rows with age, no dob
--
-- Still open after this script:
--   - email is readable by anon. Fix by moving App.jsx:2142,
--     App.jsx:19650, LiveSection.jsx:762 and LiveSection.jsx:1818 to a
--     security definer lookup RPC, then dropping email from the grant above.
--   - pin_hash is no longer public, but the email-plus-PIN scheme it backs is
--     still weaker than the Supabase auth the rest of the app uses.
