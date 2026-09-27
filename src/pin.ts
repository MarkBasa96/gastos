import AsyncStorage from '@react-native-async-storage/async-storage';

// v2 (legacy) per-phone MPIN. v3 moved the MPIN to the account (accountPin.ts); this record is read once
// to migrate it (Kenshin v3 M4), then deleted.
// MPIN app lock (Kenshin v2 review, Part 1). It stops someone holding her unlocked phone from browsing
// Gastos; it does not stop devtools. Web only for now: WebCrypto PBKDF2. Native builds should swap this
// module for expo-secure-store behind the same functions.

export type PinRecord = {
  v: 1;
  uid: string; // must match lastUser
  email: string; // needed to send a code after a lockout signs out
  salt: string; // base64, 16 bytes
  iter: number;
  hash: string; // base64, 32 bytes
  fails: number; // wrong tries since the last success; survives restarts
  lockedOut: boolean; // true after 5 wrong; only an email code clears it
};

const PIN_KEY = 'gastos.v1.pin';
const ITERATIONS = 100_000;
export const MAX_TRIES = 5;

const b64e = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function pinSupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function';
}

export async function derivePin(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, 256),
  );
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** 'none' = no PIN set. 'corrupt' = present but unreadable or for another user: fail closed. */
export async function loadPin(lastUser: string | null): Promise<PinRecord | 'none' | 'corrupt'> {
  const raw = await AsyncStorage.getItem(PIN_KEY);
  if (!raw) return 'none';
  try {
    const r = JSON.parse(raw) as PinRecord;
    if (r?.v !== 1 || typeof r.hash !== 'string' || !r.uid || r.uid !== lastUser) return 'corrupt';
    return r;
  } catch {
    return 'corrupt';
  }
}

async function savePin(r: PinRecord): Promise<void> {
  await AsyncStorage.setItem(PIN_KEY, JSON.stringify(r));
}

export async function clearPin(): Promise<void> {
  await AsyncStorage.removeItem(PIN_KEY);
}

// Kenshin 1.7: block the most-guessed PINs.
const BLOCKED = new Set(['1212', '6969', '2580', '1004', '2000', '1122', '5683', '0852', '1010', '2020', '4545']);
export function weakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const up = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  return up || down || BLOCKED.has(pin);
}

export async function setPin(pin: string, uid: string, email: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePin(pin, salt, ITERATIONS);
  await savePin({ v: 1, uid, email, salt: b64e(salt), iter: ITERATIONS, hash: b64e(hash), fails: 0, lockedOut: false });
}

/** Count first, then compare, reset only on success (Kenshin M2): killing the app can't undo a guess. */
export async function tryPin(pin: string, lastUser: string | null): Promise<'ok' | 'wrong' | 'locked'> {
  const r = await loadPin(lastUser);
  if (r === 'none' || r === 'corrupt' || r.lockedOut) return 'locked';
  r.fails += 1;
  await savePin(r);
  const ok = equalBytes(await derivePin(pin, b64d(r.salt), r.iter), b64d(r.hash));
  if (ok) {
    r.fails = 0;
    await savePin(r);
    return 'ok';
  }
  if (r.fails >= MAX_TRIES) {
    r.lockedOut = true;
    await savePin(r);
    return 'locked';
  }
  return 'wrong';
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 1)}•••••@${domain}`;
}
