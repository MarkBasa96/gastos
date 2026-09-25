-- Gastos database. Each person can only ever see and change their own rows.
-- Run once per Supabase project. Safe to re-run.

create table if not exists public.expenses (
  id          text primary key,                      -- made on the phone, so offline saves need no server
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cents       bigint not null check (cents > 0 and cents < 10000000000),  -- bigint: integer tops out at 21.4M pesos
  category    text not null check (char_length(category) between 1 and 40),
  note        text not null default '' check (char_length(note) <= 200),
  method      text not null check (method in ('cash', 'card')),
  date        date not null,
  created_at  bigint not null,                       -- phone clock, ms; only used for ordering
  deleted     boolean not null default false,        -- soft delete so other devices learn about it
  updated_at  timestamptz not null default now()     -- server clock; the sync cursor
);

create index if not exists expenses_user_updated on public.expenses (user_id, updated_at);

create table if not exists public.user_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  currency    text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  updated_at  timestamptz not null default now()
);

-- updated_at always comes from the server, never the phone.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before insert or update on public.expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before insert or update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Row Level Security: the actual privacy wall.
alter table public.expenses enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own expenses: read" on public.expenses;
drop policy if exists "own expenses: add" on public.expenses;
drop policy if exists "own expenses: change" on public.expenses;
create policy "own expenses: read" on public.expenses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own expenses: add" on public.expenses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own expenses: change" on public.expenses
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No delete policy on purpose: deletes are soft (deleted = true) so they sync.

drop policy if exists "own settings: read" on public.user_settings;
drop policy if exists "own settings: add" on public.user_settings;
drop policy if exists "own settings: change" on public.user_settings;
create policy "own settings: read" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own settings: add" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own settings: change" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Signed-out visitors get nothing at all.
revoke all on public.expenses, public.user_settings from anon;
grant select, insert, update on public.expenses, public.user_settings to authenticated;

-- Hardening from Kenshin's audit 2026-09-24.
-- L1: Supabase's defaults give signed-in users TRUNCATE, which ignores RLS. Take it (and friends) away.
revoke truncate, references, trigger, maintain on public.expenses, public.user_settings from authenticated;
-- L5: ids are made on the phone; keep them boring.
alter table public.expenses drop constraint if exists expenses_id_format;
alter table public.expenses add constraint expenses_id_format check (id ~ '^[A-Za-z0-9_-]{1,40}$');
-- cents was created as integer (max 2,147,483,647 = 21.4M); widen it so the check above is the real limit.
alter table public.expenses alter column cents type bigint;
