-- Gastos v3 migration: account-wide MPIN + feedback. Built to Kenshin's v3 design review
-- (02-process/kenshin-v3-design-review-2026-09-27.md). Additive only: nothing v2 uses changes.
-- Run as one script. Safe to re-run (create or replace / if not exists).

-- ---------------------------------------------------------------------------------------------
-- 0. Schema the API never exposes (H1). No grants to anyone but the owner.
-- ---------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pg_net with schema extensions;  -- feedback email is queued, sent after commit (Kenshin 3.1)

-- The pepper: 32 random bytes in Vault, created once, never printed, never in the repo (M2).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gastos_pin_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'gastos_pin_pepper');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Account MPIN (Kenshin 1.1): RLS on, no policies, no grants. Only the functions below touch it.
-- ---------------------------------------------------------------------------------------------
create table if not exists private.account_pin (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  enabled    boolean not null default true,
  pin_hash   text,
  epoch      uuid not null default gen_random_uuid(),   -- new random value on every set/change/disable/reset (1.4)
  fails      int  not null default 0 check (fails between 0 and 5),
  locked_at  timestamptz,
  updated_at timestamptz not null default now(),
  check (enabled = (pin_hash is not null))
);
alter table private.account_pin enable row level security;
revoke all on private.account_pin from public, anon, authenticated;

-- HMAC with the Vault pepper, keyed per user, then bcrypt over that (M2).
create or replace function private.pin_mac(p_uid uuid, p_pin text) returns text
language sql stable set search_path = '' as $$
  select encode(extensions.hmac(p_uid::text || ':' || p_pin,
           (select decrypted_secret from vault.decrypted_secrets where name = 'gastos_pin_pepper'),
           'sha256'), 'hex')
$$;

-- Same rule as the app's weakPin: 4 digits, not all the same, not a run, not a most-guessed PIN (L1).
create or replace function private.pin_weak(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d int[]; up boolean := true; down boolean := true; i int;
begin
  if p is null or p !~ '^[0-9]{4}$' then return true; end if;
  if p ~ '^(\d)\1{3}$' then return true; end if;
  d := array[substr(p,1,1)::int, substr(p,2,1)::int, substr(p,3,1)::int, substr(p,4,1)::int];
  for i in 2..4 loop
    if d[i] <> (d[i-1] + 1) % 10 then up := false; end if;
    if d[i] <> (d[i-1] + 9) % 10 then down := false; end if;
  end loop;
  return up or down or p = any (array['1212','6969','2580','1004','2000','1122','5683','0852','1010','2020','4545']);
end $$;

create or replace function private.pin_hash(p_uid uuid, p_pin text) returns text
language sql volatile set search_path = '' as $$
  select extensions.crypt(private.pin_mac(p_uid, p_pin), extensions.gen_salt('bf', 8))
$$;

-- The ONE place a PIN is checked and counted (M1). Caller must hold the row lock.
-- Never raises for a wrong PIN: an error would roll the count back.
create or replace function private.pin_check(p_uid uuid, p_pin text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare r private.account_pin; ok boolean;
begin
  select * into r from private.account_pin where user_id = p_uid for update;
  if not found or not r.enabled then
    return jsonb_build_object('result', 'none', 'epoch', r.epoch);
  end if;
  if r.locked_at is not null then return jsonb_build_object('result', 'locked'); end if;  -- before comparing
  ok := coalesce(p_pin, '') ~ '^[0-9]{4}$'
        and extensions.crypt(private.pin_mac(p_uid, p_pin), r.pin_hash) = r.pin_hash;
  if ok then
    update private.account_pin set fails = 0 where user_id = p_uid;
    return jsonb_build_object('result', 'ok', 'epoch', r.epoch);
  end if;
  update private.account_pin
     set fails = least(fails + 1, 5),
         locked_at = case when fails + 1 >= 5 then now() end
   where user_id = p_uid
   returning * into r;
  return jsonb_build_object('result', case when r.locked_at is null then 'wrong' else 'locked' end,
                            'tries_left', 5 - r.fails);
end $$;

-- When this session signed in with an email code (whole seconds), from the token. A refresh keeps it.
create or replace function private.otp_at() returns timestamptz
language sql stable set search_path = '' as $$
  select to_timestamp(max((a->>'timestamp')::bigint))
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
   where a->>'method' = 'otp'
$$;

-- A fresh code (last 10 minutes, and not older than the lockout) may set a new MPIN (H2, audit H-1).
create or replace function private.can_reset(p_locked_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.otp_at() >= now() - interval '10 minutes'
                  and (p_locked_at is null or private.otp_at() >= date_trunc('second', p_locked_at)), false)
$$;

revoke all on function private.pin_mac(uuid, text), private.pin_weak(text), private.pin_hash(uuid, text),
  private.pin_check(uuid, text), private.otp_at(), private.can_reset(timestamptz) from public, anon, authenticated;

-- ---- The RPCs: public, security definer, volatile, auth.uid() only, never a user id, never the hash.

create or replace function public.pin_status() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  select * into r from private.account_pin where user_id = uid;
  if not found then
    return jsonb_build_object('enabled', false, 'epoch', null, 'locked', false, 'tries_left', 5, 'can_reset', private.can_reset(null));
  end if;
  -- can_reset: this session's email code may set a new MPIN, so the app must NOT sign it out for
  -- being locked (audit H-1: the code has to be able to get her back in).
  return jsonb_build_object('enabled', r.enabled, 'epoch', r.epoch, 'locked', r.locked_at is not null,
                            'tries_left', 5 - r.fails, 'can_reset', private.can_reset(r.locked_at));
end $$;

create or replace function public.pin_verify(p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return '{"result":"error"}'; end if;
  return private.pin_check(uid, p_pin);
end $$;

-- Insert only (M4): succeeds only when the account has no enabled PIN. Never overwrites.
create or replace function public.pin_claim(p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  if private.pin_weak(p_pin) then return '{"result":"weak"}'; end if;
  insert into private.account_pin (user_id, enabled, pin_hash)
       values (uid, true, private.pin_hash(uid, p_pin))
  on conflict (user_id) do update
       set enabled = true, pin_hash = excluded.pin_hash, epoch = gen_random_uuid(),
           fails = 0, locked_at = null, updated_at = now()
     where private.account_pin.enabled = false
  returning * into r;
  if not found then return '{"result":"exists"}'; end if;
  return jsonb_build_object('result', 'set', 'epoch', r.epoch);
end $$;

-- Current MPIN in the SAME call, and it counts toward the 5 (H2).
create or replace function public.pin_change(p_old text, p_new text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c jsonb; r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  if private.pin_weak(p_new) then return '{"result":"weak"}'; end if;
  c := private.pin_check(uid, p_old);
  if c->>'result' <> 'ok' then return c; end if;
  update private.account_pin
     set pin_hash = private.pin_hash(uid, p_new), epoch = gen_random_uuid(), fails = 0, updated_at = now()
   where user_id = uid returning * into r;
  return jsonb_build_object('result', 'ok', 'epoch', r.epoch);
end $$;

-- Current MPIN in the same call; turns it off on every phone (new epoch). The row stays.
create or replace function public.pin_disable(p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c jsonb; r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  c := private.pin_check(uid, p_pin);
  if c->>'result' <> 'ok' then return c; end if;
  update private.account_pin
     set enabled = false, pin_hash = null, epoch = gen_random_uuid(), fails = 0, updated_at = now()
   where user_id = uid returning * into r;
  return jsonb_build_object('result', 'ok', 'epoch', r.epoch);
end $$;

-- Forgot MPIN: only with a session that came from an email code in the last 10 minutes, and after
-- the lockout if there is one. Sets a NEW PIN; never turns it off (H2). Token claim: amr[].timestamp.
create or replace function public.pin_reset_with_code(p_new text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  if private.pin_weak(p_new) then return '{"result":"weak"}'; end if;
  select * into r from private.account_pin where user_id = uid for update;
  if not private.can_reset(case when found then r.locked_at end) then return '{"result":"stale_code"}'; end if;
  insert into private.account_pin (user_id, enabled, pin_hash)
       values (uid, true, private.pin_hash(uid, p_new))
  on conflict (user_id) do update
       set enabled = true, pin_hash = excluded.pin_hash, epoch = gen_random_uuid(),
           fails = 0, locked_at = null, updated_at = now()
  returning * into r;
  return jsonb_build_object('result', 'ok', 'epoch', r.epoch);
end $$;

-- Offline wrong tries, reported on the next sync. Can only go up (1.4 rule 5).
create or replace function public.pin_report_offline_fails(p_n int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r private.account_pin;
begin
  if uid is null then return '{"result":"error"}'; end if;
  if p_n is null or p_n < 1 then return '{"result":"ok"}'; end if;
  update private.account_pin
     set fails = least(fails + least(p_n, 5), 5),
         locked_at = coalesce(locked_at, case when fails + least(p_n, 5) >= 5 then now() end)
   where user_id = uid and enabled
  returning * into r;
  if not found then return '{"result":"ok"}'; end if;
  return jsonb_build_object('result', case when r.locked_at is null then 'ok' else 'locked' end, 'tries_left', 5 - r.fails);
end $$;

-- Supabase grants EXECUTE to anon by default: take it away, give it to signed-in users only.
revoke all on function public.pin_status(), public.pin_verify(text), public.pin_claim(text),
  public.pin_change(text, text), public.pin_disable(text), public.pin_reset_with_code(text),
  public.pin_report_offline_fails(int) from public, anon;
grant execute on function public.pin_status(), public.pin_verify(text), public.pin_claim(text),
  public.pin_change(text, text), public.pin_disable(text), public.pin_reset_with_code(text),
  public.pin_report_offline_fails(int) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Feedback (Kenshin Part 3): stored in private, emailed to Joe through Brevo's API from Vault.
-- ---------------------------------------------------------------------------------------------
create table if not exists private.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('broken', 'idea', 'other')),
  body        text not null check (char_length(body) between 1 and 2000
                                   and body !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
                                   and body !~ '[‪-‮⁦-⁩]'),
  app_version text not null default '' check (char_length(app_version) <= 20 and app_version ~ '^[0-9A-Za-z.+-]*$'),
  emailed     boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table private.feedback enable row level security;
revoke all on private.feedback from public, anon, authenticated;
create index if not exists feedback_user_time on private.feedback (user_id, created_at);
create index if not exists feedback_time on private.feedback (created_at);

create or replace function public.send_feedback(p_kind text, p_body text, p_app_version text default '')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_email text; n_hour int; n_day int; n_global int; k text; body_ text; mail boolean;
begin
  if uid is null then return '{"result":"error"}'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));          -- parallel calls can't all pass the limit
  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into n_hour, n_day from private.feedback where user_id = uid and created_at > now() - interval '1 day';
  if n_hour >= 3 or n_day >= 10 then return '{"result":"slow_down"}'; end if;
  body_ := btrim(coalesce(p_body, ''));
  -- same text again within 10 minutes: a double send, not new feedback
  if exists (select 1 from private.feedback where user_id = uid and body = body_ and created_at > now() - interval '10 minutes') then
    return '{"result":"ok"}';
  end if;
  perform pg_advisory_xact_lock(hashtext('gastos_feedback_global'));  -- the 20/day email cap holds across accounts (audit L-6)
  select count(*) into n_global from private.feedback where emailed and created_at > now() - interval '1 day';
  select decrypted_secret into k from vault.decrypted_secrets where name = 'gastos_brevo_feedback_key';
  mail := n_global < 20 and k is not null;                        -- sign-in codes share the Brevo quota (M7)
  insert into private.feedback (user_id, kind, body, app_version, emailed)
       values (uid, p_kind, body_, coalesce(p_app_version, ''), mail);   -- the constraints validate
  if mail then
    select email into v_email from auth.users where id = uid;          -- server-side, never from the client
    perform net.http_post(
      url     := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', k, 'content-type', 'application/json', 'accept', 'application/json'),
      body    := jsonb_build_object(
        'sender',      jsonb_build_object('name', 'Gastos', 'email', 'you@example.com'),
        'to',          jsonb_build_array(jsonb_build_object('email', 'you@example.com')),
        'replyTo',     jsonb_build_object('email', v_email),
        'subject',     'Gastos feedback: ' || p_kind,
        'textContent', 'From: ' || v_email || E'\nKind: ' || p_kind || E'\nApp: ' || coalesce(p_app_version, '')
                       || E'\n\n' || body_));
  end if;
  return '{"result":"ok"}';
exception when check_violation then
  return '{"result":"error"}';
end $$;
revoke all on function public.send_feedback(text, text, text) from public, anon;
grant execute on function public.send_feedback(text, text, text) to authenticated;
