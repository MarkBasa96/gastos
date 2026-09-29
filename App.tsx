import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  clearAccountPinState,
  clearVerifier,
  flushOfflineFails,
  loadKnown,
  loadVerifier,
  localCheck,
  markLockedOut,
  pinChange,
  pinClaim,
  pinDisable,
  pinResetWithCode,
  pinStatus,
  pinVerify,
  saveKnown,
  writeVerifier,
} from './src/accountPin';
import { Lock, PinTry, SetPin, SignIn, VerifyPin, Welcome } from './src/Auth';
import { startBackNav, useBackHandler } from './src/backNav';
import { SavedPill } from './src/celebrate';
import {
  Dirty,
  clearSyncState,
  loadDirty,
  loadLastUser,
  pull,
  push,
  pushNewOnly,
  renameCategory as renameCategoryOnServer,
  renamePaidWith,
  saveDirty,
  sendFeedback,
  saveLastUser,
  setSettingsDirty,
  supabase,
  syncSettings,
} from './src/cloud';
import {
  DEFAULT_SETTINGS,
  Expense,
  PayLabel,
  Rates,
  Settings,
  cleanCategories,
  cleanLabels,
  cleanPinned,
  fetchRates,
  loadExpenses,
  loadRates,
  loadSettings,
  newId,
  saveExpenses,
  saveRates,
  saveSettings,
} from './src/data';
import { EditSheet } from './src/ExpenseRow';
import { prefersReducedMotion, setSoundsOn } from './src/fx';
import { HistoryScreen } from './src/HistoryScreen';
import { LogScreen } from './src/LogScreen';
import type { CategoryTools } from './src/OtherPicker';
import { MAX_TRIES, clearPin, loadPin, maskEmail, pinSupported, tryPin, weakPin } from './src/pin';
import { SettingsScreen } from './src/SettingsScreen';
import { AppearanceContext, ColorTheme, ColorThemeContext, Theme, cardRadius, useTheme } from './src/theme';
import { BrandLoader, Button, Sheet, SyncState, T } from './src/ui';

type Tab = 'log' | 'history' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'log', label: 'Log' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];
type Screen = null | 'signin' | 'forgot' | 'setpin' | 'pinoff' | 'pinchange';

/**
 * The MPIN as the gate sees it. v3: the MPIN belongs to the account (server); this phone has a
 * verifier for offline unlock, or a v2 per-phone record waiting to migrate (Kenshin v3 M4), or only
 * knows from the server that one exists (needsOnline: can't unlock offline, Kenshin 1.4 rule 6).
 */
type PinView = { email: string | null; fails: number; lockedOut: boolean; needsOnline?: boolean } | 'none' | 'corrupt';
type PinMode = 'create' | 'change' | 'reset';

async function readPinView(uid: string | null): Promise<PinView> {
  const v = await loadVerifier(uid);
  if (v === 'corrupt') return 'corrupt';
  if (v !== 'none') return { email: v.email, fails: v.fails, lockedOut: v.lockedOut };
  const legacy = await loadPin(uid);
  if (legacy === 'corrupt') return 'corrupt';
  if (legacy !== 'none') return { email: legacy.email, fails: legacy.fails, lockedOut: legacy.lockedOut };
  const known = await loadKnown(uid);
  if (known?.enabled) return { email: null, fails: 0, lockedOut: false, needsOnline: true };
  return 'none';
}

const APP_VERSION = '3.1.0';
// Joe v3: no lock when switching apps; only a fresh open, or after this long away (Kenshin L4).
const IDLE_LOCK_MS = 30 * 60_000;

const ONBOARDED_KEY = 'gastos.v1.onboarded';
const LAST_EMAIL_KEY = 'gastos.v1.lastEmail';

// Web: modal and scroll containers take programmatic focus (tabindex=-1); the browser's own outline
// on them draws a box around the whole screen. Our buttons and fields draw their own focus rings.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const css = document.createElement('style');
  css.textContent =
    '[tabindex="-1"]:focus{outline:none}' +
    // Appearance circle (Joe v3): the new look grows out of the tapped icon. No DOM-snapshot library (Kenshin v3 Part 5).
    '::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}';
  document.head.appendChild(css);
}

// Offline cold start (Joe v3): the service worker keeps a copy of the app's own files, never data.
// Built app only, over https (or localhost for the test harness), never in dev (Kenshin v3 L8).
if (
  Platform.OS === 'web' &&
  !__DEV__ &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('Gastos: offline copy not set up', e));
  });
}

export default function App() {
  const [appearance, setAppearance] = useState<Settings['appearance']>('system');
  const [color, setColor] = useState<ColorTheme>('green');
  const onLook = useCallback((s: Pick<Settings, 'appearance' | 'colorTheme'>) => {
    setAppearance(s.appearance);
    setColor(s.colorTheme);
  }, []);
  return (
    <SafeAreaProvider>
      <AppearanceContext.Provider value={appearance}>
        <ColorThemeContext.Provider value={color}>
          <Main onLook={onLook} />
        </ColorThemeContext.Provider>
      </AppearanceContext.Provider>
    </SafeAreaProvider>
  );
}

function Main({ onLook }: { onLook: (s: Pick<Settings, 'appearance' | 'colorTheme'>) => void }) {
  const t = useTheme();
  // Fonts ship from assets/fonts, NOT from node_modules: Vercel skips any path containing
  // "node_modules" on upload, so the package copies 404'd live (2026-09-26). OFL-1.1 licensed.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('./assets/fonts/Inter_400Regular.ttf'),
    Inter_500Medium: require('./assets/fonts/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('./assets/fonts/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('./assets/fonts/Inter_700Bold.ttf'),
    Poppins_700Bold: require('./assets/fonts/Poppins_700Bold.ttf'),
  });
  // Never let fonts or the session check hold the app hostage: after a few seconds, open anyway
  // (system font, and the session catches up when it arrives). A laptop hung here on 2026-09-26.
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedLong(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  const fonts = fontsLoaded || !!fontError || waitedLong;
  useEffect(() => {
    if (fontError) console.warn('Gastos: fonts failed to load, using system font', fontError);
  }, [fontError]);
  const [tab, setTab] = useState<Tab>('log');
  const [screen, setScreen] = useState<Screen>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loadError, setLoadError] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(!supabase);
  const [lastUser, setLastUser] = useState<string | null>(null);
  const [lastEmail, setLastEmail] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(true);
  const [pin, setPinRecord] = useState<PinView>('none');
  const pinMode = useRef<PinMode>('create');
  const oldPin = useRef<string | null>(null); // Change MPIN: the current one, held only between the two screens
  const [unlocked, setUnlocked] = useState(false);
  const [syncing, setSyncingState] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncedThisSession, setSyncedThisSession] = useState(false);
  const [rates, setRatesState] = useState<Rates | null>(null);
  const [online, setOnline] = useState(Platform.OS !== 'web' || navigator.onLine !== false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [switchAsk, setSwitchAsk] = useState(false);
  // Appearance circle without View Transitions (iPhones before iOS 18): a circle in the new colour grows
  // from the tapped icon, the theme switches under it, then it fades (Joe, v3 test round 2).
  const [reveal, setReveal] = useState<{ x: number; y: number; end: number; color: string; key: number } | null>(null);
  const systemScheme = useColorScheme();

  // Refs so the sync loop always sees the latest data without re-subscribing.
  const expensesRef = useRef<Expense[]>([]);
  const settingsRef = useRef<Settings>(settings);
  const dirtyRef = useRef<Dirty>({});
  const sessionRef = useRef<Session | null>(null);
  const syncingRef = useRef(false);
  const again = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the app last went to the background. "Unlocked" itself lives only in memory (Kenshin v3 M6).
  const hiddenAt = useRef<number | null>(null);
  const lastUserRef = useRef<string | null>(null);

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      const [e, d, lu, le, ob, r] = await Promise.all([
        loadExpenses(s.currency),
        loadDirty(),
        loadLastUser(),
        AsyncStorage.getItem(LAST_EMAIL_KEY),
        AsyncStorage.getItem(ONBOARDED_KEY),
        loadRates(),
      ]);
      // PIN state must be known BEFORE any data renders, or the gate is briefly open (Kenshin audit).
      setPinRecord(await readPinView(lu));
      lastUserRef.current = lu;
      expensesRef.current = e;
      settingsRef.current = s;
      dirtyRef.current = d;
      saveExpenses(e).catch(() => {}); // v1 rows get their currency written down now (Kenshin L-d)
      setExpenses(e);
      setSettingsState(s);
      onLook(s);
      setPending(Object.keys(d).length);
      setLastUser(lu);
      setLastEmail(le);
      // Existing v1 users (data or an account already here) skip the welcome.
      setOnboarded(ob === '1' || e.length > 0 || !!lu);
      setRatesState(r);
    })().catch(() => setLoadError(true));
  }, [onLook]);

  useEffect(() => setSoundsOn(settings.sounds), [settings.sounds]);

  // Every change is written straight to the phone, so nothing is lost if the app closes.
  const commit = useCallback((next: Expense[]) => {
    expensesRef.current = next;
    setExpenses(next);
    saveExpenses(next).catch(() => setLoadError(true));
  }, []);

  const writeDirty = useCallback((d: Dirty) => {
    dirtyRef.current = d;
    setPending(Object.keys(d).length);
    saveDirty(d);
  }, []);

  // ---------- sync ----------
  const syncNow = useCallback(async () => {
    const s = sessionRef.current;
    if (!supabase || !s) return;
    // Never sync a session that isn't this phone's account (Kenshin L-e: Forgot MPIN verifies first).
    if (lastUserRef.current && s.user.id !== lastUserRef.current) return;
    if (syncingRef.current) {
      again.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncingState(true);
    const uid = s.user.id;
    // If the user signs out (or someone else signs in) mid-sync, drop the results (Kenshin L2).
    const stillSame = () => sessionRef.current?.user.id === uid;
    try {
      const { done, rejected } = await push(expensesRef.current, { ...dirtyRef.current }, uid);
      if (!stillSame()) return;
      // Only clear entries that didn't change again while the upload was in flight.
      const left = { ...dirtyRef.current };
      for (const [id, rev] of Object.entries(done)) if (left[id] === rev) delete left[id];
      for (const id of rejected) delete left[id];
      writeDirty(left);
      if (rejected.length) setRejected((n) => n + rejected.length);

      const incoming = await pull(uid, settingsRef.current.currency);
      if (!stillSame()) return;
      if (incoming.length) {
        const byId = new Map(expensesRef.current.map((e) => [e.id, e]));
        for (const r of incoming) if (dirtyRef.current[r.id] === undefined) byId.set(r.id, r);
        commit([...byId.values()]);
      }

      const s2 = await syncSettings(settingsRef.current, uid);
      if (!stillSame()) return;
      if (JSON.stringify(s2) !== JSON.stringify(settingsRef.current)) {
        settingsRef.current = s2;
        setSettingsState(s2);
        onLook(s2);
        saveSettings(s2);
      }
      setOffline(false);
      setLastSyncAt(Date.now());
      setSyncedThisSession(true);
    } catch {
      setOffline(true);
    } finally {
      syncingRef.current = false;
      setSyncingState(false);
      if (again.current) {
        again.current = false;
        syncNow();
      }
    }
  }, [commit, writeDirty]);

  const syncSoon = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(syncNow, 1500);
  }, [syncNow]);

  // Session: restored from the phone on start (works offline), then kept in step with sign-in/out.
  useEffect(() => {
    if (!supabase) return;
    const giveUp = setTimeout(() => {
      console.warn('Gastos: session check is slow; opening without it for now');
      setSessionReady(true);
    }, 6000);
    supabase.auth
      .getSession()
      .then(({ data }) => {
        sessionRef.current = data.session;
        setSession(data.session);
      })
      .catch((e) => console.warn('Gastos: session check failed', e))
      .finally(() => {
        clearTimeout(giveUp);
        setSessionReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      sessionRef.current = s;
      setSession(s);
      setSessionReady(true);
    });
    return () => {
      clearTimeout(giveUp);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const em = session?.user.email;
    if (em && !lastEmail && session?.user.id === lastUser) {
      AsyncStorage.setItem(LAST_EMAIL_KEY, em);
      setLastEmail(em);
    }
  }, [session, lastEmail, lastUser]);

  useEffect(() => {
    if (session && expenses !== null) syncNow();
  }, [session?.user.id, expenses === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // v3 (Joe): switching apps no longer locks. A fresh open always asks (unlocked lives only in memory),
  // and so does coming back after 30 minutes away (Kenshin v3 L4). Sync when the app comes back.
  useEffect(() => {
    const back = () => {
      const away = hiddenAt.current;
      hiddenAt.current = null;
      if (away !== null && Date.now() - away > IDLE_LOCK_MS) {
        setUnlocked(false);
        // Kenshin M-A: never leave Change MPIN (or its check) open behind the lock.
        setScreen((sc) => (sc === 'setpin' || sc === 'pinoff' || sc === 'pinchange' ? null : sc));
      }
      syncNow();
    };
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') back();
      else if (hiddenAt.current === null) hiddenAt.current = Date.now();
    });
    // bfcache: a page restored from back/forward memory counts as coming back (Kenshin v3 M6).
    const shown = (e: any) => {
      if (e?.persisted) back();
    };
    if (Platform.OS === 'web') window.addEventListener('pageshow', shown);
    const on = () => {
      setOnline(true);
      syncNow();
    };
    const off = () => setOnline(false);
    if (Platform.OS === 'web') {
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
    }
    return () => {
      sub.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('pageshow', shown);
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      }
    };
  }, [syncNow]);

  // Keep today's rates fresh (display only) when the display currency has some cross-currency entries.
  useEffect(() => {
    if (!online || expenses === null) return;
    const cur = settings.currency;
    const needs = expenses.some((e) => e.currency !== cur);
    const stale = !rates || rates.base !== cur || Date.now() - rates.fetchedAt > 12 * 3600_000;
    if (!needs || !stale) return;
    fetchRates(cur)
      .then((r) => {
        setRatesState(r);
        saveRates(r);
      })
      .catch(() => {});
  }, [online, settings.currency, expenses, rates]);

  // ---------- data changes ----------
  const markChanged = useCallback(
    (ids: string[], rev: number) => {
      if (!sessionRef.current) return;
      const d = { ...dirtyRef.current };
      for (const id of ids) d[id] = rev;
      writeDirty(d);
      syncSoon();
    },
    [writeDirty, syncSoon],
  );

  const add = useCallback(
    (e: Expense) => {
      // The id is made when the pop-up opens, so a second tap can't add a twin (Kenshin v3 L10).
      if (expensesRef.current.some((x) => x.id === e.id)) return;
      const rev = Date.now();
      commit([...expensesRef.current, { ...e, rev }]);
      markChanged([e.id], rev);
    },
    [commit, markChanged],
  );

  const update = useCallback(
    (e: Expense) => {
      const rev = Date.now();
      commit(expensesRef.current.map((x) => (x.id === e.id ? { ...e, rev } : x)));
      markChanged([e.id], rev);
    },
    [commit, markChanged],
  );

  const remove = useCallback(
    (id: string) => {
      if (!sessionRef.current) {
        commit(expensesRef.current.filter((e) => e.id !== id)); // never been online: just forget it
        return;
      }
      const rev = Date.now();
      commit(expensesRef.current.map((e) => (e.id === id ? { ...e, deleted: true, rev } : e)));
      markChanged([id], rev);
    },
    [commit, markChanged],
  );

  const setSettings = useCallback(
    (next: Settings) => {
      const s = { ...next, pinned: cleanPinned(next.pinned, next.categories) }; // a removed name drops its pin
      settingsRef.current = s;
      setSettingsState(s);
      onLook(s);
      saveSettings(s);
      if (sessionRef.current) {
        setSettingsDirty(true);
        syncSoon();
      }
    },
    [syncSoon, onLook],
  );

  const addLabel = useCallback(
    (l: PayLabel) => setSettings({ ...settingsRef.current, paymentLabels: cleanLabels([...settingsRef.current.paymentLabels, l]) }),
    [setSettings],
  );

  /** A named Other kept as a tile (Joe v3.1): same list, same rules as Settings → Categories. */
  const addCategory = useCallback(
    (c: string) => {
      const next = cleanCategories([...settingsRef.current.categories, c]);
      if (next.length > settingsRef.current.categories.length) setSettings({ ...settingsRef.current, categories: next });
    },
    [setSettings],
  );

  const togglePin = useCallback(
    (n: string) => {
      const s = settingsRef.current;
      setSettings({ ...s, pinned: s.pinned.includes(n) ? s.pinned.filter((p) => p !== n) : [...s.pinned, n] });
    },
    [setSettings],
  );

  const removeCategory = useCallback(
    (n: string) => {
      const s = settingsRef.current;
      setSettings({ ...s, categories: s.categories.filter((c) => c !== n) }); // past entries keep their name
    },
    [setSettings],
  );

  /**
   * Rename one of her own names (v3.1). `to` already has the list's spelling when it merges into an
   * existing name. Past entries: server first, one column (like the wallet rename), then this phone.
   */
  const renameCategory = useCallback(
    async (from: string, to: string, past: boolean) => {
      if (past && sessionRef.current) await renameCategoryOnServer(from, to);
      if (past) commit(expensesRef.current.map((e) => (e.kind === 'expense' && e.category === from ? { ...e, category: to } : e)));
      const s = settingsRef.current;
      // cleanCategories drops a built-in name and any duplicate, so a merge leaves one entry.
      const categories = cleanCategories(s.categories.map((c) => (c === from ? to : c)));
      setSettings({ ...s, categories, pinned: s.pinned.map((p) => (p === from ? to : p)) });
      if (past && sessionRef.current) syncSoon();
    },
    [commit, setSettings, syncSoon],
  );

  /** The new look grows as a circle out of the tapped icon (Joe v3). Instant under reduced motion. */
  const changeAppearance = useCallback(
    (a: Settings['appearance'], at?: { x: number; y: number }) => {
      const apply = () => setSettings({ ...settingsRef.current, appearance: a });
      const doc: any = Platform.OS === 'web' && typeof document !== 'undefined' ? document : null;
      if (prefersReducedMotion() || !at || !doc) {
        apply();
        return;
      }
      const x = at.x || window.innerWidth - 60;
      const y = at.y || window.innerHeight / 2;
      const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      if (!doc.startViewTransition) {
        // The colour we're leaving: the veil starts as the old screen's background.
        setReveal({ x, y, end, color: t.bg, key: Date.now() });
        apply();
        return;
      }
      // react-dom ships with the web build (react-native-web renders through it); no new package needed.
      const { flushSync } = require('react-dom') as { flushSync: (fn: () => void) => void };
      const vt = doc.startViewTransition(() => flushSync(apply));
      vt.ready
        .then(() =>
          doc.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
            { duration: 600, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
          ),
        )
        .catch(() => {});
    },
    [setSettings, t.bg],
  );

  /** Wallet rename: server first (one column), then this phone's copies without marking them to upload (Kenshin M11). */
  const renameLabel = useCallback(
    async (from: string, to: string) => {
      if (sessionRef.current) await renamePaidWith(from, to);
      commit(expensesRef.current.map((e) => (e.paidWith === from ? { ...e, paidWith: to } : e)));
      if (sessionRef.current) syncSoon();
    },
    [commit, syncSoon],
  );

  // ---------- accounts ----------
  const sendCode = (create: boolean) => async (email: string, captchaToken?: string) => {
    if (!supabase) throw new Error('offline');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: create, captchaToken } });
    if (error) throw error;
  };

  /** Verify the code; returns the signed-in user id. Protects the phone's data (Kenshin L2, H1). */
  const verifyCode = async (email: string, code: string): Promise<string> => {
    const { data, error } = await supabase!.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
    const newUser = data.user?.id ?? '';
    const lu = await loadLastUser();
    if (lu && lu !== newUser) {
      // Someone else's entries are still on this device: never upload them into this account.
      await clearSyncState();
      await clearPin();
      await clearAccountPinState();
      setPinRecord('none');
      commit([]);
      writeDirty({});
    } else if (!lu) {
      // First sign-in on this phone: what's here goes up INSERT-ONLY, so it can never overwrite or
      // resurrect rows the account already has (Kenshin M-C). Local lists win on a first sign-in (L-c).
      const local = expensesRef.current.filter((e) => !e.deleted);
      if (local.length) {
        pushNewOnly(local, newUser).catch(() => {
          const d: Dirty = { ...dirtyRef.current };
          for (const e of local) d[e.id] = e.rev ?? Date.now();
          writeDirty(d);
        });
      }
      const st = settingsRef.current;
      if (st.categories.length || JSON.stringify(st.paymentLabels) !== JSON.stringify(DEFAULT_SETTINGS.paymentLabels)) {
        await setSettingsDirty(true);
      }
    }
    // Same person back (after a lockout or an expired session): leave the pending list exactly as it
    // is. Re-marking everything would push stale copies over newer cloud edits (Kenshin M-C).
    await saveLastUser(newUser);
    await AsyncStorage.setItem(LAST_EMAIL_KEY, email);
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    setLastUser(newUser);
    lastUserRef.current = newUser;
    setLastEmail(email);
    setOnboarded(true);
    // Audit H-1: forget this phone's MPIN copy (and its offline tries) BEFORE the new session exists.
    // It gets rewritten at the next online check.
    await clearVerifier();
    sessionRef.current = data.session;
    setSession(data.session);
    return newUser;
  };

  /** Removes this account from the phone entirely (sign out, "Use another account"). */
  const wipe = async (toWelcome: boolean) => {
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await clearSyncState();
    await clearPin();
    await clearAccountPinState();
    await AsyncStorage.removeItem(LAST_EMAIL_KEY);
    setPinRecord('none');
    setLastUser(null);
    lastUserRef.current = null;
    setLastEmail(null);
    writeDirty({});
    commit([]);
    setSettings({ ...DEFAULT_SETTINGS, appearance: settingsRef.current.appearance, colorTheme: settingsRef.current.colorTheme });
    setSyncedThisSession(false);
    setRejected(0);
    setScreen(null);
    setTab('log');
    if (toWelcome) {
      await AsyncStorage.removeItem(ONBOARDED_KEY);
      setOnboarded(false);
    }
  };

  const refreshPin = async () => setPinRecord(await readPinView(lastUserRef.current));

  /** 5 wrong on any phone: sign out here but KEEP lastUser, data hidden (v2 H1/H2 rules, Kenshin v3 M5). */
  const lockout = async () => {
    await markLockedOut(lastUserRef.current);
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    // Audit L-1: offline with an expired token, signOut returns without removing the stored session.
    const stale = (await AsyncStorage.getAllKeys()).filter((k) => /^sb-.+-auth-token$/.test(k));
    if (stale.length) await AsyncStorage.multiRemove(stale);
    sessionRef.current = null;
    setSession(null);
    setUnlocked(false);
    await refreshPin();
  };

  const myEmail = () => sessionRef.current?.user.email ?? lastEmail ?? '';

  /** Lock screen. Online: the server decides, and a definite answer is final. Offline only: this phone's copy. */
  const onPinResult = async (p: string): Promise<PinTry> => {
    const uid = lastUserRef.current;
    if (!uid) return 'locked';
    const mine = await loadVerifier(uid);
    if (mine !== 'none' && mine !== 'corrupt' && mine.lockedOut) {
      await lockout(); // audit L-1: locked here means locked, online or not; only the email code clears it
      return 'locked';
    }
    // Audit L-2: the server's answer only counts for THIS phone's account.
    if (sessionRef.current && sessionRef.current.user.id === uid && online) {
      const res = await pinVerify(p);
      if (res !== 'network' && res.result === 'error') return 'offline'; // audit L-3: never a free local retry
      if (res !== 'network') {
        if (res.result === 'ok' && res.epoch) {
          await writeVerifier(p, uid, myEmail(), res.epoch);
          await saveKnown({ uid, enabled: true, epoch: res.epoch });
          await clearPin(); // any v2 record is superseded by the account MPIN
          await refreshPin();
          setUnlocked(true);
          return 'ok';
        }
        if (res.result === 'wrong') return { left: res.tries_left ?? 0 };
        if (res.result === 'locked') {
          await lockout();
          return 'locked';
        }
        // 'none': the account has no MPIN yet. A v2 per-phone MPIN here gets checked, then claimed (M4).
        const legacy = await loadPin(uid);
        if (legacy !== 'none' && legacy !== 'corrupt') {
          const lr = await tryPin(p, uid);
          await refreshPin();
          if (lr === 'wrong') return { left: MAX_TRIES - ((await loadPin(uid)) as { fails: number }).fails };
          if (lr === 'locked') {
            await lockout();
            return 'locked';
          }
          const c = await pinClaim(p);
          if (c !== 'network' && c.result === 'set' && c.epoch) {
            await writeVerifier(p, uid, myEmail(), c.epoch);
            await saveKnown({ uid, enabled: true, epoch: c.epoch });
            await clearPin();
          } else if (c !== 'network' && c.result === 'exists') {
            // Another phone claimed first. She just proved this phone's old MPIN, so this session opens
            // and isn't counted as wrong; the next fresh open asks the account's MPIN (M4).
            await saveKnown({ uid, enabled: true, epoch: null });
            await clearPin();
          }
          // Audit M-1: network/error/weak keep the old MPIN, so the next open simply tries the claim again.
          await refreshPin();
          setUnlocked(true);
          return 'ok';
        }
        // No MPIN anywhere any more (turned off on another phone).
        await clearVerifier();
        await saveKnown({ uid, enabled: false, epoch: null });
        await refreshPin();
        setUnlocked(true);
        return 'ok';
      }
    }
    // No network (or it failed): this phone's copy, never after a definite server answer (1.4 rule 2).
    if ((await loadVerifier(uid)) !== 'none') {
      const lr = await localCheck(p, uid);
      await refreshPin();
      if (lr === 'ok') {
        setUnlocked(true);
        return 'ok';
      }
      if (lr === 'stale') return 'offline';
      if (lr === 'locked') {
        await lockout();
        return 'locked';
      }
      const v = await loadVerifier(uid);
      return { left: v === 'none' || v === 'corrupt' ? 0 : MAX_TRIES - v.fails };
    }
    const legacy = await loadPin(uid);
    if (legacy !== 'none' && legacy !== 'corrupt') {
      const lr = await tryPin(p, uid);
      await refreshPin();
      if (lr === 'ok') {
        setUnlocked(true);
        return 'ok';
      }
      if (lr === 'locked') {
        await lockout();
        return 'locked';
      }
      return { left: MAX_TRIES - ((await loadPin(uid)) as { fails: number }).fails };
    }
    return 'offline'; // an MPIN exists on the account, and this phone has never checked it online
  };

  /** Settings → Change / Turn off: current MPIN first, checked by the SERVER in the same call (Kenshin H2). */
  const onVerifyCurrent = async (p: string, off: boolean): Promise<PinTry> => {
    const uid = lastUserRef.current;
    if (!uid || !online) return 'offline';
    const res = off ? await pinDisable(p) : await pinVerify(p);
    if (res === 'network' || res.result === 'error') return 'offline';
    if (res.result === 'wrong') return { left: res.tries_left ?? 0 };
    if (res.result === 'locked') {
      await lockout();
      setScreen(null);
      return 'locked';
    }
    if (res.result === 'none' && (await loadPin(uid)) !== 'none') {
      // Only a v2 per-phone MPIN exists (not migrated yet): check it on this phone.
      const lr = await tryPin(p, uid);
      if (lr === 'wrong') return { left: MAX_TRIES - ((await loadPin(uid)) as { fails: number }).fails };
      if (lr === 'locked') {
        await lockout();
        setScreen(null);
        return 'locked';
      }
    }
    if (off) {
      await clearPin();
      await clearVerifier();
      await saveKnown({ uid, enabled: false, epoch: res.result === 'ok' ? res.epoch ?? null : null });
      await refreshPin();
      setScreen(null);
    } else {
      oldPin.current = res.result === 'ok' ? p : null;
      pinMode.current = res.result === 'ok' ? 'change' : 'create';
      setScreen('setpin');
    }
    return 'ok';
  };

  /** Create, change or reset: the server says yes before this phone stores anything. */
  const onNewPin = async (p: string): Promise<string | null> => {
    const s = sessionRef.current;
    const uid = s?.user.id ?? null;
    if (!s || !uid) return 'Sign in first.';
    if (!online) return 'Needs internet, so every phone gets the same MPIN.';
    const mode = pinMode.current;
    const res = mode === 'change' && oldPin.current ? await pinChange(oldPin.current, p) : mode === 'reset' ? await pinResetWithCode(p) : await pinClaim(p);
    if (res === 'network' || res.result === 'error') return 'Couldn’t reach the server. Check your internet and try again.';
    if (res.result === 'weak') return 'That one’s too easy to guess. Try another.';
    if (res.result === 'stale_code') {
      // Audit L-5: no dead end. Back to Forgot MPIN for a fresh code.
      setUnlocked(false);
      setScreen('forgot');
      return null;
    }
    if (res.result === 'exists') {
      // Another phone set the account's MPIN first: use that one.
      await saveKnown({ uid, enabled: true, epoch: null });
      await refreshPin();
      setUnlocked(false);
      setScreen(null);
      return null;
    }
    if (res.result === 'wrong' || res.result === 'locked') {
      if (res.result === 'locked') await lockout();
      setScreen(null);
      return null;
    }
    if (!res.epoch) return 'Something went wrong. Try again.';
    await writeVerifier(p, uid, s.user.email ?? myEmail(), res.epoch);
    await saveKnown({ uid, enabled: true, epoch: res.epoch });
    await clearPin();
    oldPin.current = null;
    await refreshPin();
    setUnlocked(true);
    setScreen(null);
    return null;
  };

  /** After an email code: does the account have an MPIN, and is it locked? */
  const afterCode = async (uid: string, fresh: boolean) => {
    let st = await pinStatus();
    if (st === 'network' || st.result === 'error') st = await pinStatus(10_000);
    if (st === 'network' || st.result === 'error') {
      // Audit M-2: couldn't ask. She just proved her email, so this session opens, but the phone
      // assumes an MPIN exists: the next fresh open checks online before opening (fails closed).
      await saveKnown({ uid, enabled: true, epoch: null });
      await refreshPin();
      setUnlocked(true);
      setScreen(null);
      return;
    }
    await saveKnown({ uid, enabled: !!st.enabled, epoch: st.epoch ?? null });
    const v = await loadVerifier(uid);
    if (v !== 'none' && (v === 'corrupt' || v.epoch !== st.epoch || v.lockedOut)) await clearVerifier();
    if (st.locked || (v !== 'none' && v !== 'corrupt' && v.lockedOut && st.enabled)) {
      // Locked out: the code she just used lets her set a NEW MPIN; no skipping (Kenshin H2).
      pinMode.current = 'reset';
      setUnlocked(true);
      setScreen('setpin');
    } else if (st.enabled && fresh) {
      // A phone new to this account: ask for the SAME MPIN, not a new one (Joe v3).
      setUnlocked(false);
      setScreen(null);
    } else if (!st.enabled && pinSupported()) {
      pinMode.current = 'create';
      setUnlocked(true);
      setScreen('setpin');
    } else {
      setUnlocked(true);
      setScreen(null);
    }
    await refreshPin();
  };

  // Every fresh open with a network: learn about changes made on other phones (Kenshin 1.4 rule 4).
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid || !online || uid !== lastUser) return;
    let gone = false;
    (async () => {
      const st0 = await pinStatus();
      if (gone || st0 === 'network' || st0.result === 'error') return;
      // Audit H-1: a session that just came from an email code may reset; never sign it out for being
      // locked, and never report old offline tries on top of it.
      if (!st0.can_reset) {
        const flushed = await flushOfflineFails(uid);
        if (flushed?.result === 'locked') return lockout();
      }
      const st = (await pinStatus()) as typeof st0 | 'network';
      if (gone || st === 'network' || st.result === 'error') return;
      await saveKnown({ uid, enabled: !!st.enabled, epoch: st.epoch ?? null });
      const v = await loadVerifier(uid);
      if (v !== 'none' && v !== 'corrupt' && (v.epoch !== st.epoch || !st.enabled)) await clearVerifier();
      if (st.locked && !st.can_reset) return lockout();
      await refreshPin();
    })().catch(() => {});
    return () => {
      gone = true;
    };
  }, [session?.user.id, online, lastUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the phone's Back button (Joe, after v3 went live) ----------
  const [exitHint, setExitHint] = useState(0);
  useEffect(() => startBackNav(() => setExitHint((n) => n + 1)), []);
  // History / Settings -> Log. (Sheets and pop-ups register their own, and win because they're newer.)
  useBackHandler(tab !== 'log', () => setTab('log'));
  // Sign-in, Forgot MPIN, and the MPIN screens that can be cancelled: Back = Cancel.
  const cancellable =
    screen === 'signin' || screen === 'forgot' || screen === 'pinoff' || screen === 'pinchange' || (screen === 'setpin' && pinMode.current !== 'reset');
  useBackHandler(cancellable, () => setScreen(null));
  // Setting a new MPIN after a forgotten one has no way out (Kenshin H2): Back does nothing there.
  useBackHandler(screen === 'setpin' && pinMode.current === 'reset', () => {});

  // ---------- derived ----------
  const visible = useMemo(() => (expenses ?? []).filter((e) => !e.deleted), [expenses]);
  // The Other list (v3.1): her own names, pins, and how often each is used, for "most used first".
  const catTools = useMemo<CategoryTools>(() => {
    const usage: Record<string, number> = {};
    for (const e of visible) if (e.kind === 'expense') usage[e.category] = (usage[e.category] ?? 0) + 1;
    return { list: settings.categories, pinned: settings.pinned, usage, togglePin, rename: renameCategory, remove: removeCategory };
  }, [visible, settings.categories, settings.pinned, togglePin, renameCategory, removeCategory]);
  const loadingCloud = !!session && !syncedThisSession && visible.length === 0 && online && !offline;
  const syncState: SyncState = !session
    ? 'local'
    : syncing
      ? 'saving'
      : offline || !online
        ? pending > 0
          ? 'waiting'
          : 'offline'
        : 'synced';

  // ---------- render: the gate (Kenshin 1.4) ----------
  let body: ReactNode;
  let showTabs = false;
  const pinSet = pin !== 'none';
  const fixedEmail = (pin !== 'none' && pin !== 'corrupt' ? pin.email : null) ?? lastEmail ?? session?.user.email ?? '';

  if (loadError) {
    body = (
      <View style={styles.center}>
        <T size={16} color={t.text} style={{ textAlign: 'center' }}>
          Something went wrong reading or saving your entries. Close the app and open it again.
        </T>
      </View>
    );
  } else if (!fonts || expenses === null || !sessionReady) {
    if (expenses !== null && lastUser && pin === 'none') {
      // Signed in with no MPIN: show the Log screen's shape while the session wakes up.
      showTabs = true;
      body = (
        <LogScreen t={t} expenses={[]} settings={settings} rates={rates} sync="saving" waiting={0} loading
          onSyncPress={() => {}} onAdd={() => {}} onUndo={() => {}} onEdit={() => {}} onAddLabel={() => {}} onAddCategory={() => {}} catTools={catTools} />
      );
    } else {
      body = <BrandLoader t={t} />;
    }
  } else if (screen === 'signin') {
    body = (
      <SignIn
        t={t}
        onSend={sendCode(true)}
        onVerify={async (email, code) => {
          const uid = await verifyCode(email, code);
          await afterCode(uid, true);
        }}
        onBack={() => setScreen(null)}
      />
    );
  } else if (lastUser && !session && supabase) {
    // Signed out underneath us (lockout, expired session): her data stays hidden until the code (Kenshin H2).
    body = (
      <SignIn
        t={t}
        fixedEmail={fixedEmail || undefined}
        title="Sign in again"
        intro={pin !== 'none' && pin !== 'corrupt' && pin.lockedOut ? 'Too many wrong MPIN tries. For your safety, confirm it’s you with a code.' : 'For your safety, confirm it’s you with a code sent to your email.'}
        onSend={sendCode(false)}
        onVerify={async (email, code) => {
          const uid = await verifyCode(email, code);
          await afterCode(uid, uid !== lastUser);
        }}
        extra={<Button label="Use another account" kind="text" onPress={() => setSwitchAsk(true)} t={t} style={{ marginTop: 20 }} />}
      />
    );
  } else if (session && pinSet && !unlocked) {
    if (screen === 'forgot' || pin === 'corrupt') {
      body = (
        <SignIn
          t={t}
          fixedEmail={fixedEmail || undefined}
          title="Forgot MPIN"
          intro="We’ll email a code to the address on this account. Then you can set a new MPIN."
          onSend={sendCode(false)}
          onVerify={async (email, code) => {
            const { data, error } = await supabase!.auth.verifyOtp({ email, token: code, type: 'email' });
            if (error) throw error;
            // Only after the code verifies for the SAME user (Kenshin 1.7). Then a NEW MPIN; reset never turns it off (H2).
            if (data.user?.id !== lastUser) {
              await supabase!.auth.signOut({ scope: 'local' }).catch(() => {}); // audit L-2
              throw new Error('invalid');
            }
            await clearVerifier(); // audit H-1: no old offline tries reported after this code
            sessionRef.current = data.session;
            setSession(data.session);
            pinMode.current = 'reset';
            setUnlocked(true);
            setScreen('setpin');
          }}
          onBack={pin === 'corrupt' ? undefined : () => setScreen(null)}
          backLabel="Back to MPIN"
          extra={pin === 'corrupt' ? <Button label="Use another account" kind="text" onPress={() => setSwitchAsk(true)} t={t} style={{ marginTop: 20 }} /> : undefined}
        />
      );
    } else {
      body = (
        <Lock
          maskedEmail={maskEmail(fixedEmail)}
          hint={pin.needsOnline ? 'The same MPIN you use on your other phone.' : undefined}
          onTry={onPinResult}
          onForgot={() => setScreen('forgot')}
          onSwitch={() => setSwitchAsk(true)}
        />
      );
    }
  } else if ((screen === 'pinoff' || screen === 'pinchange') && session && pin !== 'none' && pin !== 'corrupt') {
    // Current MPIN first, before turning it off or changing it (Joe v3). Wrong tries count toward the 5.
    const off = screen === 'pinoff';
    body = (
      <VerifyPin
        key={screen}
        title={off ? 'Turn off MPIN' : 'Change MPIN'}
        intro={off ? 'Enter your current MPIN first. This turns it off on all your phones.' : 'Enter your current MPIN first.'}
        onTry={(p) => onVerifyCurrent(p, off)}
        onCancel={() => setScreen(null)}
        onForgot={() => {
          setUnlocked(false);
          setScreen('forgot');
        }}
      />
    );
  } else if (screen === 'setpin' && session) {
    body = (
      <SetPin
        t={t}
        isWeak={weakPin}
        onDone={onNewPin}
        // Never unlocks anything (Kenshin M-A). A forgotten MPIN has no skip: it ends with a new one (H2).
        onSkip={pinMode.current === 'reset' ? undefined : () => setScreen(null)}
        skipLabel={pinMode.current === 'change' ? 'Cancel' : 'Skip for now'}
      />
    );
  } else if (!session && !lastUser && !onboarded) {
    body = (
      <Welcome
        t={t}
        onSignIn={() => setScreen('signin')}
        onSkip={() => {
          AsyncStorage.setItem(ONBOARDED_KEY, '1');
          setOnboarded(true);
        }}
      />
    );
  } else {
    showTabs = true;
    if (tab === 'log') {
      body = (
        <LogScreen
          t={t}
          expenses={visible}
          settings={settings}
          rates={rates}
          sync={syncState}
          waiting={pending}
          loading={loadingCloud}
          onSyncPress={() => (session ? syncNow() : setScreen('signin'))}
          onAdd={add}
          onUndo={remove}
          onEdit={setEditing}
          onAddLabel={addLabel}
          onAddCategory={addCategory}
          catTools={catTools}
        />
      );
    } else if (tab === 'history') {
      body = <HistoryScreen t={t} expenses={visible} currency={settings.currency} rates={rates} loading={loadingCloud} onEdit={setEditing} onLogFirst={() => setTab('log')} />;
    } else {
      body = (
        <SettingsScreen
          t={t}
          expenses={visible}
          allExpenses={expenses}
          settings={settings}
          onSettings={setSettings}
          online={online}
          rates={rates}
          onRates={(r) => {
            setRatesState(r);
            saveRates(r);
          }}
          account={{
            signedIn: !!session,
            email: session?.user.email ?? null,
            sync: syncState,
            waiting: pending,
            rejected,
            lastSyncAt,
            syncedThisSession,
            userId: session?.user.id ?? null,
          }}
          pinOn={pinSet}
          pinSupported={pinSupported()}
          onSetupPin={() => {
            if (pinSet) {
              setScreen('pinchange');
            } else {
              pinMode.current = 'create';
              setScreen('setpin');
            }
          }}
          onTurnOffPin={() => setScreen('pinoff')}
          onAppearance={changeAppearance}
          onRenameLabel={renameLabel}
          onSendFeedback={(kind, text) => sendFeedback(kind, text, APP_VERSION)}
          onSignIn={() => setScreen('signin')}
          onSignOut={() => wipe(false)}
          onSyncNow={syncNow}
          onMerge={(rows, asCopies) => {
            const now = Date.now();
            const fresh = rows.map((e) => ({ ...e, id: asCopies ? newId() : e.id, deleted: false, rev: now }));
            commit([...expensesRef.current, ...fresh]);
            const s = sessionRef.current;
            if (s) {
              // Insert-only: an id that already exists in the cloud is never overwritten (Kenshin M3).
              pushNewOnly(fresh, s.user.id)
                .then(({ rejected: bad }) => bad.length && setRejected((n) => n + bad.length))
                .catch(() => markChanged(fresh.map((e) => e.id), now));
            }
            return fresh.length;
          }}
          onReplace={(rows, s) => {
            const now = Date.now();
            commit(rows.map((e) => ({ ...e, rev: now })));
            setSettings(s);
          }}
        />
      );
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <View style={{ flex: 1 }}>{body}</View>
      {showTabs && <Nav t={t} tab={tab} onTab={setTab} />}
      {showTabs && editing && (
        <EditSheet
          e={editing}
          t={t}
          currency={settings.currency}
          customCategories={settings.categories}
          catTools={catTools}
          labels={settings.paymentLabels}
          onAddLabel={addLabel}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            update(e);
            setEditing(null);
          }}
          onDelete={(id) => {
            remove(id);
            setEditing(null);
          }}
        />
      )}
      <Sheet visible={switchAsk} onClose={() => setSwitchAsk(false)} t={t} title="Use another account?"
        subtitle={
          pending > 0
            ? `This removes this account’s entries from this phone. ${pending} ${pending === 1 ? 'entry hasn’t' : 'entries haven’t'} synced yet and will be lost.`
            : 'This removes this account’s entries from this phone. They stay safe in the account.'
        }>
        <Button
          label="Remove and continue"
          kind="outline"
          onPress={async () => {
            setSwitchAsk(false);
            await wipe(true);
          }}
          t={t}
        />
        <Button label="Cancel" kind="text" onPress={() => setSwitchAsk(false)} t={t} />
      </Sheet>
      {reveal && <RevealVeil key={reveal.key} x={reveal.x} y={reveal.y} end={reveal.end} color={reveal.color} onDone={() => setReveal(null)} />}
      <SavedPill t={t} show={exitHint} label="Press back again to exit" check={false} />
      <StatusBar style={t.dark || (session && pinSet && !unlocked) ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

function Nav({ t, tab, onTab }: { t: Theme; tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <View pointerEvents="box-none" style={styles.navWrap}>
      <View
        style={[
          styles.nav,
          { backgroundColor: t.nav, borderColor: t.navBorder },
          // Soft glow along the top edge, so the glass reads as floating in dark mode (Joe, v3 test round).
          { borderTopColor: t.dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.9)' },
          Platform.OS === 'web' ? ({ backdropFilter: 'blur(13px) saturate(140%)', WebkitBackdropFilter: 'blur(13px) saturate(140%)' } as any) : null,
          !t.dark && styles.navShadow,
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map(({ key, label }) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => onTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              aria-selected={on}
              style={(s: any) => [styles.tab, s.pressed && { backgroundColor: t.accentSoft }]}
            >
              <T size={15} w={on ? 'semibold' : 'medium'} color={on ? t.accent : t.muted}>{label}</T>
              <View style={[styles.tabMark, { backgroundColor: on ? t.accent : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Old-colour veil with a circular hole growing from (x, y): the new screen shows through the hole. Web only. */
function RevealVeil({ x, y, end, color, onDone }: { x: number; y: number; end: number; color: string; onDone: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t0 = performance.now();
    const dur = 560;
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3); // ease-out
      const r = e * end;
      const el = ref.current;
      if (el) {
        const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + 1.5}px)`;
        el.style.webkitMaskImage = mask;
        el.style.maskImage = mask;
        el.style.opacity = String(0.92 * (1 - e * e)); // fades while it opens, so text outside comes in too
      }
      if (p < 1) raf = requestAnimationFrame(frame);
      else onDone();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createElement('div', {
    ref,
    'aria-hidden': true,
    style: { position: 'fixed', inset: 0, backgroundColor: color, opacity: 0.92, pointerEvents: 'none', zIndex: 9999 },
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  navWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 12, alignItems: 'center' },
  nav: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 536,
    height: 60,
    borderRadius: cardRadius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  navShadow: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabMark: { height: 3, width: 18, borderRadius: 2 },
});
