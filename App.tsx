import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Lock, SetPin, SignIn, VerifyPin, Welcome } from './src/Auth';
import {
  Dirty,
  clearSyncState,
  loadDirty,
  loadLastUser,
  pull,
  push,
  pushNewOnly,
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
  cleanLabels,
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
import { MAX_TRIES, PinRecord, clearPin, loadPin, maskEmail, pinSupported, setPin, tryPin, weakPin } from './src/pin';
import { SettingsScreen } from './src/SettingsScreen';
import { AppearanceContext, Theme, cardRadius, useTheme } from './src/theme';
import { Button, PigLoader, Sheet, SyncState, T } from './src/ui';

type Tab = 'log' | 'history' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'log', label: 'Log' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];
type Screen = null | 'signin' | 'forgot' | 'setpin' | 'pinoff' | 'pinchange';

const APP_VERSION = '3.0.0';
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
  return (
    <SafeAreaProvider>
      <AppearanceContext.Provider value={appearance}>
        <Main onAppearance={setAppearance} />
      </AppearanceContext.Provider>
    </SafeAreaProvider>
  );
}

function Main({ onAppearance }: { onAppearance: (a: Settings['appearance']) => void }) {
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
  const [pin, setPinRecord] = useState<PinRecord | 'none' | 'corrupt'>('none');
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
      setPinRecord(await loadPin(lu));
      lastUserRef.current = lu;
      expensesRef.current = e;
      settingsRef.current = s;
      dirtyRef.current = d;
      saveExpenses(e).catch(() => {}); // v1 rows get their currency written down now (Kenshin L-d)
      setExpenses(e);
      setSettingsState(s);
      onAppearance(s.appearance);
      setPending(Object.keys(d).length);
      setLastUser(lu);
      setLastEmail(le);
      // Existing v1 users (data or an account already here) skip the welcome.
      setOnboarded(ob === '1' || e.length > 0 || !!lu);
      setRatesState(r);
    })().catch(() => setLoadError(true));
  }, [onAppearance]);

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
    (s: Settings) => {
      settingsRef.current = s;
      setSettingsState(s);
      onAppearance(s.appearance);
      saveSettings(s);
      if (sessionRef.current) {
        setSettingsDirty(true);
        syncSoon();
      }
    },
    [syncSoon, onAppearance],
  );

  const addLabel = useCallback(
    (l: PayLabel) => setSettings({ ...settingsRef.current, paymentLabels: cleanLabels([...settingsRef.current.paymentLabels, l]) }),
    [setSettings],
  );

  /** The new look grows as a circle out of the tapped icon (Joe v3). Instant under reduced motion. */
  const changeAppearance = useCallback(
    (a: Settings['appearance'], at?: { x: number; y: number }) => {
      const apply = () => setSettings({ ...settingsRef.current, appearance: a });
      const doc: any = Platform.OS === 'web' && typeof document !== 'undefined' ? document : null;
      if (!doc?.startViewTransition || prefersReducedMotion() || !at) {
        apply();
        return;
      }
      const x = at.x;
      const y = at.y;
      const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
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
    [setSettings],
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
    sessionRef.current = data.session;
    setSession(data.session);
    return newUser;
  };

  /** Removes this account from the phone entirely (sign out, "Use another account"). */
  const wipe = async (toWelcome: boolean) => {
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await clearSyncState();
    await clearPin();
    await AsyncStorage.removeItem(LAST_EMAIL_KEY);
    setPinRecord('none');
    setLastUser(null);
    lastUserRef.current = null;
    setLastEmail(null);
    writeDirty({});
    commit([]);
    setSettings({ ...DEFAULT_SETTINGS, appearance: settingsRef.current.appearance });
    setSyncedThisSession(false);
    setRejected(0);
    setScreen(null);
    setTab('log');
    if (toWelcome) {
      await AsyncStorage.removeItem(ONBOARDED_KEY);
      setOnboarded(false);
    }
  };

  const onPinResult = async (p: string) => {
    const r = await tryPin(p, lastUser);
    const rec = await loadPin(lastUser);
    setPinRecord(rec);
    if (r === 'ok') setUnlocked(true);
    if (r === 'locked' && supabase) {
      // 5 wrong: sign out (revokes the token when online) but KEEP lastUser + data hidden (Kenshin H1, 1.6).
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    return r;
  };

  // ---------- derived ----------
  const visible = useMemo(() => (expenses ?? []).filter((e) => !e.deleted), [expenses]);
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
          onSyncPress={() => {}} onAdd={() => {}} onUndo={() => {}} onEdit={() => {}} onAddLabel={() => {}} />
      );
    } else {
      body = (
        <View style={styles.center}>
          <PigLoader t={t} label="Opening Gastos…" />
        </View>
      );
    }
  } else if (screen === 'signin') {
    body = (
      <SignIn
        t={t}
        onSend={sendCode(true)}
        onVerify={async (email, code) => {
          await verifyCode(email, code);
          setUnlocked(true);
          setScreen(pinSupported() ? 'setpin' : null);
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
          if (uid === lastUser) {
            await clearPin();
            setPinRecord('none');
          }
          setUnlocked(true);
          setScreen(pinSupported() ? 'setpin' : null);
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
            // Only after the code verifies for the SAME user do we drop the old PIN (Kenshin 1.7).
            if (data.user?.id !== lastUser) throw new Error('invalid');
            await clearPin();
            setPinRecord('none');
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
          triesLeft={MAX_TRIES - pin.fails}
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
        triesLeft={MAX_TRIES - pin.fails}
        onTry={async (p) => {
          const r = await onPinResult(p);
          if (r === 'ok') {
            if (off) {
              await clearPin();
              setPinRecord('none');
              setScreen(null);
            } else {
              setScreen('setpin');
            }
          } else if (r === 'locked') {
            setUnlocked(false);
            setScreen(null);
          }
          return r;
        }}
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
        onDone={async (p) => {
          await setPin(p, session.user.id, session.user.email ?? fixedEmail);
          setPinRecord(await loadPin(session.user.id));
          setUnlocked(true);
          setScreen(null);
        }}
        onSkip={() => setScreen(null)} // never unlocks anything (Kenshin M-A)
        skipLabel={pinSet ? 'Cancel' : 'Skip for now'}
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
          onSetupPin={() => setScreen(pinSet ? 'pinchange' : 'setpin')}
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
