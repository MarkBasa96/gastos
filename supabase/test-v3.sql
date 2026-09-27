-- Gastos v3 server tests (Kenshin v3 "Tests to add" 1-8). Everything runs in ONE block that ends by
-- raising an exception carrying the results, so the whole transaction rolls back: the two test users,
-- their PIN rows and feedback rows never persist, and no email is ever sent (pg_net only sends after commit).
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  out text := '';
  r jsonb;
  h1 text; h2 text; i int; ok boolean; n int;
  procedure_ok boolean;

  -- act as a signed-in user (auth.uid() / auth.jwt() read these claims)
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
       values (a, 'test-a-' || a || '@example.invalid', 'authenticated', 'authenticated', now(), now()),
              (b, 'test-b-' || b || '@example.invalid', 'authenticated', 'authenticated', now(), now());

  -- 1. anon: no table, no function
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform 1 from private.account_pin; out := out || 'FAIL 1a anon read account_pin' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 1a anon cannot read account_pin' || E'\n'; end;
  begin
    perform 1 from private.feedback; out := out || 'FAIL 1b anon read feedback' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 1b anon cannot read feedback' || E'\n'; end;
  begin
    perform public.pin_verify('1234'); out := out || 'FAIL 1c anon ran pin_verify' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 1c anon cannot run pin_verify' || E'\n'; end;

  -- as A (signed in with a code 1 minute ago)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now() - interval '1 minute')::bigint)))::text, true);
  begin
    perform 1 from private.account_pin; out := out || 'FAIL 1d authenticated read account_pin' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS 1d signed-in user cannot read account_pin directly' || E'\n'; end;

  r := public.pin_claim('1234');  -- a run: weak
  out := out || case when r->>'result' = 'weak' then 'PASS' else 'FAIL' end || ' L1 weak PIN refused by the server: ' || r || E'\n';
  r := public.pin_claim('4829');
  out := out || case when r->>'result' = 'set' then 'PASS' else 'FAIL' end || ' claim sets: ' || (r - 'epoch') || E'\n';
  r := public.pin_status();
  out := out || case when (r->>'enabled')::boolean and r ? 'epoch' and not (r ? 'pin_hash') then 'PASS' else 'FAIL' end
             || ' status has no hash: ' || (r - 'epoch') || E'\n';

  -- 5. claim when one exists: 'exists', hash untouched
  perform set_config('role', 'postgres', true);
  select pin_hash into h1 from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  r := public.pin_claim('7351');
  perform set_config('role', 'postgres', true);
  select pin_hash into h2 from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when r->>'result' = 'exists' and h1 = h2 then 'PASS' else 'FAIL' end || ' 5 claim never overwrites' || E'\n';

  r := public.pin_verify('4829');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' right PIN ok' || E'\n';

  -- 4. change / disable with a wrong current PIN: counted, nothing changes
  r := public.pin_change('0000', '7351');
  perform set_config('role', 'postgres', true);
  select pin_hash into h2 from private.account_pin where user_id = a;
  select fails into n from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when r->>'result' = 'wrong' and h1 = h2 and n = 1 then 'PASS' else 'FAIL' end || ' 4a change with wrong current counts, changes nothing (fails=' || n || ')' || E'\n';
  r := public.pin_disable('0000');
  perform set_config('role', 'postgres', true);
  select fails into n from private.account_pin where user_id = a;
  select enabled into ok from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when r->>'result' = 'wrong' and ok and n = 2 then 'PASS' else 'FAIL' end || ' 4b disable with wrong current counts, stays on (fails=' || n || ')' || E'\n';

  -- 2. B can't touch A: B has no PIN; B's calls never change A's row
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.pin_verify('4829');
  perform set_config('role', 'postgres', true);
  select fails into n from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when r->>'result' = 'none' and n = 2 then 'PASS' else 'FAIL' end || ' 2 B''s verify only sees B (A fails still ' || n || ')' || E'\n';

  -- 3. wrong tries: exactly 5, then locked, and locked is answered before comparing
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now() - interval '1 minute')::bigint)))::text, true);
  for i in 1..6 loop r := public.pin_verify('0000'); end loop;
  perform set_config('role', 'postgres', true);
  select fails into n from private.account_pin where user_id = a;
  select locked_at is not null into ok from private.account_pin where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when n = 5 and ok and r->>'result' = 'locked' then 'PASS' else 'FAIL' end || ' 3 capped at 5 and locked (fails=' || n || ')' || E'\n';
  r := public.pin_verify('4829');
  out := out || case when r->>'result' = 'locked' then 'PASS' else 'FAIL' end || ' 3b right PIN while locked still says locked' || E'\n';

  -- 6. reset: a code older than the lockout is refused; a code after it works
  r := public.pin_status();
  out := out || case when (r->>'locked')::boolean and not (r->>'can_reset')::boolean then 'PASS' else 'FAIL' end
             || ' 6-0 locked, and a code from before the lock can''t reset: ' || (r - 'epoch') || E'\n';
  r := public.pin_reset_with_code('7351');
  out := out || case when r->>'result' = 'stale_code' then 'PASS' else 'FAIL' end || ' 6a reset with a code from before the lockout is refused' || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now() - interval '20 minutes')::bigint)))::text, true);
  r := public.pin_reset_with_code('7351');
  out := out || case when r->>'result' = 'stale_code' then 'PASS' else 'FAIL' end || ' 6b reset with a 20-minute-old code is refused' || E'\n';
  perform set_config('role', 'postgres', true);
  update private.account_pin set locked_at = now() - interval '1 minute' where user_id = a;  -- lockout 1 min ago
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  r := public.pin_status();
  out := out || case when (r->>'locked')::boolean and (r->>'can_reset')::boolean then 'PASS' else 'FAIL' end
             || ' H-1 locked, but a fresh code says can_reset (the app must not sign it out)' || E'\n';
  r := public.pin_reset_with_code('7351');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' 6c reset with a fresh code after the lockout works' || E'\n';
  -- same-second: a lock stamped mid-second, a code in that same whole second
  perform set_config('role', 'postgres', true);
  update private.account_pin set locked_at = date_trunc('second', now()) + interval '0.7 second', fails = 5 where user_id = a;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from date_trunc('second', now()))::bigint)))::text, true);
  r := public.pin_reset_with_code('7351');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' H-1b a code in the same second as the lock still works' || E'\n';
  r := public.pin_verify('7351');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' 6d the new PIN works, lock cleared' || E'\n';
  r := public.pin_verify('4829');
  out := out || case when r->>'result' = 'wrong' then 'PASS' else 'FAIL' end || ' 6e the old PIN no longer works' || E'\n';

  -- change with the right current PIN: new epoch
  r := public.pin_status();
  h1 := r->>'epoch';
  r := public.pin_change('7351', '5183');
  out := out || case when r->>'result' = 'ok' and r->>'epoch' <> h1 then 'PASS' else 'FAIL' end || ' change makes a new epoch' || E'\n';
  r := public.pin_disable('5183');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' disable with the right PIN' || E'\n';
  r := public.pin_status();
  out := out || case when not (r->>'enabled')::boolean then 'PASS' else 'FAIL' end || ' disabled account-wide' || E'\n';
  r := public.pin_claim('2718');
  out := out || case when r->>'result' = 'set' then 'PASS' else 'FAIL' end || ' claim works again after disable' || E'\n';

  -- offline fails report: only goes up, capped
  r := public.pin_report_offline_fails(3);
  out := out || case when (r->>'tries_left')::int = 2 then 'PASS' else 'FAIL' end || ' offline fails reported (left ' || coalesce(r->>'tries_left', '?') || ')' || E'\n';
  r := public.pin_report_offline_fails(-4);
  r := public.pin_status();
  out := out || case when (r->>'tries_left')::int = 2 then 'PASS' else 'FAIL' end || ' negative report can''t lower the count' || E'\n';

  -- 8. feedback
  r := public.send_feedback('idea', '<script>alert(1)</script> hello', '3.0.0');
  out := out || case when r->>'result' = 'ok' then 'PASS' else 'FAIL' end || ' 8a feedback ok' || E'\n';
  perform set_config('role', 'postgres', true);
  select count(*) into n from private.feedback where user_id = a and body = '<script>alert(1)</script> hello';
  perform set_config('role', 'authenticated', true);
  out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' 8b stored as literal text' || E'\n';
  r := public.send_feedback('idea', '<script>alert(1)</script> hello', '3.0.0');
  perform set_config('role', 'postgres', true);
  select count(*) into n from private.feedback where user_id = a;
  perform set_config('role', 'authenticated', true);
  out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' 8c same text twice = one row' || E'\n';
  r := public.send_feedback('broken', 'two', '3.0.0');
  r := public.send_feedback('other', 'three', '3.0.0');
  r := public.send_feedback('idea', 'four', '3.0.0');
  out := out || case when r->>'result' = 'slow_down' then 'PASS' else 'FAIL' end || ' 8d 4th in an hour: slow_down' || E'\n';
  r := public.send_feedback('evil', 'x', '3.0.0');
  out := out || case when r->>'result' in ('error', 'slow_down') then 'PASS' else 'FAIL' end || ' 8e bad kind refused' || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.send_feedback('evil', 'x', '3.0.0');
  out := out || case when r->>'result' = 'error' then 'PASS' else 'FAIL' end || ' 8f bad kind (fresh user) -> error, nothing stored' || E'\n';

  raise exception 'TEST RESULTS (rolled back):%', E'\n' || out;
end $$;
