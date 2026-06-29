-- Security fix: verify_registration_pin was a live brute-force oracle and re-leaked
-- pin_hash. The registration edit window is already closed (update_own_registration
-- has a hard lockout at 2026-05-12 06:59 UTC), so this mirrors that lock into the
-- lookup function and strips pin_hash from any row it returns.
--
--   - Past the lockout: returns null, so the function can no longer be used to guess
--     PINs (no hit/miss signal) or to read registration rows.
--   - Before the lockout (e.g. when registration reopens next cycle): behaves as
--     before but never returns the pin_hash column. Add real rate-limiting at that
--     point, since online guessing only matters while the window is open.
--
-- Same signature and return type as the original, so CREATE OR REPLACE is enough
-- (no drop). Wrapped in a transaction; no data is modified.

begin;

create or replace function public.verify_registration_pin(p_email text, p_pin text)
returns registrations
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  r registrations;
  lockout timestamptz := '2026-05-12 06:59:00+00'::timestamptz;
begin
  if now() > lockout then
    return null;            -- edit window closed: no lookups, kills the oracle
  end if;

  select * into r from registrations
  where lower(email) = lower(p_email)
    and pin_hash is not null
    and pin_hash = crypt(p_pin, pin_hash)
  limit 1;

  r.pin_hash := null;        -- never hand the hash back to the client
  return r;
end;
$function$;

commit;
