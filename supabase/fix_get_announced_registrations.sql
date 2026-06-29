-- Security fix: get_announced_registrations returned `select r.*` (RETURNS SETOF
-- registrations) to the public anon role. That leaked pin_hash, email, phone,
-- address, dob, and emergency contacts to anyone with the (client-bundled) anon key.
--
-- This replaces the whole-row return with an explicit list of only the columns the
-- public announcement feed renders. The filters match the original definition exactly.
--
-- Wrapped in a transaction: if the CREATE fails (e.g. a column type does not match),
-- the whole thing rolls back and the existing function stays untouched. No data is
-- modified by this script.

begin;

drop function if exists public.get_announced_registrations();

create function public.get_announced_registrations()
returns table (
  id uuid,
  created_at timestamptz,
  first_name text,
  last_name text,
  gender text,
  dob text,
  team_pref text,
  headshot_url text,
  reg_quote text,
  display_name_override text,
  announcement_override text,
  announcement_hidden boolean
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    r.id,
    r.created_at,
    r.first_name,
    r.last_name,
    r.gender,
    r.dob,
    r.team_pref,
    r.headshot_url,
    r.reg_quote,
    r.display_name_override,
    r.announcement_override,
    r.announcement_hidden
  from registrations r
  where coalesce(r.announce_registration, false) = true
    and coalesce(r.announcement_hidden, false) = false
  order by r.created_at desc;
$function$;

grant execute on function public.get_announced_registrations() to anon, authenticated;

commit;
