-- Auth-based admin row CRUD for home content.
--
-- Problem this fixes: the app's link/photo/message/livestream editing went
-- through admin_upsert_row / admin_delete_row, which require the legacy
-- master-password token. The main app no longer sets that token (admin is now
-- a Supabase auth role), so every one of those writes failed with "not admin"
-- and edits/deletes silently did not persist.
--
-- These two functions mirror admin_save_config_auth: they check the caller's
-- session role with has_admin_or_commish() and operate on a fixed allowlist of
-- home-content tables. The client (adminUpsertRow / adminDeleteRow in
-- src/supabase.js) calls these first when a session exists.
--
-- Run once in the Supabase SQL editor.

create or replace function public.admin_upsert_row_auth(p_table text, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols    text;
  v_updates text;
begin
  -- Admins/commissioners can write any allowed table. The media allowlist can
  -- write only the livestream_urls table (for /live stream editing).
  if not (
    has_admin_or_commish()
    or (p_table = 'livestream_urls'
        and lower(coalesce(auth.email(), '')) = any (array['johnameen@gmail.com']))
  ) then
    raise exception 'not authorized';
  end if;
  if p_table not in (
    'commissioner_messages', 'sticky_links', 'quick_links',
    'livestream_urls', 'photo_cards', 'player_photos'
  ) then
    raise exception 'table not allowed: %', p_table;
  end if;

  -- Only touch columns that exist on the table and are present in the payload.
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and column_name in (select jsonb_object_keys(p_row));

  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into v_updates
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and column_name in (select jsonb_object_keys(p_row))
      and column_name <> 'id';

  if v_updates is null then
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
         on conflict (id) do nothing',
      p_table, v_cols, v_cols, p_table
    ) using p_row;
  else
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
         on conflict (id) do update set %s',
      p_table, v_cols, v_cols, p_table, v_updates
    ) using p_row;
  end if;
end;
$$;

create or replace function public.admin_delete_row_auth(p_table text, p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins/commissioners can write any allowed table. The media allowlist can
  -- write only the livestream_urls table (for /live stream editing).
  if not (
    has_admin_or_commish()
    or (p_table = 'livestream_urls'
        and lower(coalesce(auth.email(), '')) = any (array['johnameen@gmail.com']))
  ) then
    raise exception 'not authorized';
  end if;
  if p_table not in (
    'commissioner_messages', 'sticky_links', 'quick_links',
    'livestream_urls', 'photo_cards', 'player_photos'
  ) then
    raise exception 'table not allowed: %', p_table;
  end if;
  execute format('delete from public.%I where id::text = $1', p_table) using p_id;
end;
$$;

grant execute on function public.admin_upsert_row_auth(text, jsonb) to authenticated;
grant execute on function public.admin_delete_row_auth(text, text) to authenticated;
