import { ArrowDownRight, ArrowUpRight, CircleAlert } from './lucide';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Expense, MONTHS, PayLabel, Rates, Settings, formatMoney, localDate, newId, parseAmount, sumIn } from './data';
import { Draft, EntryForm, EntryFormHandle, emptyDraft } from './EntryForm';
import type { CategoryTools } from './OtherPicker';
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
  catTools: CategoryTools;
};

export function LogScreen({ t, expenses, settings, rates, sync, waiting, loading, onSyncPress, onAdd, onUndo, onAddLabel, onAddCategory, catTools }: Props) {
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

  // ---------- Fit the phone (Joe v3.1, mockup round 4) ----------
  // The top card takes the biggest layout that still fits above the tab bar, then grows into what's
  // left, up to CARD_GROW; anything beyond that widens the gaps between sections. No empty band.
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [size, setSize] = useState<CardSize>('large');
  const [extra, setExtra] = useState(0);
  function onView(h: number) {
    // The keyboard can shrink the view while she types; don't reshuffle the screen under her thumb.
    const typing = Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement?.tagName === 'INPUT';
    if (h === viewH || (typing && h < viewH)) return;
    setViewH(h);
    setSize('large'); // a new size of screen: start from the biggest card again
    setExtra(0);
  }
  // Either measurement can arrive first, so fit whenever one changes. The content was measured with
  // the `extra` of the render that produced it, so `contentH - extra` is its natural height.
  useEffect(() => {
    if (!viewH || !contentH) return;
    const natural = contentH - extra;
    if (natural > viewH + 0.5) {
      if (extra) setExtra(0);
      else if (size !== 'small') setSize(size === 'large' ? 'mid' : 'small');
      return;
    }
    const room = Math.floor(viewH - natural);
    if (Math.abs(room - extra) > 1) setExtra(room);
  }, [viewH, contentH]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardGrow = Math.min(extra, CARD_GROW);
  const spread = (extra - cardGrow) / 6; // six gaps: form, Amount, What for, chips, note, Save

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => onView(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentH(h)}
      >
        <View style={styles.top}>
          <T size={18} w="bold" color={t.text} accessibilityRole="header">{MONTHS[now.getMonth()]}</T>
          <SyncBadge state={sync} waiting={waiting} t={t} onPress={onSyncPress} />
        </View>

        <TopCard t={t} size={size} grow={cardGrow} loading={loading} left={left} income={income} spent={spent} cur={cur} now={now} />

        <View style={{ marginTop: 16 + spread }}>
          <EntryForm
            ref={form}
            t={t}
            draft={draft}
            onChange={(d) => {
              setDraft(d);
              if (saved) setSaved(null); // she's logging the next one: the Undo bar steps aside
            }}
            currency={cur}
            customCategories={settings.categories}
            catTools={catTools}
            spread={spread}
            labels={settings.paymentLabels}
            onAddLabel={onAddLabel}
            onSubmit={ask}
            canKeep
          />
        </View>

        {/* Pig B beside Save (Joe v3) */}
        <View style={[styles.saveRow, { marginTop: 12 + spread }]}>
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
      </ScrollView>

      {/* Undo floats just above the tab bar, where her thumb already is. Save now sits right on top of
          the tab bar, so an in-page row would have nowhere to go (v3.1). */}
      {saved && (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <View style={[styles.toast, { backgroundColor: t.surface, borderColor: t.accent }]} accessibilityLiveRegion="polite">
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
        </View>
      )}

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

type CardSize = 'large' | 'mid' | 'small';
const CARD_GROW = 60;

/**
 * "Left this month". Large: big amount, a bar of how much of this month's income is spent, In and
 * Out as two boxes. Mid: the same with In and Out on one line. Small: the 3.0 card, for short phones.
 */
function TopCard({
  t,
  size,
  grow,
  loading,
  left,
  income,
  spent,
  cur,
  now,
}: {
  t: Theme;
  size: CardSize;
  grow: number;
  loading?: boolean;
  left: number;
  income: number;
  spent: number;
  cur: string;
  now: Date;
}) {
  const over = left < 0;
  const small = size === 'small';
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const ratio = income > 0 ? Math.min(spent / income, 1) : 0;
  const caption =
    income <= 0
      ? spent > 0
        ? 'Nothing came in yet this month'
        : 'Nothing logged yet this month'
      : over
        ? `You spent ${formatMoney(-left, cur)} more than came in`
        : `${Math.round((spent / income) * 100)}% of what came in is spent · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  const inOut = (
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
  );
  const box = { backgroundColor: t.dark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.55)', borderColor: t.glassBorder };

  return (
    <GlassHero t={t}>
      {/* `grow` is shared between the gaps, so the card spreads out evenly instead of leaving a band. */}
      <View>
        <View>
          <View style={styles.label}>
            <T size={small ? 14 : 15} w="semibold" color={t.text}>Left this month</T>
            {over && !loading && <CircleAlert size={15} color={t.text} strokeWidth={2} style={{ opacity: 0.75 }} />}
          </View>
          {loading ? (
            <Skeleton t={t} onGlass w={190} h={small ? 30 : 38} style={{ marginTop: 6, marginBottom: 8 }} />
          ) : (
            // Counts up each time Log opens (Joe v3). After a save it just updates.
            <CountUp
              cents={left}
              currency={cur}
              size={small ? 32 : 40}
              color={t.text}
              style={small ? { lineHeight: 38, letterSpacing: -0.6, marginTop: 2 } : { lineHeight: 44, letterSpacing: -1, marginTop: 0 }}
            />
          )}
          {small && over && !loading && (
            <T size={13} color={t.text} style={{ opacity: 0.8, marginTop: 2 }} num>
              You spent {formatMoney(-left, cur)} more than came in.
            </T>
          )}
        </View>

        {!small && !loading && (
          <View style={{ marginTop: 8 + grow / 2 }}>
            {income > 0 && (
              <View style={[styles.track, { backgroundColor: t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)' }]}>
                <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: over ? t.warning : t.accent }]} />
              </View>
            )}
            <T size={12.5} w="medium" color={t.text} style={{ marginTop: 5, opacity: 0.85 }} num>
              {caption}
            </T>
          </View>
        )}

        {loading ? (
          <View style={styles.sub}>
            <Skeleton t={t} onGlass w={110} h={13} />
            <Skeleton t={t} onGlass w={110} h={13} />
          </View>
        ) : size === 'large' ? (
          <View style={[styles.stats, { marginTop: 10 + grow / 2 }]}>
            {[
              { icon: ArrowUpRight, label: 'In', value: income },
              { icon: ArrowDownRight, label: 'Out', value: spent },
            ].map(({ icon: Icon, label, value }) => (
              <View key={label} style={[styles.stat, box]}>
                <View style={styles.pair}>
                  <Icon size={14} color={t.text} strokeWidth={2.2} />
                  <T size={12.5} w="semibold" color={t.text} style={{ opacity: 0.8 }}>{label}</T>
                </View>
                <T size={16} w="bold" color={t.text} num numberOfLines={1} style={{ marginTop: 1 }}>{formatMoney(value, cur)}</T>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginTop: small ? grow : grow / 2 }}>{inOut}</View>
        )}
      </View>
    </GlassHero>
  );
}

const styles = StyleSheet.create({
  // Bottom padding = tab bar (60) + its gap (12) + 12 of air above it.
  page: { padding: 16, paddingTop: 4, paddingBottom: 84, maxWidth: 560, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6, flexWrap: 'wrap' },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: { flex: 1, minWidth: 0, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 84, paddingHorizontal: 16, alignItems: 'center' },
  toast: {
    width: '100%',
    maxWidth: 528,
    borderRadius: radius,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
