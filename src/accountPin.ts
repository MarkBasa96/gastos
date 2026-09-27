import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './cloud';
import { MAX_TRIES, derivePin, equalBytes } from './pin';

// v3: ONE MPIN per account (Joe). The server decides whenever there's a network; each phone keeps a
// PBKDF2 copy (the "verifier") only so it can unlock offline. Rules: Kenshin v3 review, Part 1.

const VERIFIER_KEY = 'gastos.v2.pin';
const KNOWN_KEY = 'gastos.v2.pinstatus'; // what the server last said: {uid, enabled, epoch}
const ITERATIONS = 100_000;
const MAX_AGE_MS = 30 * 86_400_000; // Joe: an offline phone accepts a stale MPIN for at most 30 days

export type Verifier = {
  v: 2;
  uid: string;
  email: string;
  epoch: string;
  salt: string;
  iter: number;
  hash: string;
  fails: number; // offline wrong tries, reported to the server on the next sync
  lockedOut: boolean;
  checkedAt: number;
};
export type Known = { uid: string; enabled: boolean; epoch: string | null };

const b64e = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function loadVerifier(uid: string | null): Promise<Verifier | 'none' | 'corrupt'> {
  const raw = await AsyncStorage.getItem(VERIFIER_KEY);
  if (!raw) return 'none';
  try {
    const r = JSON.parse(raw) as Verifier;
    if (r?.v !== 2 || typeof r.hash !== 'string' || !r.uid || r.uid !== uid || typeof r.epoch !== 'string') return 'corrupt';
    return r;
  } catch {
    return 'corrupt';
  }
}

async function saveVerifierRecord(r: Verifier) {
  await AsyncStorage.setItem(VERIFIER_KEY, JSON.stringify(r));
}

/** Written ONLY with digits the server just accepted (Kenshin 1.4 rule 1). */
export async function writeVerifier(pin: string, uid: string, email: string, epoch: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePin(pin, salt, ITERATIONS);
  await saveVerifierRecord({ v: 2, uid, email, epoch, salt: b64e(salt), iter: ITERATIONS, hash: b64e(hash), fails: 0, lockedOut: false, checkedAt: Date.now() });
}

export async function clearVerifier(): Promise<void> {
  await AsyncStorage.removeItem(VERIFIER_KEY);
}

export async function markLockedOut(uid: string | null): Promise<void> {
  const r = await loadVerifier(uid);
  if (r !== 'none' && r !== 'corrupt') await saveVerifierRecord({ ...r, lockedOut: true });
}

export async function loadKnown(uid: string | null): Promise<Known | null> {
  try {
    const k = JSON.parse((await AsyncStorage.getItem(KNOWN_KEY)) || 'null') as Known | null;
    return k && k.uid === uid ? k : null;
  } catch {
    return null;
  }
}

export async function saveKnown(k: Known): Promise<void> {
  await AsyncStorage.setItem(KNOWN_KEY, JSON.stringify(k));
}

export async function clearAccountPinState(): Promise<void> {
  await AsyncStorage.multiRemove([VERIFIER_KEY, KNOWN_KEY]);
}

/**
 * Offline check against the local verifier. Count first, then compare (v2 M2): killing the app
 * mid-check can't undo a guess. 'stale' = older than 30 days, needs one online check.
 */
export async function localCheck(pin: string, uid: string | null): Promise<'ok' | 'wrong' | 'locked' | 'none' | 'stale'> {
  const r = await loadVerifier(uid);
  if (r === 'none' || r === 'corrupt') return r === 'none' ? 'none' : 'locked';
  if (r.lockedOut) return 'locked';
  if (Date.now() - r.checkedAt > MAX_AGE_MS) return 'stale';
  r.fails += 1;
  await saveVerifierRecord(r);
  const ok = equalBytes(await derivePin(pin, b64d(r.salt), r.iter), b64d(r.hash));
  if (ok) {
    // Keep the count: it's reported on the next sync so "5 across all phones" still holds.
    await saveVerifierRecord({ ...r, fails: r.fails - 1 });
    return 'ok';
  }
  if (r.fails >= MAX_TRIES) {
    await saveVerifierRecord({ ...r, lockedOut: true });
    return 'locked';
  }
  return 'wrong';
}

// ---------------- server calls (POST body, never the URL: Kenshin L2) ----------------

export type ServerResult = { result: string; epoch?: string | null; tries_left?: number };

async function rpc(name: string, args: Record<string, unknown>, timeoutMs = 4000): Promise<ServerResult | 'network'> {
  if (!supabase) return 'network';
  try {
    const call = supabase.rpc(name, args);
    const timed = new Promise<'network'>((resolve) => setTimeout(() => resolve('network'), timeoutMs));
    const r = await Promise.race([call, timed]);
    if (r === 'network') return 'network';
    const { data, error } = r as { data: unknown; error: { message?: string } | null };
    if (error) {
      // A fetch failure is a network problem; anything the server answered is a real answer.
      return /fetch|network|Failed to|timeout/i.test(error.message ?? '') ? 'network' : { result: 'error' };
    }
    return (data ?? { result: 'error' }) as ServerResult;
  } catch {
    return 'network';
  }
}

export const pinStatus = (timeoutMs = 4000) =>
  rpc('pin_status', {}, timeoutMs) as Promise<({ enabled: boolean; epoch: string | null; locked: boolean; tries_left: number; can_reset: boolean } & ServerResult) | 'network'>;
export const pinVerify = (pin: string) => rpc('pin_verify', { p_pin: pin });
export const pinClaim = (pin: string) => rpc('pin_claim', { p_pin: pin });
export const pinChange = (oldPin: string, newPin: string) => rpc('pin_change', { p_old: oldPin, p_new: newPin });
export const pinDisable = (pin: string) => rpc('pin_disable', { p_pin: pin });
export const pinResetWithCode = (pin: string) => rpc('pin_reset_with_code', { p_new: pin });
export const pinReportOfflineFails = (n: number) => rpc('pin_report_offline_fails', { p_n: n });

/** After an online check: send the offline wrong tries up, then zero them locally. */
export async function flushOfflineFails(uid: string | null): Promise<ServerResult | null> {
  const r = await loadVerifier(uid);
  if (r === 'none' || r === 'corrupt' || r.fails < 1) return null;
  const res = await pinReportOfflineFails(r.fails);
  if (res === 'network') return null;
  await saveVerifierRecord({ ...r, fails: 0 });
  return res;
}
