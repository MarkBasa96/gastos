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

console.log('syncCore: all tests passed');
