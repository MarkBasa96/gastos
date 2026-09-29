-- Gastos v3.1 migration: the colour theme and pinned categories follow the account.
-- Additive only: two columns on the settings row. No new table, so no new RLS surface; the existing
-- "own settings" policies and grants already cover it. Safe to re-run.
-- Apps older than 3.1 never send these columns, so their settings upserts leave them as they are.
-- Run after schema.sql, migration-v2.sql and migration-v3.sql.

begin;

alter table public.user_settings add column if not exists color_theme text not null default 'green';
alter table public.user_settings drop constraint if exists user_settings_color_theme_check;
alter table public.user_settings add constraint user_settings_color_theme_check check (
  color_theme in ('green', 'pink', 'lavender', 'ocean', 'teal', 'coral', 'sunflower', 'latte'));

-- Names she pinned to the top of the Other list. Shape is checked on the phone (each one must be in
-- `categories`); the database enforces type and size, like the other lists (migration-v2).
alter table public.user_settings add column if not exists pinned_categories jsonb not null default '[]'::jsonb;
alter table public.user_settings drop constraint if exists user_settings_pinned_categories_check;
alter table public.user_settings add constraint user_settings_pinned_categories_check check (
  case when jsonb_typeof(pinned_categories) = 'array'
       then jsonb_array_length(pinned_categories) <= 50 and octet_length(pinned_categories::text) <= 4096
       else false end);

-- Re-assert the 09-24 hardening in case anything re-granted it.
revoke truncate, references, trigger, maintain on public.user_settings from authenticated;

commit;

-- The API picks up the new columns without waiting for its schema cache to refresh.
notify pgrst, 'reload schema';

-- Check (rolled back): a signed-in user can set their own theme, a made-up one is refused, and
-- another user can't touch it. Run separately after the migration; it ends with TEST RESULTS.
-- do $$
-- declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); out text := ''; n int;
-- begin
--   insert into auth.users (id, email) values (a, a || '@test.local'), (b, b || '@test.local');
--   perform set_config('role', 'authenticated', true);
--   perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
--   insert into public.user_settings (user_id, currency, color_theme) values (a, 'PHP', 'pink');
--   select count(*) into n from public.user_settings where color_theme = 'pink';
--   out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' own theme saved' || E'\n';
--   begin
--     update public.user_settings set color_theme = 'neon' where user_id = a;
--     out := out || 'FAIL made-up theme accepted' || E'\n';
--   exception when check_violation then
--     out := out || 'PASS made-up theme refused' || E'\n';
--   end;
--   perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
--   update public.user_settings set color_theme = 'ocean' where user_id = a;
--   get diagnostics n = row_count;
--   out := out || case when n = 0 then 'PASS' else 'FAIL' end || ' other user can''t change it' || E'\n';
--   raise exception 'TEST RESULTS (rolled back):%', E'\n' || out;
-- end $$;
