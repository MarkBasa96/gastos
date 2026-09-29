-- Gastos 4.0: the "Gastos is updating" switch (Kenshin design review 2026-09-29, C1).
-- Additive only, brief locks only, safe to re-run. Old apps (3.x) keep working: while the switch is off
-- nothing changes for them, and while it is on their writes get GASTOS_UPDATING (HTTP 503), which every
-- version treats as "offline" and retries later, so no entry is ever dropped.
--
-- Flip it with the SQL editor (the Table Editor would read a typed time as UTC):
--   start:  update private.app_status set updating = true, back_at = now() + interval '45 minutes' where id;
--     or:   update private.app_status set updating = true, back_at = '2026-10-01 21:15 Asia/Manila' where id;
--   end:    update private.app_status set updating = false where id;
-- Wait about 60 s after "start" before migrating, so in-flight syncs finish.

set local lock_timeout = '2s';

create table if not exists private.app_status (
  id         boolean primary key default true check (id),    -- exactly one row
  updating   boolean not null default false,
  back_at    timestamptz,
  window_id  uuid not null default gen_random_uuid(),
  started_at timestamptz,
  min_build  int not null default 0                          -- force-reload older 4.x pages (Kenshin M2)
);
insert into private.app_status (id) values (true) on conflict do nothing;
alter table private.app_status enable row level security;
revoke all on private.app_status from public, anon, authenticated;

-- A fresh window id on every off->on flip, back_at cleared when turned off, and the row can't be deleted
-- (a missing row would read as "not updating" and silently open the gate).
create or replace function private.app_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'app_status row is permanent'; end if;
  if new.updating and not old.updating then
    new.window_id := gen_random_uuid();
    new.started_at := now();
  end if;
  if not new.updating then new.back_at := null; end if;
  return new;
end $$;
revoke all on function private.app_status_guard() from public, anon, authenticated;
drop trigger if exists app_status_guard on private.app_status;
create trigger app_status_guard before update or delete on private.app_status
  for each row execute function private.app_status_guard();

-- The only public read. Called with supabase.rpc (a POST, never cached). Returns the server's clock so
-- the phone can compare back_at without trusting its own clock.
create or replace function public.app_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('updating', updating, 'back_at', back_at, 'window_id', window_id,
                               'min_build', min_build, 'now', now())
       from private.app_status where id),
    jsonb_build_object('updating', false, 'now', now()))
$$;
revoke all on function public.app_status() from public;
grant execute on function public.app_status() to anon, authenticated;

-- The gate: refuses app writes while updating. The code is not a 5-character SQLSTATE, so the app keeps
-- the entry queued instead of treating it as bad data (Kenshin B1). Invoker rights on purpose:
-- current_user is the caller's role, so migrations run as postgres pass.
create or replace function public.gastos_write_gate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
     and coalesce((public.app_status()->>'updating')::boolean, false) then
    raise sqlstate 'PGRST' using
      message = '{"code":"GASTOS_UPDATING","message":"Gastos is updating","details":null,"hint":null}',
      detail  = '{"status":503,"headers":{"Retry-After":"60"}}';
  end if;
  return null;   -- statement-level trigger: the return value is ignored
end $$;
revoke all on function public.gastos_write_gate() from public, anon, authenticated;

drop trigger if exists expenses_gate on public.expenses;
create trigger expenses_gate before insert or update on public.expenses
  for each statement execute function public.gastos_write_gate();
drop trigger if exists user_settings_gate on public.user_settings;
create trigger user_settings_gate before insert or update on public.user_settings
  for each statement execute function public.gastos_write_gate();
