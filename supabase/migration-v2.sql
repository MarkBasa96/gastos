-- Gastos v2 migration (Kenshin review 2026-09-26). Additive. Safe to re-run.
begin;

-- 1. Income vs expense. Old app versions omit it and get 'expense'.
alter table public.expenses add column if not exists kind text not null default 'expense';
alter table public.expenses drop constraint if exists expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('expense', 'income'));

-- 2. "Paid with" label. '' = show the label for method (old rows, old app).
--    Names only: at most 4 digits (allows "BPI 1234", blocks card/account/mobile numbers),
--    no control characters, no bidi overrides.
alter table public.expenses add column if not exists paid_with text not null default '';
alter table public.expenses drop constraint if exists expenses_paid_with_check;
alter table public.expenses add constraint expenses_paid_with_check check (
  char_length(paid_with) <= 40
  and paid_with !~ '[[:cntrl:]]'
  and paid_with !~ '[‪-‮⁦-⁩]'
  and char_length(regexp_replace(paid_with, '[^0-9]', '', 'g')) <= 4
);
-- method and its ('cash','card') check stay exactly as they are.

-- 3. Original entry currency.
alter table public.expenses add column if not exists currency text;
update public.expenses e
   set currency = coalesce((select s.currency from public.user_settings s where s.user_id = e.user_id), 'PHP')
 where e.currency is null;   -- bumps updated_at, so every device re-pulls once and learns the value

create or replace function public.fill_expense_currency() returns trigger
language plpgsql set search_path = '' as $$   -- SECURITY INVOKER on purpose: reads settings under the caller's RLS
begin
  if new.currency is null then
    select s.currency into new.currency from public.user_settings s where s.user_id = new.user_id;
    new.currency := coalesce(new.currency, 'PHP');
  end if;
  return new;
end $$;
drop trigger if exists expenses_fill_currency on public.expenses;
create trigger expenses_fill_currency before insert on public.expenses
  for each row execute function public.fill_expense_currency();

alter table public.expenses alter column currency set not null;   -- NOT NULL is checked after BEFORE triggers
alter table public.expenses drop constraint if exists expenses_currency_check;
alter table public.expenses add constraint expenses_currency_check check (currency ~ '^[A-Z]{3}$');

-- 4. Per-user lists on the settings row (no new table = no new RLS surface).
--    Shape is validated on the phone; the database enforces type and size.
alter table public.user_settings add column if not exists categories     jsonb not null default '[]'::jsonb;
alter table public.user_settings add column if not exists payment_labels jsonb not null default '[]'::jsonb;
alter table public.user_settings drop constraint if exists user_settings_categories_check;
alter table public.user_settings add constraint user_settings_categories_check check (
  case when jsonb_typeof(categories) = 'array'
       then jsonb_array_length(categories) <= 50 and octet_length(categories::text) <= 4096
       else false end);
alter table public.user_settings drop constraint if exists user_settings_payment_labels_check;
alter table public.user_settings add constraint user_settings_payment_labels_check check (
  case when jsonb_typeof(payment_labels) = 'array'
       then jsonb_array_length(payment_labels) <= 50 and octet_length(payment_labels::text) <= 8192
       else false end);

-- RLS policies and grants: unchanged on purpose. Re-assert the 09-24 hardening in case anything re-granted it.
revoke truncate, references, trigger, maintain on public.expenses, public.user_settings from authenticated;

commit;
