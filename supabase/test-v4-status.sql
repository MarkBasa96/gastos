-- Gastos 4.0 "updating" switch tests (Kenshin review 2026-09-29, points 1-4). Run AFTER migration-v4-status.sql.
-- One block that ends by raising an exception carrying the results, so everything rolls back: the test user,
-- its rows, and every flip of the switch. The switch is left exactly as it was.
do $$
declare
  a uuid := gen_random_uuid();
  out text := '';
  r jsonb;
  w1 uuid; w2 uuid; w3 uuid;
  n int;
  st text;
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
       values (a, 'test-a-' || a || '@example.invalid', 'authenticated', 'authenticated', now(), now());
  update private.app_status set updating = false where id;
  select window_id into w1 from private.app_status where id;

  -- 1. switch off: a signed-in user writes normally (this also proves the revoked trigger function still runs)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.expenses (id, user_id, cents, category, method, date, created_at, currency)
       values ('t-' || a, a, 1500, 'Food', 'cash', current_date, 1, 'PHP');
  insert into public.user_settings (user_id) values (a);
  out := out || 'PASS 1a switch off: signed-in insert works (trigger runs with EXECUTE revoked)' || E'\n';

  -- 2. no direct access to the switch
  begin
    perform 1 from private.app_status; out := out || 'FAIL 2a authenticated read private.app_status' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 2a authenticated cannot read the switch table' || E'\n'; end;
  begin
    update private.app_status set updating = true where id; out := out || 'FAIL 2b authenticated flipped the switch' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 2b authenticated cannot flip the switch' || E'\n'; end;
  r := public.app_status();
  out := out || case when r->>'updating' = 'false' and r ? 'now' and r ? 'window_id' then 'PASS' else 'FAIL' end
             || ' 2c app_status() readable: ' || (r - 'now' - 'window_id') || E'\n';

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform 1 from private.app_status; out := out || 'FAIL 2d anon read private.app_status' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 2d anon cannot read the switch table' || E'\n'; end;
  begin
    update private.app_status set updating = true where id; out := out || 'FAIL 2e anon flipped the switch' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 2e anon cannot flip the switch' || E'\n'; end;
  r := public.app_status();
  out := out || case when r->>'updating' = 'false' then 'PASS' else 'FAIL' end || ' 2f anon can call app_status()' || E'\n';
  begin
    insert into public.app_status values (true); out := out || 'FAIL 2g something called public.app_status is writable' || E'\n';
  exception when others then out := out || 'PASS 2g public.app_status is a function, not a writable table' || E'\n'; end;

  -- 3. switch on (as postgres): fresh window id, gate refuses app writes with PGRST, postgres still writes
  perform set_config('role', 'postgres', true);
  update private.app_status set updating = true, back_at = now() + interval '45 minutes' where id;
  select window_id into w2 from private.app_status where id;
  out := out || case when w2 <> w1 then 'PASS' else 'FAIL' end || ' 3a switching on makes a new window id' || E'\n';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.app_status();
  out := out || case when r->>'updating' = 'true' and (r->>'window_id')::uuid = w2 and r->>'back_at' is not null then 'PASS' else 'FAIL' end
             || ' 3b app_status() reports updating with window id and back_at' || E'\n';
  begin
    insert into public.expenses (id, user_id, cents, category, method, date, created_at, currency)
         values ('t2-' || a, a, 900, 'Food', 'cash', current_date, 2, 'PHP');
    out := out || 'FAIL 3c insert allowed while updating' || E'\n';
  exception when sqlstate 'PGRST' then
    get stacked diagnostics st = message_text;
    out := out || case when st like '%GASTOS_UPDATING%' then 'PASS' else 'FAIL' end || ' 3c insert refused with PGRST / GASTOS_UPDATING' || E'\n';
  end;
  begin
    update public.expenses set note = 'x' where id = 't-' || a;
    out := out || 'FAIL 3d update allowed while updating' || E'\n';
  exception when sqlstate 'PGRST' then out := out || 'PASS 3d update refused with PGRST' || E'\n'; end;
  begin
    insert into public.expenses (id, user_id, cents, category, method, date, created_at, currency)
         values ('t-' || a, a, 1500, 'Food', 'cash', current_date, 1, 'PHP')
    on conflict (id) do update set cents = excluded.cents;
    out := out || 'FAIL 3e upsert allowed while updating' || E'\n';
  exception when sqlstate 'PGRST' then out := out || 'PASS 3e upsert (what the app sends) refused with PGRST' || E'\n'; end;
  begin
    update public.user_settings set currency = 'USD' where user_id = a;
    out := out || 'FAIL 3f settings write allowed while updating' || E'\n';
  exception when sqlstate 'PGRST' then out := out || 'PASS 3f settings write refused with PGRST' || E'\n'; end;
  select count(*) into n from public.expenses where user_id = a;
  out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' 3g reading still works while updating (' || n || ' row)' || E'\n';

  perform set_config('role', 'postgres', true);
  insert into public.expenses (id, user_id, cents, category, method, date, created_at, currency)
       values ('t3-' || a, a, 700, 'Food', 'cash', current_date, 3, 'PHP');
  out := out || 'PASS 3h postgres (a migration) still writes while updating' || E'\n';

  -- 4. off clears back_at; on again gives another new window id; the row can't be deleted
  update private.app_status set updating = false where id;
  select count(*) into n from private.app_status where id and back_at is null;
  out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' 4a switching off clears back_at' || E'\n';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.expenses set note = 'after' where id = 't-' || a;
  out := out || 'PASS 4b switch off again: writes work' || E'\n';
  perform set_config('role', 'postgres', true);
  update private.app_status set updating = true where id;
  select window_id into w3 from private.app_status where id;
  out := out || case when w3 <> w2 and w3 <> w1 then 'PASS' else 'FAIL' end || ' 4c second switch-on gets another new window id' || E'\n';
  begin
    delete from private.app_status; out := out || 'FAIL 4d row deleted' || E'\n';
  exception when others then out := out || 'PASS 4d the switch row cannot be deleted' || E'\n'; end;

  raise exception 'TEST RESULTS (rolled back):%', E'\n' || out;
end $$;
