// Run: node --experimental-strip-types src/syncCore.test.mjs   (Node 22)
import assert from 'node:assert/strict';
import { OfflineError, isDataError, pushWithFallback } from './syncCore.ts';

const rows = (ids) => ids.map((id) => ({ id }));
// Fake server: refuses any statement that contains a "bad" row (like one Postgres statement would).
const server = (bad, calls = []) => async (batch) => {
  calls.push(batch.length);
  return batch.some((r) => bad.includes(r.id)) ? { code: '23514', message: 'check violation' } : null;
};

let r = await pushWithFallback(rows(['a', 'b', 'c']), server([]));
assert.deepEqual(r, { sent: ['a', 'b', 'c'], rejected: [] });

// One bad row no longer blocks the rest.
const calls = [];
r = await pushWithFallback(rows(['a', 'bad', 'c']), server(['bad'], calls));
assert.deepEqual(r, { sent: ['a', 'c'], rejected: ['bad'] });
assert.deepEqual(calls, [3, 1, 1, 1], 'one batch try, then row by row');

// Batches: only the batch containing the bad row falls back.
const calls2 = [];
r = await pushWithFallback(rows(['a', 'b', 'bad', 'd']), server(['bad'], calls2), 2);
assert.deepEqual(r, { sent: ['a', 'b', 'd'], rejected: ['bad'] });
assert.deepEqual(calls2, [2, 2, 1, 1]);

// Network failure is "offline", not "rejected", and nothing is marked sent.
await assert.rejects(
  pushWithFallback(rows(['a']), async () => ({ message: 'TypeError: Failed to fetch' })),
  OfflineError,
);
assert.equal(isDataError({ code: '42501' }), true);
assert.equal(isDataError({ code: '', message: 'Failed to fetch' }), false);
assert.equal(isDataError(null), false);

// Permanent: bad data, broken rules, someone else's row.
for (const code of ['22P02', '22001', '23514', '23505', '23503', '23502', '42501']) {
  assert.equal(isDataError({ code }), true, code + ' should be permanent');
}
// Temporary (Kenshin B2): a busy or changing database must never drop a row from the queue.
for (const code of ['57014', '55P03', '40P01', '40001', '53300', '42703', '42P01', 'P0001', 'PGRST204', 'PGRST', 'XX000']) {
  assert.equal(isDataError({ code }), false, code + ' should be temporary');
}

// A timeout while uploading keeps every row queued: nothing sent, nothing rejected, OfflineError thrown.
const timeoutCalls = [];
await assert.rejects(
  pushWithFallback(rows(['a', 'b']), async (batch) => {
    timeoutCalls.push(batch.length);
    return { code: '57014', message: 'canceling statement due to statement timeout' };
  }),
  OfflineError,
);
assert.deepEqual(timeoutCalls, [2], 'no row-by-row fallback for a temporary error');

// A lock wait in the middle of the row-by-row fallback also stops without rejecting anything.
let n = 0;
await assert.rejects(
  pushWithFallback(rows(['a', 'bad', 'c']), async () => {
    n++;
    if (n === 1) return { code: '23514', message: 'check violation' };
    return { code: '55P03', message: 'lock not available' };
  }),
  OfflineError,
);

console.log('syncCore: all tests passed');
