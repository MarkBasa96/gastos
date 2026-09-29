import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Expense, Settings, cleanCategories, cleanColorTheme, cleanLabels, cleanPinned, normalize } from './data';
import { pushWithFallback } from './syncCore';

// Both values are public by design (they ship inside the app). Row Level Security protects the data.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

// ---- Local sync bookkeeping ----
// dirty: id -> rev of the local change still waiting to reach the cloud.
const DIRTY_KEY = 'gastos.v1.dirty';
const CURSOR_KEY = 'gastos.v1.pulledUntil';
const SETTINGS_DIRTY_KEY = 'gastos.v1.settingsDirty';

export type Dirty = Record<string, number>;

export async function loadDirty(): Promise<Dirty> {
  const raw = await AsyncStorage.getItem(DIRTY_KEY);
  return raw ? JSON.parse(raw) : {};
}
export async function saveDirty(d: Dirty): Promise<void> {
  await AsyncStorage.setItem(DIRTY_KEY, JSON.stringify(d));
}
export async function setSettingsDirty(v: boolean): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_DIRTY_KEY, v ? '1' : '');
}
async function settingsDirty(): Promise<boolean> {
  return (await AsyncStorage.getItem(SETTINGS_DIRTY_KEY)) === '1';
}

// Whose data is on this device. Lets sign-in tell "same person back" from "someone else" (Kenshin L2).
const LAST_USER_KEY = 'gastos.v1.lastUser';
export const loadLastUser = () => AsyncStorage.getItem(LAST_USER_KEY);
export const saveLastUser = (id: string) => AsyncStorage.setItem(LAST_USER_KEY, id);

/** Forget everything sync-related on this device (sign-out). */
export async function clearSyncState(): Promise<void> {
  const cursors = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CURSOR_KEY));
  await AsyncStorage.multiRemove([DIRTY_KEY, SETTINGS_DIRTY_KEY, LAST_USER_KEY, ...cursors]);
}

type Row = {
  id: string;
  cents: number;
  category: string;
  note: string;
  method: 'cash' | 'card';
  paid_with: string;
  kind: 'expense' | 'income';
  currency: string;
  date: string;
  created_at: number;
  deleted: boolean;
  updated_at?: string;
};

const toRow = (e: Expense): Row => ({
  id: e.id,
  cents: e.cents,
  category: e.category,
  note: e.note,
  method: e.method,
  paid_with: e.paidWith,
  kind: e.kind,
  currency: e.currency,
  date: e.date,
  created_at: e.createdAt,
  deleted: !!e.deleted,
});

/** Server rows are untrusted: anything unexpected falls back to safe defaults (Kenshin v2 2.3). */
const fromRow = (r: Row, fallbackCurrency: string): Expense =>
  normalize(
    {
      id: r.id,
      cents: r.cents,
      category: r.category,
      note: r.note,
      method: r.method,
      paidWith: r.paid_with,
      kind: r.kind,
      currency: r.currency,
      date: r.date,
      createdAt: Number(r.created_at),
      deleted: r.deleted,
      rev: 0,
    },
    fallbackCurrency,
  );

/**
 * Upload local changes. `done` = dirty entries the server confirmed; `rejected` = ids it will never
 * accept (bad data, or an id owned by another account). Throws OfflineError on network trouble.
 */
export async function push(all: Expense[], dirty: Dirty, userId: string): Promise<{ done: Dirty; rejected: string[] }> {
  if (!supabase) return { done: {}, rejected: [] };
  const client = supabase;
  const pending = all.filter((e) => dirty[e.id] !== undefined);
  const { sent, rejected } = await pushWithFallback(pending, async (batch) => {
    const { error } = await client
      .from('expenses')
      .upsert(batch.map((e) => ({ ...toRow(e), user_id: userId })), { onConflict: 'id' });
    return error;
  });
  const done: Dirty = {};
  for (const id of sent) done[id] = dirty[id];
  return { done, rejected };
}

/** Download everything changed on the server since this user's last pull. */
export async function pull(userId: string, fallbackCurrency: string): Promise<Expense[]> {
  if (!supabase) return [];
  // Cursor is (updated_at, id): one upsert batch shares a single now(), so time alone can split a batch.
  // Keyed by user, so a second account on this device starts from the beginning (Kenshin L2).
  const cursorKey = `${CURSOR_KEY}.${userId}`;
  const saved = await AsyncStorage.getItem(cursorKey);
  let cursor: { t: string; id: string } = saved ? JSON.parse(saved) : { t: '1970-01-01T00:00:00Z', id: '' };
  const out: Expense[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from('expenses')
      .select('id,cents,category,note,method,paid_with,kind,currency,date,created_at,deleted,updated_at')
      // Quoted: timestamps contain '.' and ':', which PostgREST treats as syntax inside or().
      .or(`updated_at.gt."${cursor.t}",and(updated_at.eq."${cursor.t}",id.gt."${cursor.id}")`)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw error;
    if (!data.length) break;
    out.push(...(data as Row[]).map((r) => fromRow(r, fallbackCurrency)));
    const last = data[data.length - 1] as Row;
    cursor = { t: last.updated_at!, id: last.id };
    if (data.length < 1000) break;
  }
  await AsyncStorage.setItem(cursorKey, JSON.stringify(cursor));
  return out;
}

/**
 * Insert-only upload for "Add what's missing" (Kenshin M3): ON CONFLICT DO NOTHING, so a row that
 * already exists in the cloud is never overwritten or resurrected by an older backup copy.
 */
export async function pushNewOnly(rows: Expense[], userId: string): Promise<{ sent: string[]; rejected: string[] }> {
  if (!supabase) return { sent: [], rejected: [] };
  const client = supabase;
  return pushWithFallback(rows, async (batch) => {
    const { error } = await client
      .from('expenses')
      .upsert(batch.map((e) => ({ ...toRow(e), user_id: userId })), { onConflict: 'id', ignoreDuplicates: true });
    return error;
  });
}

/** Local change wins if it hasn't been pushed yet; otherwise the server copy wins. Appearance stays per-phone. */
export async function syncSettings(local: Settings, userId: string): Promise<Settings> {
  if (!supabase) return local;
  const client = supabase;
  // The colour theme and pins follow the account (v3.1). Until migration-v3.1.sql has run on the
  // server those columns don't exist; then sync carries on without them, exactly as 3.0 did.
  const noColumn = (e: { code?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204');
  if (await settingsDirty()) {
    const row = { user_id: userId, currency: local.currency, categories: local.categories, payment_labels: local.paymentLabels };
    let { error } = await client.from('user_settings').upsert({ ...row, color_theme: local.colorTheme, pinned_categories: local.pinned });
    if (noColumn(error)) ({ error } = await client.from('user_settings').upsert(row));
    if (error) throw error;
    await setSettingsDirty(false);
    return local;
  }
  let res = await client.from('user_settings').select('currency,categories,payment_labels,color_theme,pinned_categories').maybeSingle();
  if (noColumn(res.error)) res = (await client.from('user_settings').select('currency,categories,payment_labels').maybeSingle()) as typeof res;
  const { data, error } = res;
  if (error) throw error;
  if (!data) return local;
  const categories = cleanCategories(data.categories);
  const pins = (data as { pinned_categories?: unknown }).pinned_categories;
  return {
    ...local,
    currency: /^[A-Z]{3}$/.test(data.currency) ? data.currency : local.currency,
    categories,
    pinned: Array.isArray(pins) ? cleanPinned(pins, categories) : cleanPinned(local.pinned, categories),
    paymentLabels: Array.isArray(data.payment_labels) && data.payment_labels.length ? cleanLabels(data.payment_labels) : local.paymentLabels,
    colorTheme: data.color_theme ? cleanColorTheme(data.color_theme) : local.colorTheme,
  };
}

/**
 * Rename a wallet on every past entry. Server-side, one column only, so it can never push this
 * phone's stale copy of a row over an edit made on another phone (Kenshin v3 M11). RLS keeps it to
 * her own rows; updated_at moves, so the next pull brings the new name to every phone.
 */
export async function renamePaidWith(from: string, to: string): Promise<void> {
  if (!supabase) throw new Error('offline');
  const { error } = await supabase.from('expenses').update({ paid_with: to }).eq('paid_with', from);
  if (error) throw error;
}

/**
 * Rename one of her own categories on every past expense (v3.1). Server-side, one column only, like
 * the wallet rename (Kenshin M11): a stale copy on this phone can never be pushed over another
 * phone's edit. RLS keeps it to her own rows; updated_at moves, so every phone pulls the new name.
 */
export async function renameCategory(from: string, to: string): Promise<void> {
  if (!supabase) throw new Error('offline');
  const { error } = await supabase.from('expenses').update({ category: to }).eq('category', from).eq('kind', 'expense');
  if (error) throw error;
}

/** Feedback goes through one server function: it checks the limits, stores it and emails Joe (Kenshin v3 Part 3). */
export async function sendFeedback(kind: string, body: string, appVersion: string): Promise<'ok' | 'slow_down' | 'error'> {
  if (!supabase) return 'error';
  const { data, error } = await supabase.rpc('send_feedback', { p_kind: kind, p_body: body, p_app_version: appVersion });
  if (error) return 'error';
  const r = (data as { result?: string } | null)?.result;
  return r === 'ok' || r === 'slow_down' ? r : 'error';
}
