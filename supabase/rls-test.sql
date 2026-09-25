-- Proves each user can only reach their own rows. Cleans up after itself.
create temp table rls_results (check_name text, expected text, actual text, pass boolean);

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  n int;
  err text;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'rls-test-a@gastos.invalid', 'authenticated', 'authenticated'),
    (b, 'rls-test-b@gastos.invalid', 'authenticated', 'authenticated');

  -- Act as A: add one expense and settings.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.expenses (id, user_id, cents, category, note, method, date, created_at)
    values ('rls-a-1', a, 15000, 'Food', 'A lunch', 'cash', current_date, 1);
  insert into public.user_settings (user_id, currency) values (a, 'PHP');
  select count(*) into n from public.expenses;
  execute 'reset role';
  insert into rls_results values ('A sees own expense', '1', n::text, n = 1);

  -- Act as B.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.expenses;
  execute 'reset role';
  insert into rls_results values ('B cannot see A''s expenses', '0', n::text, n = 0);

  execute 'set local role authenticated';
  select count(*) into n from public.user_settings;
  execute 'reset role';
  insert into rls_results values ('B cannot see A''s settings', '0', n::text, n = 0);

  execute 'set local role authenticated';
  update public.expenses set cents = 1, deleted = true where id = 'rls-a-1';
  get diagnostics n = row_count;
  execute 'reset role';
  insert into rls_results values ('B cannot change A''s expense', '0 rows', n || ' rows', n = 0);

  err := 'none';
  begin
    execute 'set local role authenticated';
    insert into public.expenses (id, user_id, cents, category, method, date, created_at)
      values ('rls-b-forged', a, 999, 'Food', 'cash', current_date, 1);
    execute 'reset role';
  exception when others then
    err := sqlstate; execute 'reset role';
  end;
  insert into rls_results values ('B cannot write a row as A', 'error 42501', 'error ' || err, err = '42501');

  err := 'none';
  begin
    execute 'set local role authenticated';
    insert into public.expenses (id, cents, category, method, date, created_at)
      values ('rls-a-1', 5, 'Food', 'cash', current_date, 1)
      on conflict (id) do update set cents = excluded.cents;
    execute 'reset role';
  exception when others then
    err := sqlstate; execute 'reset role';
  end;
  select cents into n from public.expenses where id = 'rls-a-1';
  insert into rls_results values ('B cannot overwrite A''s expense via upsert', '15000 kept', n || ' kept', n = 15000);

  -- Positive controls (Kenshin): the owner CAN change their own rows, so "B changed 0" means something.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.expenses set note = 'edited by A' where id = 'rls-a-1';
  get diagnostics n = row_count;
  execute 'reset role';
  insert into rls_results values ('A can edit own expense', '1 row', n || ' rows', n = 1);

  err := 'none';
  begin
    execute 'set local role authenticated';
    insert into public.expenses (id, user_id, cents, category, method, date, created_at)
      values ('rls-a-big', a, 9999999999, 'Bills', 'card', current_date, 1);
    execute 'reset role';
  exception when others then err := sqlstate; execute 'reset role';
  end;
  insert into rls_results values ('Max amount 99,999,999.99 accepted', 'none', err, err = 'none');

  execute 'set local role authenticated';
  update public.user_settings set currency = 'USD' where user_id = a;
  get diagnostics n = row_count;
  execute 'reset role';
  insert into rls_results values ('A can change own settings', '1 row', n || ' rows', n = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.user_settings set currency = 'EUR' where user_id = a;
  get diagnostics n = row_count;
  execute 'reset role';
  insert into rls_results values ('B cannot change A''s settings', '0 rows', n || ' rows', n = 0);

  insert into rls_results values ('Signed-in users cannot TRUNCATE', 'false',
    has_table_privilege('authenticated', 'public.expenses', 'truncate')::text,
    not has_table_privilege('authenticated', 'public.expenses', 'truncate')
      and not has_table_privilege('authenticated', 'public.user_settings', 'truncate'));
  insert into rls_results values ('Signed-in users cannot DELETE', 'false',
    has_table_privilege('authenticated', 'public.expenses', 'delete')::text,
    not has_table_privilege('authenticated', 'public.expenses', 'delete'));

  -- Signed-out visitor.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  err := 'none';
  begin
    execute 'set local role anon';
    select count(*) into n from public.expenses;
    execute 'reset role';
  exception when others then
    err := sqlstate; execute 'reset role';
  end;
  insert into rls_results values ('Signed-out visitor is refused', 'error 42501', 'error ' || err, err = '42501');

  -- Server stamps updated_at, not the phone.
  select count(*) into n from public.expenses where id = 'rls-a-1' and updated_at > now() - interval '1 minute';
  insert into rls_results values ('updated_at set by server', '1', n::text, n = 1);

  delete from auth.users where id in (a, b);  -- cascades to their rows
  select count(*) into n from public.expenses where id like 'rls-%';
  insert into rls_results values ('Test data cleaned up', '0', n::text, n = 0);
end $$;

select * from rls_results;
