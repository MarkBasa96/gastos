import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLOR_THEMES, type Appearance, type ColorTheme } from './theme';

export type Method = 'cash' | 'card';
export type Kind = 'expense' | 'income';
export type PayGroup = 'cash' | 'card' | 'ewallet';
export type PayLabel = { n: string; g: PayGroup };

export type Expense = {
  id: string;
  cents: number; // integer, avoids float rounding on totals
  category: string;
  note: string;
  method: Method; // kept for old app versions: cash -> 'cash', anything else -> 'card'
  paidWith: string; // '' = show the label for method (old rows)
  kind: Kind;
  currency: string; // currency the entry was typed in; display converts, rows never change
  date: string; // YYYY-MM-DD, local time
  createdAt: number;
  deleted?: boolean; // soft delete, so other devices hear about it
  rev?: number; // local change stamp; pending upload while it differs from the synced one
};

export type Settings = {
  currency: string; // display currency
  appearance: Appearance;
  categories: string[]; // her own, added after the defaults
  paymentLabels: PayLabel[];
  sounds: boolean; // this phone only, like appearance
  colorTheme: ColorTheme; // follows the account (v3.1), unlike appearance
};

export const DEFAULT_SETTINGS: Settings = {
  currency: 'PHP',
  appearance: 'system',
  categories: [],
  paymentLabels: [
    { n: 'GCash', g: 'ewallet' },
    { n: 'Maya', g: 'ewallet' },
    { n: 'GoTyme', g: 'ewallet' },
    { n: 'SeaBank', g: 'ewallet' },
  ],
  sounds: true,
  colorTheme: 'green',
};

// Erina v2 §1: one clean word each, 8 total (Miller's range), "Other" stays.
export const CATEGORIES = ['Food', 'Transport', 'Load', 'Bills', 'Padala', 'Shopping', 'Health', 'Other'];
export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Gift', 'Other income'];

export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'USD', name: 'US dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'GBP', name: 'British pound' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CHF', name: 'Swiss franc' },
];
export const COMMON_CURRENCIES = ['PHP', 'USD', 'SGD', 'EUR', 'JPY'];
const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

const EXPENSES_KEY = 'gastos.v1.expenses';
const SETTINGS_KEY = 'gastos.v1.settings';

/** Old rows (v1) have no kind/paidWith/currency; fill them so the rest of the app can rely on them. */
export function normalize(e: any, fallbackCurrency: string): Expense {
  return {
    ...e,
    kind: e.kind === 'income' ? 'income' : 'expense',
    paidWith: typeof e.paidWith === 'string' ? e.paidWith : '',
    currency: typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency) ? e.currency : fallbackCurrency,
    method: e.method === 'card' ? 'card' : 'cash',
  };
}

export async function loadExpenses(fallbackCurrency = 'PHP'): Promise<Expense[]> {
  const raw = await AsyncStorage.getItem(EXPENSES_KEY);
  return raw ? (JSON.parse(raw) as any[]).map((e) => normalize(e, fallbackCurrency)) : [];
}

export async function saveExpenses(list: Expense[]): Promise<void> {
  await AsyncStorage.setItem(EXPENSES_KEY, JSON.stringify(list));
}

export function cleanSettings(s: any): Settings {
  return {
    currency: /^[A-Z]{3}$/.test(s?.currency) ? s.currency : 'PHP',
    appearance: s?.appearance === 'light' || s?.appearance === 'dark' ? s.appearance : 'system',
    categories: cleanCategories(s?.categories),
    paymentLabels: Array.isArray(s?.paymentLabels) ? cleanLabels(s.paymentLabels) : DEFAULT_SETTINGS.paymentLabels,
    sounds: s?.sounds !== false,
    colorTheme: cleanColorTheme(s?.colorTheme),
  };
}

export function cleanColorTheme(v: unknown): ColorTheme {
  return (COLOR_THEMES as readonly unknown[]).includes(v) ? (v as ColorTheme) : 'green';
}

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw ? cleanSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Names only: same rule as the database (Kenshin L1). At most 4 digits, 40 characters, no control chars. */
export function validLabel(name: string): boolean {
  const n = name.trim();
  return (
    n.length > 0 &&
    n.length <= 40 &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(n) &&
    n.replace(/[^0-9]/g, '').length <= 4
  );
}

export function cleanLabels(list: any[]): PayLabel[] {
  const seen = new Set<string>();
  const out: PayLabel[] = [];
  for (const x of list) {
    const n = typeof x?.n === 'string' ? x.n.trim().slice(0, 40) : '';
    const g: PayGroup = x?.g === 'card' || x?.g === 'ewallet' ? x.g : 'card';
    if (!validLabel(n) || seen.has(n.toLowerCase()) || n.toLowerCase() === 'cash') continue;
    seen.add(n.toLowerCase());
    out.push({ n, g });
    if (out.length >= 50) break;
  }
  // Byte cap matches the database (8 KB), or every settings sync would fail (Kenshin L-b).
  while (new TextEncoder().encode(JSON.stringify(out)).length > 8000) out.pop();
  return out;
}

export function cleanCategories(list: any): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set([...CATEGORIES, ...INCOME_CATEGORIES].map((c) => c.toLowerCase()));
  const out: string[] = [];
  for (const x of list) {
    const c = typeof x === 'string' ? x.trim().slice(0, 40) : '';
    if (!c || seen.has(c.toLowerCase()) || /[\u0000-\u001f\u007f-\u009f]/.test(c)) continue;
    seen.add(c.toLowerCase());
    out.push(c);
    if (out.length >= 50) break;
  }
  while (new TextEncoder().encode(JSON.stringify(out)).length > 4000) out.pop(); // DB cap 4 KB (Kenshin L-b)
  return out;
}

/** What "Paid with" shows for an entry. */
export function paidLabel(e: Pick<Expense, 'paidWith' | 'method'>): string {
  return e.paidWith || (e.method === 'card' ? 'Card' : 'Cash');
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "1,250.50" or "200" -> cents. Returns null if not a positive amount. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** 99,999,999.99. Matches the database check, so nothing typed can be refused later. */
export const MAX_CENTS = 9_999_999_999;

/** True only for a real calendar date, e.g. rejects 2026-02-31. */
export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const ID_FORMAT = /^[A-Za-z0-9_-]{1,40}$/;

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat('en-PH', { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

// ---------- Exchange rates (display only; rows are never rewritten) ----------

export type Rates = { base: string; date: string; fetchedAt: number; rates: Record<string, number> };
const RATES_KEY = 'gastos.v1.rates';

export async function loadRates(): Promise<Rates | null> {
  try {
    const raw = await AsyncStorage.getItem(RATES_KEY);
    return raw ? (JSON.parse(raw) as Rates) : null;
  } catch {
    return null;
  }
}

/** Frankfurter (primary) then open.er-api.com (fallback). Untrusted input: keep only sane numbers. */
export async function fetchRates(base: string): Promise<Rates> {
  const sane = (r: any): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      if (/^[A-Z]{3}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 1e-6 && v < 1e7) out[k] = v;
    }
    out[base] = 1;
    return out;
  };
  const withTimeout = (url: string) => {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 8000);
    return fetch(url, { signal: c.signal }).finally(() => clearTimeout(timer));
  };
  try {
    const res = await withTimeout(`https://api.frankfurter.dev/v1/latest?base=${base}`);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const rates = sane(j.rates);
    if (Object.keys(rates).length < 2) throw new Error('empty');
    return { base, date: String(j.date ?? ''), fetchedAt: Date.now(), rates };
  } catch {
    const res = await withTimeout(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) throw new Error('Could not get exchange rates.');
    const j = await res.json();
    if (j.result !== 'success') throw new Error('Could not get exchange rates.');
    return { base, date: String(j.time_last_update_utc ?? '').slice(5, 16), fetchedAt: Date.now(), rates: sane(j.rates) };
  }
}

export async function saveRates(r: Rates): Promise<void> {
  await AsyncStorage.setItem(RATES_KEY, JSON.stringify(r));
}

/** cents in `from` -> cents in rates.base. Returns null when there's no rate for `from`. */
export function convert(cents: number, from: string, rates: Rates | null, to: string): number | null {
  if (from === to) return cents;
  if (!rates || rates.base !== to) return null;
  const r = rates.rates[from];
  return r ? Math.round(cents / r) : null;
}

/** Sum of entries shown in the display currency. Entries without a rate are left out (and counted). */
export function sumIn(list: Expense[], to: string, rates: Rates | null): { cents: number; missing: number } {
  let cents = 0;
  let missing = 0;
  for (const e of list) {
    const c = convert(e.cents, e.currency, rates, to);
    if (c === null) missing++;
    else cents += c;
  }
  return { cents, missing };
}

// ---------- Backup ----------

/** Backup file content. Versioned so a future format can still read old files. */
export function toBackup(expenses: Expense[], settings: Settings, owner: string | null): string {
  return JSON.stringify(
    { app: 'gastos', version: 2, exportedAt: new Date().toISOString(), owner, settings, expenses },
    null,
    1,
  );
}

export const MAX_BACKUP_ROWS = 20_000;

export function fromBackup(text: string): { expenses: Expense[]; settings: Settings; owner: string | null } {
  if (text.length > 5_000_000) throw new Error('This file is too big to be a Gastos backup.');
  const data = JSON.parse(text);
  if (data?.app !== 'gastos' || !Array.isArray(data.expenses)) {
    throw new Error('This file is not a Gastos backup.');
  }
  const settings = cleanSettings(data.settings);
  // Same limits as the database (schema.sql + migration-v2.sql), so a restored file can never jam sync.
  const expenses: Expense[] = data.expenses
    .slice(0, MAX_BACKUP_ROWS)
    .filter(
      (e: any) =>
        typeof e?.id === 'string' &&
        Number.isInteger(e.cents) &&
        e.cents > 0 &&
        e.cents <= MAX_CENTS &&
        typeof e.category === 'string' &&
        e.category.trim().length > 0 &&
        isRealDate(e.date),
    )
    .map((e: any) => ({
      id: ID_FORMAT.test(e.id) ? e.id : newId(),
      cents: e.cents,
      category: e.category.trim().slice(0, 40),
      note: typeof e.note === 'string' ? e.note.slice(0, 200) : '',
      method: e.method === 'card' ? 'card' : 'cash',
      paidWith: typeof e.paidWith === 'string' && (e.paidWith === '' || validLabel(e.paidWith)) ? e.paidWith.trim() : '',
      kind: e.kind === 'income' ? 'income' : 'expense',
      currency: typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency) ? e.currency : settings.currency,
      date: e.date,
      createdAt: Number(e.createdAt) || 0,
      deleted: e.deleted === true,
    }));
  const owner = typeof data.owner === 'string' ? data.owner : null;
  return { expenses, settings, owner };
}

export function knownCurrency(code: string): boolean {
  return CURRENCY_CODES.has(code);
}
