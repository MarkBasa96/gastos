import { ArrowDownRight, ArrowUpRight, CircleAlert } from './lucide';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Expense, MONTHS, PayLabel, Rates, Settings, formatMoney, localDate, newId, parseAmount, sumIn } from './data';
import { Draft, EntryForm, EntryFormHandle, emptyDraft } from './EntryForm';
import { CoinRain } from './celebrate';
import { EntryPreview } from './ExpenseRow';
import { play } from './fx';
import { ConfirmDialog, CountUp, PigSlot, Skeleton } from './motion';
import { Theme, radius } from './theme';
import { Button, GlassHero, SyncBadge, SyncState, T } from './ui';

type Props = {
  t: Theme;
  expenses: Expense[]; // visible (not deleted)
  settings: Settings;
  rates: Rates | null;
  sync: SyncState;
  waiting: number;
  /** Signed in on a phone with nothing local yet: the first pull is still on its way. */
  loading?: boolean;
  onSyncPress: () => void;
  onAdd: (e: Expense) => void;
  onUndo: (id: string) => void;
  onEdit: (e: Expense) => void;
  onAddLabel: (l: PayLabel) => void;
  onAddCategory: (c: string) => void;
};

export function LogScreen({ t, expenses, settings, rates, sync, waiting, loading, onSyncPress, onAdd, onUndo, onAddLabel, onAddCategory }: Props) {
  const cur = settings.currency;
  // Remember the last "Paid with", so her usual wallet is one tap away (or zero).
  const last = useMemo(() => {
    const e = [...expenses].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!e || !e.paidWith) return undefined;
    const g = settings.paymentLabels.find((l) => l.n === e.paidWith)?.g;
    return g ? { paidWith: e.paidWith, group: g } : undefined;
  }, [expenses, settings.paymentLabels]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(last));
  const [saved, setSaved] = useState<Expense | null>(null);
  const [asking, setAsking] = useState<Expense | null>(null);
  const [drop, setDrop] = useState(0);
  const [rain, setRain] = useState(0); // tap the pig: the coin shower
  const form = useRef<EntryFormHandle>(null);
  const newTile = useRef<string | null>(null); // a named Other to keep as a tile, once saved

  const now = new Date();
  const monthPrefix = localDate(now).slice(0, 7);
  const month = expenses.filter((e) => e.date.startsWith(monthPrefix));
  const spent = sumIn(month.filter((e) => e.kind === 'expense'), cur, rates).cents;
  const income = sumIn(month.filter((e) => e.kind === 'income'), cur, rates).cents;
  const left = income - spent;

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 5000);
    return () => clearTimeout(timer);
  }, [saved]);

  /** Save opens the pop-up. The entry and its id are made now, so a double tap can't save twice (Kenshin L10). */
  function ask() {
    const v = form.current?.take();
    if (!v) return;
    // Let go of the keyboard first: the pop-up hands focus back to whatever had it, and that must
    // not be the Amount box, or the keyboard pops up again after every save (Joe v3).
    Keyboard.dismiss();
    if (Platform.OS === 'web') (document.activeElement as HTMLElement | null)?.blur?.();
    const cash = draft.paidWith === '' || draft.group === 'cash';
    newTile.current = v.newTile;
    setAsking({
      id: newId(),
      kind: draft.kind,
      cents: v.cents,
      category: v.category,
      note: draft.note.trim(),
      method: cash ? 'cash' : 'card',
      paidWith: cash ? '' : draft.paidWith,
      currency: cur,
      date: draft.date,
      createdAt: Date.now(),
    });
  }

  function confirm() {
    const e = asking;
    setAsking(null);
    if (!e) return;
    onAdd({ ...e, createdAt: Date.now() });
    if (newTile.current) onAddCategory(newTile.current);
    newTile.current = null;
    setSaved(e);
    setDrop((n) => n + 1); // the coin drops into the pig
    play('clink', 0.55); // lands with the coin
    // Keep "Paid with" (same wallet next time) and the Expense/Income choice; reset the rest.
    // No focusAmount(): the keyboard only opens when she taps Amount (Joe v3).
    setDraft({ ...emptyDraft({ paidWith: draft.paidWith, group: draft.group }), kind: draft.kind });
  }

  const typed = parseAmount(draft.amount);
  const cta = typed ? `Save ${formatMoney(typed, cur)}` : 'Save';
  const coin = saved ? formatMoney(saved.cents, saved.currency).replace(/\.00$/, '') : '';
  const over = left < 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <T size={18} w="bold" color={t.text} accessibilityRole="header">{MONTHS[now.getMonth()]}</T>
          <SyncBadge state={sync} waiting={waiting} t={t} onPress={onSyncPress} />
        </View>

        <GlassHero t={t}>
          <View style={styles.label}>
            <T size={14} w="semibold" color={t.text}>Left this month</T>
            {over && !loading && <CircleAlert size={15} color={t.text} strokeWidth={2} style={{ opacity: 0.75 }} />}
          </View>
          {loading ? (
            <>
              <Skeleton t={t} onGlass w={190} h={30} style={{ marginTop: 6, marginBottom: 8 }} />
              <View style={styles.sub}>
                <Skeleton t={t} onGlass w={110} h={13} />
                <Skeleton t={t} onGlass w={110} h={13} />
              </View>
            </>
          ) : (
            <>
              {/* Counts up each time Log opens (Joe v3). After a save it just updates. */}
              <CountUp cents={left} currency={cur} size={32} color={t.text} style={{ lineHeight: 38, letterSpacing: -0.6, marginTop: 2 }} />
              {over && (
                <T size={13} color={t.text} style={{ opacity: 0.8, marginTop: 2 }} num>
                  You spent {formatMoney(-left, cur)} more than came in.
                </T>
              )}
              <View style={styles.sub}>
                <View style={styles.pair}>
                  <ArrowUpRight size={15} color={t.text} strokeWidth={2.2} />
                  <T size={13} w="semibold" color={t.text} num>In {formatMoney(income, cur)}</T>
                </View>
                <View style={styles.pair}>
                  <ArrowDownRight size={15} color={t.text} strokeWidth={2.2} />
                  <T size={13} w="semibold" color={t.text} num>Out {formatMoney(spent, cur)}</T>
                </View>
              </View>
            </>
          )}
        </GlassHero>

        <View style={{ marginTop: 16 }}>
          <EntryForm
            ref={form}
            t={t}
            draft={draft}
            onChange={setDraft}
            currency={cur}
            customCategories={settings.categories}
            labels={settings.paymentLabels}
            onAddLabel={onAddLabel}
            onSubmit={ask}
            canKeep
          />
        </View>

        {/* Pig B beside Save (Joe v3) */}
        <View style={styles.saveRow}>
          <PigSlot
            t={t}
            drop={drop}
            label={coin}
            onTap={() => {
              if (rain) return; // one shower at a time
              play('coins');
              setRain((n) => n + 1);
            }}
          />
          <View style={{ flex: 1 }}>
            <Button label={cta} onPress={ask} t={t} />
          </View>
        </View>
        {saved && (
          <View style={[styles.toast, { backgroundColor: t.accentSoft, borderColor: t.accent }]} accessibilityLiveRegion="polite">
            <T size={15} color={t.text} style={{ flex: 1 }}>
              Saved {formatMoney(saved.cents, saved.currency)} {saved.kind === 'income' ? 'from' : 'for'} {saved.category}.
            </T>
            <T
              size={15}
              w="bold"
              color={t.accent}
              onPress={() => {
                onUndo(saved.id);
                setSaved(null);
              }}
              accessibilityRole="button"
              style={{ paddingLeft: 12, paddingVertical: 4 }}
            >
              Undo
            </T>
          </View>
        )}


      </ScrollView>

      <CoinRain run={rain} onDone={() => setRain(0)} />

      <ConfirmDialog
        visible={!!asking}
        t={t}
        title={asking?.kind === 'income' ? 'Save this income?' : 'Save this expense?'}
        action="Save it"
        onCancel={() => setAsking(null)}
        onConfirm={confirm}
      >
        {asking && <EntryPreview e={asking} t={t} currency={cur} rates={rates} />}
      </ConfirmDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 4, paddingBottom: 110, maxWidth: 560, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6, flexWrap: 'wrap' },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  // Undo sits right under Save, where her thumb already is, and covers nothing (Erina build review).
  toast: { marginTop: 10, borderRadius: radius, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center' },
});
