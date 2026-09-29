// Pure sync logic, no imports, so it can be tested with plain Node.

export type DbError = { code?: string; message?: string } | null;

/**
 * True only when the server will never accept this row as it is: bad data (22xxx), a broken rule
 * (23xxx, e.g. 23514) or a row owned by another account (42501). Everything else (timeouts 57014, lock
 * waits 55P03, deadlocks 40P01, a column mid-migration 42703, the network) is temporary: the row stays
 * queued and retries later. Treating those as permanent silently dropped rows (Kenshin B2, 2026-09-29).
 */
export function isDataError(e: DbError): boolean {
  return !!e && typeof e.code === 'string' && (/^2[23][0-9A-Z]{3}$/.test(e.code) || e.code === '42501');
}

export class OfflineError extends Error {}

/**
 * Upload rows in batches. If a batch is refused because of bad data, retry it one row at a time
 * so a single bad row can't block everything forever (Kenshin M2).
 * Returns ids that reached the server and ids the server will never accept.
 */
export async function pushWithFallback<T extends { id: string }>(
  rows: T[],
  send: (batch: T[]) => Promise<DbError>,
  batchSize = 200,
): Promise<{ sent: string[]; rejected: string[] }> {
  const sent: string[] = [];
  const rejected: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const err = await send(batch);
    if (!err) {
      sent.push(...batch.map((r) => r.id));
      continue;
    }
    if (!isDataError(err)) throw new OfflineError(err.message ?? 'offline');
    for (const row of batch) {
      const e = await send([row]);
      if (!e) sent.push(row.id);
      else if (isDataError(e)) rejected.push(row.id);
      else throw new OfflineError(e.message ?? 'offline');
    }
  }
  return { sent, rejected };
}
