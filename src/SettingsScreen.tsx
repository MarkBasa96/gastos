import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronDown,
  ChevronRight,
  CloudCheck,
  CloudOff,
  FileDown,
  FileUp,
  Lock,
  MessageSquareHeart,
  Pencil,
  Send,
  Moon,
  Plus,
  RefreshCw,
  Share,
  Smartphone,
  Sun,
  SunMoon,
  WifiOff,
  X,
} from './lucide';
import { createElement, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { exportBackup, pickBackupFile } from './backup';
import {
  CATEGORIES,
  Expense,
  PayGroup,
  PayLabel,
  Rates,
  SHORT_MONTHS,
  Settings,
  cleanCategories,
  currencySymbol,
  fetchRates,
  fromBackup,
  localDate,
  parseLocalDate,
  sumIn,
  toBackup,
  validLabel,
} from './data';
import { play } from './fx';
import { payIcon } from './icons';
import { ConfirmDialog, Switch } from './motion';
import { SavedPill, SentCelebration } from './celebrate';
import { ConvertSheet, CurrencySheet } from './sheets';
import { Theme } from './theme';
import { Button, Card, Field, IconTile, Label, Row, Segmented, Sheet, SyncState, T } from './ui';

const LAST_BACKUP_KEY = 'gastos.v1.lastBackup';

export type FeedbackKind = 'broken' | 'idea' | 'other';

export type Account = {
  signedIn: boolean;
  email: string | null;
  sync: SyncState;
  waiting: number;
  rejected: number;
  lastSyncAt: number | null;
  syncedThisSession: boolean;
  userId: string | null;
};

function fmtDay(iso: string): string {
  const d = parseLocalDate(iso);
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function span(list: Expense[]): string {
  if (!list.length) return 'Nothing yet';
  const dates = list.map((e) => e.date).sort();
  return `${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}`;
}

function ago(ms: number | null): string {
  if (!ms) return 'not yet';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

export function SettingsScreen({
  t,
  expenses,
  allExpenses,
  settings,
  onSettings,
  account,
  online,
  rates,
  onRates,
  pinOn,
  pinSupported,
  onSetupPin,
  onTurnOffPin,
  onAppearance,
  onRenameLabel,
  onSendFeedback,
  onSignIn,
  onSignOut,
  onSyncNow,
  onMerge,
  onReplace,
}: {
  t: Theme;
  expenses: Expense[];
  allExpenses: Expense[];
  settings: Settings;
  onSettings: (s: Settings) => void;
  account: Account;
  online: boolean;
  rates: Rates | null;
  onRates: (r: Rates) => void;
  pinOn: boolean;
  pinSupported: boolean;
  onSetupPin: () => void;
  onTurnOffPin: () => void;
  onAppearance: (a: Settings['appearance'], at?: { x: number; y: number }) => void;
  onRenameLabel: (from: string, to: string) => Promise<void>;
  onSendFeedback: (kind: FeedbackKind, body: string) => Promise<'ok' | 'slow_down' | 'error'>;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
  onSyncNow: () => void;
  onMerge: (rows: Expense[], asCopies: boolean) => number;
  onReplace: (rows: Expense[], s: Settings) => void;
}) {
  const [curSheet, setCurSheet] = useState(false);
  const [convertTo, setConvertTo] = useState<string | null>(null);
  const [pendingRates, setPendingRates] = useState<Rates | null>(null);
  const [curErr, setCurErr] = useState<string | null>(null);
  const [backupSheet, setBackupSheet] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ rows: Expense[]; settings: Settings; owner: string | null; name: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [catSheet, setCatSheet] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [askOut, setAskOut] = useState(false);
  const [walletSheet, setWalletSheet] = useState(false);
  const [feedbackSheet, setFeedbackSheet] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const save = (s: Settings) => {
    onSettings(s);
    setSavedTick((n) => n + 1);
  };

  useEffect(() => {
    AsyncStorage.getItem(LAST_BACKUP_KEY).then(setLastBackup).catch(() => {});
  }, []);

  const monthPrefix = localDate().slice(0, 7);
  const monthSpentOriginal = useMemo(
    () => sumIn(expenses.filter((e) => e.kind === 'expense' && e.date.startsWith(monthPrefix)), settings.currency, rates).cents,
    [expenses, monthPrefix, settings.currency, rates],
  );

  async function pickCurrency(code: string) {
    setCurSheet(false);
    setCurErr(null);
    if (code === settings.currency) return;
    try {
      const r = await fetchRates(code);
      setPendingRates(r);
      setConvertTo(code);
    } catch {
      setCurErr('Couldn’t get today’s rates. Check your internet and try again.');
    }
  }

  async function makeBackup() {
    try {
      await exportBackup(toBackup(expenses, settings, account.userId));
      const d = localDate();
      await AsyncStorage.setItem(LAST_BACKUP_KEY, d);
      setLastBackup(d);
      setBackupSheet(false);
      setMsg({ text: `Backup saved with ${expenses.length} entries. Keep the file somewhere safe, like Google Drive.` });
    } catch {
      setMsg({ text: 'Could not make the backup. Please try again.', bad: true });
    }
  }

  async function pickRestore() {
    setMsg(null);
    try {
      const text = await pickBackupFile();
      if (text === null) return;
      openRestore(text);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not read that file.', bad: true });
    }
  }

  function openRestore(text: string) {
    setMsg(null);
    try {
      const parsed = fromBackup(text);
      setRestore({ rows: parsed.expenses, settings: parsed.settings, owner: parsed.owner, name: 'Backup file' });
      setMode('merge');
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not read that file.', bad: true });
    }
  }

  // "Add what's missing": compare against ALL local rows, deleted ones included (Kenshin M3).
  const localIds = useMemo(() => new Set(allExpenses.map((e) => e.id)), [allExpenses]);
  const restoreLive = restore ? restore.rows.filter((e) => !e.deleted) : [];
  const foreign = !!(restore && restore.owner && account.userId && restore.owner !== account.userId);
  const missing = restore ? (foreign ? restoreLive : restoreLive.filter((e) => !localIds.has(e.id))) : [];
  const mergeBlocked = account.signedIn && !account.syncedThisSession;

  function doRestore() {
    if (!restore) return;
    if (mode === 'replace') {
      onReplace(restore.rows, { ...restore.settings, appearance: settings.appearance });
      setMsg({ text: `Restored ${restoreLive.length} entries from the file.` });
    } else {
      const n = onMerge(missing, foreign);
      setMsg({ text: n ? `Added ${n} ${n === 1 ? 'entry' : 'entries'} from the file.` : 'Everything in that file is already here.' });
    }
    setRestore(null);
  }

  const syncTitle =
    account.sync === 'offline' || account.sync === 'waiting' ? 'Offline' : account.sync === 'saving' ? 'Saving…' : 'Backed up online';

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}>
      <T size={28} w="bold" color={t.text} style={styles.h1} accessibilityRole="header">
        Settings
      </T>

      {/* Account: trust first (Erina v2 §4) */}
      <Card t={t} style={styles.pad}>
        {account.signedIn ? (
          <>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <T size={16} w="semibold" color={t.text}>{syncTitle}</T>
                <T size={13} color={t.muted} style={{ marginTop: 2 }}>{account.email}</T>
              </View>
              {account.sync === 'offline' || account.sync === 'waiting' ? (
                <CloudOff size={22} color={t.muted} strokeWidth={1.8} />
              ) : (
                <CloudCheck size={22} color={t.accent} strokeWidth={1.8} />
              )}
            </View>
            <T size={13} color={t.muted} style={{ marginTop: 10, lineHeight: 18 }}>
              {account.waiting > 0
                ? `${account.waiting} ${account.waiting === 1 ? 'entry is' : 'entries are'} saved on this phone and will back up by themselves when you’re online.`
                : `Last synced ${ago(account.lastSyncAt)}. Every entry saves to your phone first, then here.`}
            </T>
            {account.rejected > 0 && (
              <T size={13} color={t.danger} style={{ marginTop: 8 }}>
                {account.rejected === 1 ? '1 entry' : `${account.rejected} entries`} couldn’t be saved online (the details weren’t accepted). {account.rejected === 1 ? 'It stays' : 'They stay'} on this phone.
              </T>
            )}
            {account.waiting > 0 && online && (
              <Button label="Sync now" kind="text" icon={RefreshCw} onPress={onSyncNow} t={t} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
            )}
          </>
        ) : (
          <>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <T size={16} w="semibold" color={t.text}>On this phone only</T>
                <T size={13} color={t.muted} style={{ marginTop: 2, lineHeight: 18 }}>
                  Sign in so a lost phone doesn’t lose your entries, and see them on any phone.
                </T>
              </View>
              <Smartphone size={22} color={t.muted} strokeWidth={1.8} />
            </View>
            <Button label="Sign in to back up" onPress={onSignIn} t={t} style={{ marginTop: 12 }} />
          </>
        )}
      </Card>

      {account.signedIn && pinSupported && (
        <>
          <Label t={t} style={styles.section}>Security</Label>
          <Card t={t}>
            <Row t={t} first onPress={onSetupPin} label={pinOn ? 'Change MPIN' : 'Set up MPIN'}>
              <IconTile icon={Lock} t={t} tint={pinOn} />
              <View style={{ flex: 1 }}>
                <T size={16} color={t.text}>{pinOn ? 'Change MPIN' : 'Set up MPIN'}</T>
                <T size={13} color={t.muted}>{pinOn ? 'Asks for your current MPIN first' : 'One 4-digit PIN for all your phones'}</T>
              </View>
              <ChevronRight size={18} color={t.muted} />
            </Row>
            {pinOn && (
              <Row t={t} onPress={onTurnOffPin} label="Turn off MPIN">
                <T size={16} color={t.text} style={{ flex: 1 }}>Turn off MPIN</T>
                <ChevronRight size={18} color={t.muted} />
              </Row>
            )}
          </Card>
          {pinOn && (
            <T size={13} color={t.muted} style={{ marginTop: 8, lineHeight: 18 }}>
              One MPIN for all your phones. It asks when you open Gastos fresh or after 30 minutes away, not when you switch apps.
            </T>
          )}
        </>
      )}

      <Label t={t} style={styles.section}>Preferences</Label>
      <Card t={t}>
        <Row t={t} first>
          <View style={{ flex: 1 }}>
            <T size={16} color={t.text}>Appearance</T>
            <T size={13} color={t.muted}>
              {settings.appearance === 'system' ? 'Auto follows your phone' : settings.appearance === 'light' ? 'Always light' : 'Always dark'}
            </T>
          </View>
          <Segmented
            t={t}
            value={settings.appearance}
            onChange={(a, at) => onAppearance(a, at)}
            options={[
              { value: 'system', label: 'Auto', icon: SunMoon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
            ]}
          />
        </Row>
        <Row t={t}>
          <View style={{ flex: 1, opacity: online ? 1 : 0.55 }}>
            <T size={16} color={t.text}>Currency</T>
            {online ? (
              <T size={13} color={t.muted}>Converts amounts at today’s rate</T>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <WifiOff size={13} color={t.muted} />
                <T size={13} color={t.muted}>Needs internet to change</T>
              </View>
            )}
          </View>
          <Pressable
            onPress={() => setCurSheet(true)}
            disabled={!online}
            accessibilityRole="button"
            accessibilityLabel={`Currency: ${settings.currency}${online ? '' : '. Needs internet to change'}`}
            style={[styles.dropdown, { borderColor: t.border, backgroundColor: t.surface, opacity: online ? 1 : 0.45 }]}
          >
            <T size={16} w="semibold" color={t.text}>{currencySymbol(settings.currency)} {settings.currency}</T>
            {online ? <ChevronDown size={16} color={t.muted} /> : <Lock size={14} color={t.muted} />}
          </Pressable>
        </Row>
        <Row t={t}>
          <View style={{ flex: 1 }}>
            <T size={16} color={t.text}>Sounds</T>
            <T size={13} color={t.muted}>Coin clink when you save</T>
          </View>
          <Switch t={t} label="Sounds" value={settings.sounds} onChange={(v) => save({ ...settings, sounds: v })} />
        </Row>
      </Card>
      {curErr && <T size={13} color={t.danger} style={{ marginTop: 8 }}>{curErr}</T>}
      {!online && (
        <T size={13} color={t.muted} style={{ marginTop: 8, lineHeight: 18 }}>
          Amounts still show in {settings.currency} while offline. Only switching currency waits for the internet, because it needs today’s rate.
        </T>
      )}

      <Label t={t} style={styles.section}>Your data</Label>
      <Card t={t}>
        <Row t={t} first onPress={() => setCatSheet(true)} label="Categories">
          <T size={16} color={t.text} style={{ flex: 1 }}>Categories</T>
          <T size={13} color={t.muted}>{CATEGORIES.length}{settings.categories.length ? ` + ${settings.categories.length} yours` : ' + yours'}</T>
          <ChevronRight size={18} color={t.muted} />
        </Row>
        <Row t={t} onPress={() => setWalletSheet(true)} label="Cards and e-wallets">
          <T size={16} color={t.text} style={{ flex: 1 }}>Cards and e-wallets</T>
          <View style={[styles.badge, { backgroundColor: t.accent }]}>
            <T size={11} w="bold" color={t.accentText} style={{ letterSpacing: 0.3 }}>NEW</T>
          </View>
          <T size={13} color={t.muted}>{settings.paymentLabels.length}</T>
          <ChevronRight size={18} color={t.muted} />
        </Row>
        <Row t={t} onPress={() => setBackupSheet(true)} label="Back up to a file">
          <T size={16} color={t.text} style={{ flex: 1 }}>Back up to a file</T>
          <ChevronRight size={18} color={t.muted} />
        </Row>
        {Platform.OS === 'web' ? (
          <View>
            <Row t={t} label="Restore from a file">
              <T size={16} color={t.text} style={{ flex: 1 }}>Restore from a file</T>
              <ChevronRight size={18} color={t.muted} />
            </Row>
            {createElement('input', {
              type: 'file',
              'aria-label': 'Restore from a file',
              title: 'Restore from a file',
              onClick: (e: any) => {
                e.currentTarget.value = ''; // the same file twice in a row still fires onChange
              },
              onChange: (e: any) => {
                const file: File | undefined = e.currentTarget.files?.[0];
                if (!file) return;
                file.text().then(openRestore, () => setMsg({ text: 'Could not read that file.', bad: true }));
              },
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 0 },
            })}
          </View>
        ) : (
          <Row t={t} onPress={pickRestore} label="Restore from a file">
            <T size={16} color={t.text} style={{ flex: 1 }}>Restore from a file</T>
            <ChevronRight size={18} color={t.muted} />
          </Row>
        )}
      </Card>
      {msg && <T size={14} color={msg.bad ? t.danger : t.text} style={{ marginTop: 10 }} accessibilityLiveRegion="polite">{msg.text}</T>}

      {account.signedIn && (
        <>
          <Label t={t} style={styles.section}>Help</Label>
          <Card t={t}>
            <Row t={t} first onPress={online ? () => setFeedbackSheet(true) : undefined} label={online ? 'Send feedback' : 'Send feedback. Needs internet to send'}>
              <View style={{ opacity: online ? 1 : 0.5 }}>
                <MessageSquareHeart size={20} color={t.muted} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1, opacity: online ? 1 : 0.5 }}>
                <T size={16} color={t.text}>Send feedback</T>
                {online ? (
                  <T size={13} color={t.muted}>Ideas, bugs, anything</T>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <WifiOff size={13} color={t.muted} />
                    <T size={13} color={t.muted}>Needs internet to send</T>
                  </View>
                )}
              </View>
              <View style={{ opacity: online ? 1 : 0.5 }}>
                <ChevronRight size={18} color={t.muted} />
              </View>
            </Row>
          </Card>
          <Button label="Sign out" kind="text" onPress={() => setAskOut(true)} t={t} style={{ marginTop: 16, alignSelf: 'center', paddingHorizontal: 32, borderColor: t.border, borderRadius: 12 }} />
          <T size={12} color={t.muted} style={{ textAlign: 'center' }}>
            Signing out removes your entries from this phone. They stay safe in your account.
          </T>
        </>
      )}
      <T size={13} w="medium" color={t.muted} style={{ textAlign: 'center', marginTop: 12 }}>Gastos 3.0</T>
      <T size={12} color={t.muted} style={{ textAlign: 'center', marginTop: 2 }}>Made by Joemark Basa</T>

      {/* ---- sheets ---- */}
      <ConfirmDialog
        visible={askOut}
        t={t}
        title="Sign out of Gastos?"
        body={
          account.waiting > 0
            ? `${account.waiting} ${account.waiting === 1 ? 'entry hasn’t' : 'entries haven’t'} synced yet and will be lost. To sign back in, we’ll email you a 6-digit code.`
            : 'Everything is backed up online. To sign back in, we’ll email you a 6-digit code.'
        }
        action={account.waiting > 0 ? `Sign out, lose ${account.waiting}` : 'Sign out'}
        danger
        onCancel={() => setAskOut(false)}
        onConfirm={() => {
          setAskOut(false);
          onSignOut();
        }}
      />
      <WalletsSheet
        visible={walletSheet}
        onClose={() => setWalletSheet(false)}
        t={t}
        labels={settings.paymentLabels}
        online={online}
        signedIn={account.signedIn}
        onChange={(labels) => save({ ...settings, paymentLabels: labels })}
        savedTick={savedTick}
        onRename={onRenameLabel}
      />
      {feedbackSheet && (
        <FeedbackSheet
          t={t}
          email={account.email}
          online={online}
          onClose={() => setFeedbackSheet(false)}
          onSend={onSendFeedback}
          onSent={() => {
            setFeedbackSheet(false);
            setCelebrate(true);
          }}
        />
      )}
      <CurrencySheet visible={curSheet} onClose={() => setCurSheet(false)} t={t} value={settings.currency} onPick={pickCurrency} />
      <ConvertSheet
        visible={!!convertTo}
        onClose={() => setConvertTo(null)}
        t={t}
        from={settings.currency}
        to={convertTo ?? settings.currency}
        monthCents={monthSpentOriginal}
        rates={pendingRates}
        onConfirm={() => {
          if (!convertTo || !pendingRates) return;
          onRates(pendingRates);
          save({ ...settings, currency: convertTo });
          setConvertTo(null);
        }}
      />

      <Sheet visible={backupSheet} onClose={() => setBackupSheet(false)} t={t} title="Back up to a file"
        subtitle="A copy of everything, saved as one file. Useful if you ever change phones without signing in.">
        <Card t={t} style={[styles.pad, styles.fileRow]}>
          <IconTile icon={FileDown} t={t} tint />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={15} w="semibold" color={t.text} numberOfLines={1}>gastos-backup-{localDate()}.json</T>
            <T size={13} color={t.muted} num>{expenses.length} {expenses.length === 1 ? 'entry' : 'entries'} · {span(expenses)}</T>
          </View>
        </Card>
        <T size={13} color={t.muted} style={{ marginTop: 8 }}>Last backup: {lastBackup ? fmtDay(lastBackup) : 'never'}</T>
        <Button label="Save backup file" icon={Share} onPress={makeBackup} t={t} disabled={!expenses.length} style={{ marginTop: 16 }} />
        <T size={13} color={t.muted} style={{ textAlign: 'center', marginTop: 10 }}>
          Your phone asks where to put it. Google Drive or Files is a good spot.
        </T>
      </Sheet>

      <Sheet visible={!!restore} onClose={() => setRestore(null)} t={t} title="Restore from a file">
        {restore && (
          <>
            <Card t={t} style={[styles.pad, styles.fileRow]}>
              <IconTile icon={FileUp} t={t} tint />
              <View style={{ flex: 1 }}>
                <T size={15} w="semibold" color={t.text}>{restoreLive.length} {restoreLive.length === 1 ? 'entry' : 'entries'}</T>
                <T size={13} color={t.muted}>{span(restoreLive)}</T>
              </View>
            </Card>
            {foreign && (
              <T size={13} color={t.warning} style={{ marginTop: 10, lineHeight: 18 }}>
                This backup is from another account. Its entries will be added as your own copies.
              </T>
            )}
            <Label t={t} style={{ marginTop: 14 }}>How should it restore?</Label>
            <Choice
              t={t}
              on={mode === 'merge'}
              onPress={() => setMode('merge')}
              title="Add what’s missing"
              body={`Keeps all ${expenses.length} on this phone and adds the ${missing.length} from the file that aren’t here.`}
            />
            <Choice
              t={t}
              on={mode === 'replace'}
              disabled={account.signedIn}
              onPress={() => setMode('replace')}
              title="Replace everything"
              body={
                account.signedIn
                  ? 'Only when signed out, so your phone and your account never drift apart.'
                  : `The ${expenses.length} entries on this phone are replaced by the file’s ${restoreLive.length}.`
              }
              danger={!account.signedIn}
            />
            {mode === 'merge' && mergeBlocked && (
              <T size={13} color={t.warning} style={{ marginTop: 10 }}>
                Waiting for your first sync, so nothing gets overwritten. {online ? 'One moment, then try again.' : 'Connect to the internet first.'}
              </T>
            )}
            <Button
              label={mode === 'replace' ? `Replace with ${restoreLive.length}` : missing.length ? `Add ${missing.length} ${missing.length === 1 ? 'entry' : 'entries'}` : 'Nothing new to add'}
              kind={mode === 'replace' ? 'outline' : 'primary'}
              onPress={doRestore}
              t={t}
              disabled={mode === 'merge' ? !missing.length || mergeBlocked : false}
              style={{ marginTop: 16 }}
            />
          </>
        )}
      </Sheet>

      <Sheet visible={catSheet} onClose={() => setCatSheet(false)} t={t} title="Categories"
        subtitle="The 8 built-in ones always stay. Add your own; they appear after them when you log.">
        <Card t={t}>
          {settings.categories.length === 0 ? (
            <Row t={t} first>
              <T size={15} color={t.muted}>No categories of your own yet.</T>
            </Row>
          ) : (
            settings.categories.map((c, i) => (
              <Row key={c} t={t} first={i === 0}>
                <T size={16} color={t.text} style={{ flex: 1 }}>{c}</T>
                <Pressable
                  onPress={() => save({ ...settings, categories: settings.categories.filter((x) => x !== c) })}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c}`}
                  hitSlop={10}
                >
                  <X size={18} color={t.muted} />
                </Pressable>
              </Row>
            ))
          )}
        </Card>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Field t={t} value={newCat} onChangeText={setNewCat} placeholder="New category, like “Pets”" maxLength={24} accessibilityLabel="New category" />
          </View>
          <Button
            label="Add"
            icon={Plus}
            onPress={() => {
              const next = cleanCategories([...settings.categories, newCat]);
              if (next.length > settings.categories.length) save({ ...settings, categories: next });
              setNewCat('');
            }}
            t={t}
            disabled={!newCat.trim() || settings.categories.length >= 50}
          />
        </View>
        <T size={13} color={t.muted} style={{ marginTop: 8 }}>
          Removing one keeps past entries as they are.
        </T>
        <SavedPill t={t} show={savedTick} inline />
      </Sheet>
    </ScrollView>
      <SavedPill t={t} show={celebrate ? 0 : savedTick} />
      {celebrate && (
        <>
          <SentCelebration t={t} onDone={() => setCelebrate(false)} />
          <SavedPill t={t} show={1} label="Feedback sent. Thank you!" />
        </>
      )}
    </View>
  );
}

function Choice({ t, on, onPress, title, body, danger, disabled }: {
  t: Theme; on: boolean; onPress: () => void; title: string; body: string; danger?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      style={[styles.choice, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface, opacity: disabled ? 0.55 : 1 }]}
    >
      <View style={[styles.radio, { borderColor: on ? t.accent : t.muted, borderWidth: on ? 6 : 2 }]} />
      <View style={{ flex: 1 }}>
        <T size={15} w="semibold" color={t.text}>{title}</T>
        <T size={13} color={danger && on ? t.danger : danger ? t.danger : t.muted} style={{ lineHeight: 18 }}>{body}</T>
      </View>
    </Pressable>
  );
}

// ---------- Cards and e-wallets: rename, change type, remove (Joe v3) ----------

function WalletsSheet({
  visible,
  onClose,
  t,
  labels,
  online,
  signedIn,
  onChange,
  onRename,
  savedTick,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  labels: PayLabel[];
  online: boolean;
  signedIn: boolean;
  onChange: (labels: PayLabel[]) => void;
  onRename: (from: string, to: string) => Promise<void>;
  savedTick: number;
}) {
  const [editing, setEditing] = useState<PayLabel | null>(null);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<PayGroup>('ewallet');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askRemove, setAskRemove] = useState(false);

  function open(l: PayLabel) {
    setEditing(l);
    setName(l.n);
    setGroup(l.g);
    setErr(null);
  }

  async function save() {
    if (!editing) return;
    const n = name.trim();
    if (n !== editing.n) {
      if (!validLabel(n)) {
        setErr(n.replace(/\D/g, '').length > 4 ? 'Just a name, please. No card or account numbers.' : 'Type a name, like “BPI Debit”.');
        return;
      }
      // Renaming into a name that exists would merge two wallets for good: refuse it (Kenshin M11).
      if (n.toLowerCase() === 'cash' || labels.some((l) => l !== editing && l.n.toLowerCase() === n.toLowerCase())) {
        setErr(`You already have one called “${n}”.`);
        return;
      }
      // Rename rewrites past entries on the server, so it needs internet when signed in (Kenshin M11).
      if (signedIn && !online) {
        setErr('Renaming needs internet, so every phone gets the new name.');
        return;
      }
      setBusy(true);
      try {
        await onRename(editing.n, n);
      } catch {
        setBusy(false);
        setErr('Couldn’t rename it. Check your internet and try again.');
        return;
      }
      setBusy(false);
    }
    onChange(labels.map((l) => (l === editing ? { n, g: group } : l)));
    setEditing(null);
  }

  const cards = labels.filter((l) => l.g === 'card');
  const wallets = labels.filter((l) => l.g === 'ewallet');
  const item = (l: PayLabel, first: boolean) => (
    <Row key={l.n} t={t} first={first} onPress={() => open(l)} label={`Edit ${l.n}`}>
      <IconTile icon={payIcon(l.n, l.g)} t={t} />
      <T size={16} w="semibold" color={t.text} style={{ flex: 1 }}>{l.n}</T>
      <Pencil size={18} color={t.muted} strokeWidth={1.8} />
    </Row>
  );

  return (
    <>
      <Sheet visible={visible && !editing} onClose={onClose} t={t} title="Cards and e-wallets" subtitle="Tap one to rename it or remove it.">
        {labels.length === 0 && <T size={15} color={t.muted}>None yet. Add one when you log, under the wallet button.</T>}
        {cards.length > 0 && (
          <>
            <Label t={t}>Cards</Label>
            <Card t={t}>{cards.map((l, i) => item(l, i === 0))}</Card>
          </>
        )}
        {wallets.length > 0 && (
          <>
            <Label t={t} style={{ marginTop: cards.length ? 14 : 0 }}>E-wallets and digital banks</Label>
            <Card t={t}>{wallets.map((l, i) => item(l, i === 0))}</Card>
          </>
        )}
        <SavedPill t={t} show={savedTick} inline />
      </Sheet>
      <Sheet visible={visible && !!editing} onClose={() => setEditing(null)} t={t} title={editing ? `Edit ${editing.n}` : 'Edit'}>
        <Label t={t}>Name</Label>
        <Field
          t={t}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setErr(null);
          }}
          maxLength={40}
          accessibilityLabel="Name"
          error={!!err}
        />
        {err && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{err}</T>}
        <Label t={t} style={{ marginTop: 14 }}>Type</Label>
        <Segmented
          t={t}
          small
          value={group === 'card' ? 'card' : 'ewallet'}
          onChange={(g) => setGroup(g)}
          options={[
            { value: 'card', label: 'Card' },
            { value: 'ewallet', label: 'E-wallet or bank' },
          ]}
        />
        <T size={13} color={t.muted} style={{ marginTop: 12, lineHeight: 18 }}>
          {signedIn && !online ? 'Renaming needs internet. Changing the type works offline.' : 'Renaming also updates your past entries with this name.'}
        </T>
        <Button label="Save changes" onPress={save} loading={busy} t={t} style={{ marginTop: 16 }} />
        <Button label={editing ? `Remove ${editing.n}` : 'Remove'} kind="danger" onPress={() => setAskRemove(true)} t={t} />
        <T size={13} color={t.muted} style={{ textAlign: 'center', lineHeight: 18 }}>
          Past entries keep the name. It just won’t show when you log.
        </T>
      </Sheet>
      <ConfirmDialog
        visible={askRemove}
        t={t}
        title={editing ? `Remove ${editing.n}?` : 'Remove?'}
        body="Past entries keep the name. It just won’t show when you log."
        action="Remove"
        danger
        onCancel={() => setAskRemove(false)}
        onConfirm={() => {
          setAskRemove(false);
          if (editing) onChange(labels.filter((l) => l !== editing));
          setEditing(null);
        }}
      />
    </>
  );
}

// ---------- Send feedback: saved online and emailed to Joe; needs internet (Joe v3, Kenshin Part 3) ----------

function FeedbackSheet({
  t,
  email,
  online,
  onClose,
  onSend,
  onSent,
}: {
  t: Theme;
  email: string | null;
  online: boolean;
  onClose: () => void;
  onSend: (kind: FeedbackKind, body: string) => Promise<'ok' | 'slow_down' | 'error'>;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [sent, setSent] = useState(false);
  const masked = email ? `${email.slice(0, 1)}•••••@${email.split('@')[1] ?? ''}` : 'your account email';

  async function send() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const r = await onSend(kind, body.trim()).catch(() => 'error' as const);
    setBusy(false);
    if (r === 'ok') {
      // Only once the server says it's in (Kenshin 3.4): whoosh as the plane takes off, chime as it lands.
      play('whoosh');
      play('chime', 2.4);
      onSent();
    } else if (r === 'slow_down') {
      setNote({ text: 'You’ve sent a few already. Please try again in an hour.', bad: true });
    } else {
      setNote({ text: 'Couldn’t send it. Check your internet and try again.', bad: true });
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      t={t}
      title={sent ? 'Sent. Thank you!' : 'Send feedback'}
      subtitle={sent ? 'It went straight to the person who makes Gastos.' : 'Goes straight to the person who makes Gastos. Every message gets read.'}
    >
      {sent ? (
        <Button label="Done" onPress={onClose} t={t} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} accessibilityRole="radiogroup">
            {([['broken', 'Something’s broken'], ['idea', 'An idea'], ['other', 'Other']] as const).map(([k, label]) => {
              const on = kind === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={(s: any) => [styles.kindChip, { borderColor: on ? t.accent : t.border, backgroundColor: on || s.pressed ? t.accentSoft : t.surface, transform: [{ scale: s.pressed ? 0.95 : 1 }] }]}
                >
                  <T size={15} w={on ? 'semibold' : 'medium'} color={t.text}>{label}</T>
                </Pressable>
              );
            })}
          </View>
          <Field
            t={t}
            value={body}
            onChangeText={(v) => setBody(v.slice(0, 2000))}
            placeholder="What’s working, what’s broken, what you wish it did"
            multiline
            textAlignVertical="top"
            style={{ minHeight: 110 }}
            accessibilityLabel="Your feedback"
          />
          <T size={13} color={t.muted} style={{ marginTop: 8 }}>Sent with {masked} so we can reply.</T>
          {note && <T size={14} color={note.bad ? t.danger : t.text} style={{ marginTop: 8 }}>{note.text}</T>}
          <Button label="Send feedback" icon={Send} onPress={send} loading={busy} disabled={!body.trim() || !online} t={t} style={{ marginTop: 16 }} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 4, paddingBottom: 110, maxWidth: 560, width: '100%', alignSelf: 'center' },
  h1: { letterSpacing: -0.4, lineHeight: 34, minHeight: 52, paddingTop: 9, marginBottom: 8 },
  pad: { padding: 16 },
  between: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  section: { marginTop: 22 },
  dropdown: { minHeight: 40, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 10 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choice: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 8, alignItems: 'flex-start' },
  radio: { width: 20, height: 20, borderRadius: 10, marginTop: 1 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  kindChip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
});
