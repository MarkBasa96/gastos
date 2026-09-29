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

/** What the database answers while Joe has the "updating" switch on (HTTP 503, migration-v4-status.sql). */
export const UPDATING_CODE = 'GASTOS_UPDATING';

/** True for the "Gastos is updating" refusal, whether it arrives as a raw error or wrapped in OfflineError. */
export function isUpdating(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === UPDATING_CODE;
}

/** The "updating" switch as the server reported it. `skew` = server clock minus phone clock, in ms. */
export type AppStatus = { updating: boolean; backAt: number | null; windowId: string | null; minBuild: number; skew: number };

/** Reads public.app_status(). Only an exact `true` counts as updating (Kenshin L4); junk returns null (= unknown). */
export function parseStatus(data: unknown, clientNow: number): AppStatus | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const serverNow = typeof d.now === 'string' ? Date.parse(d.now) : NaN;
  const back = typeof d.back_at === 'string' ? Date.parse(d.back_at) : NaN;
  return {
    updating: d.updating === true,
    backAt: Number.isFinite(back) ? back : null,
    windowId: typeof d.window_id === 'string' && d.window_id ? d.window_id : null,
    minBuild: typeof d.min_build === 'number' ? d.min_build : 0,
    skew: Number.isFinite(serverNow) ? serverNow - clientNow : 0,
  };
}

/**
 * The return-time line, in the phone's own time zone. Compared against the server's clock, not the phone's.
 * No time, or more than a day away: null (leave it out). Already passed: say it's running late.
 */
export function backLine(backAt: number | null, skew: number, clientNow: number, locale?: string): string | null {
  if (backAt === null) return null;
  const now = clientNow + skew;
  if (backAt <= now) return 'Taking a little longer than planned.';
  if (backAt - now > 24 * 3600_000) return null;
  const at = new Date(backAt);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  const day = sameDay ? '' : new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(at) + ' ';
  return `Back around ${day}${time}.`;
}

/** Temporary trouble (network, busy or updating database): keep the rows queued. Carries the server's code. */
export class OfflineError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

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
    if (!isDataError(err)) throw new OfflineError(err.message ?? 'offline', err.code);
    for (const row of batch) {
      const e = await send([row]);
      if (!e) sent.push(row.id);
      else if (isDataError(e)) rejected.push(row.id);
      else throw new OfflineError(e.message ?? 'offline', e.code);
    }
  }
  return { sent, rejected };
}
