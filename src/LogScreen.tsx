import { ArrowUpRight } from './lucide';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Expense, MONTHS, PayLabel, Rates, Settings, formatMoney, localDate, newId, parseAmount, sumIn } from './data';
import { Draft, EntryForm, EntryFormHandle, emptyDraft } from './EntryForm';
import { ExpenseRow } from './ExpenseRow';
import { Theme, radius } from './theme';
import { Button, Card, GlassHero, SyncBadge, SyncState, T } from './ui';

type Props = {
  t: Theme;
  expenses: Expense[]; // visible (not deleted)
  settings: Settings;
  rates: Rates | null;
  sync: SyncState;
  waiting: number;
  onSyncPress: () => void;
  onAdd: (e: Expense) => void;
  onUndo: (id: string) => void;
  onEdit: (e: Expense) => void;
  onAddLabel: (l: PayLabel) => void;
};

export function LogScreen({ t, expenses, settings, rates, sync, waiting, onSyncPress, onAdd, onUndo, onEdit, onAddLabel }: Props) {
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
  const form = useRef<EntryFormHandle>(null);

  const now = new Date();
  const monthPrefix = localDate(now).slice(0, 7);
  const month = expenses.filter((e) => e.date.startsWith(monthPrefix));
  const spent = sumIn(month.filter((e) => e.kind === 'expense'), cur, rates).cents;
  const income = sumIn(month.filter((e) => e.kind === 'income'), cur, rates).cents;

  const recent = useMemo(() => [...expenses].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5), [expenses]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 5000);
    return () => clearTimeout(timer);
  }, [saved]);

  function save() {
    const v = form.current?.take();
    if (!v) return;
    const cash = draft.paidWith === '' || draft.group === 'cash';
    const e: Expense = {
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
    };
    onAdd(e);
    setSaved(e);
    // Keep "Paid with" (same wallet next time); reset the rest; back to Expense.
    setDraft({ ...emptyDraft({ paidWith: draft.paidWith, group: draft.group }) });
    form.current?.focusAmount();
  }

  const savedAmount = saved ? formatMoney(saved.cents, saved.currency) : '';
  const typed = parseAmount(draft.amount);
  const cta = typed ? `Save ${formatMoney(typed, cur)}` : 'Save';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <T size={18} w="bold" color={t.text} accessibilityRole="header">{MONTHS[now.getMonth()]}</T>
          <SyncBadge state={sync} waiting={waiting} t={t} onPress={onSyncPress} />
        </View>

        <GlassHero t={t}>
          <T size={14} w="semibold" color={t.text}>Spent this month</T>
          <T size={32} w="bold" color={t.text} num style={{ lineHeight: 38, letterSpacing: -0.6, marginTop: 2 }}>
            {formatMoney(spent, cur)}
          </T>
          {income > 0 && (
            <View style={styles.sub}>
              <ArrowUpRight size={15} color={t.text} strokeWidth={2.2} />
              <T size={13} w="semibold" color={t.text} num>Income this month {formatMoney(income, cur)}</T>
            </View>
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
            autoFocus
            onSubmit={save}
          />
        </View>

        <T size={18} w="bold" color={t.text} style={{ marginTop: 28, marginBottom: 8 }} accessibilityRole="header">
          Recent
        </T>
        {recent.length === 0 ? (
          <T size={15} color={t.muted} style={{ paddingVertical: 8 }}>
            Nothing yet. Your first expense will show up here.
          </T>
        ) : (
          <Card t={t}>
            {recent.map((e, i) => (
              <ExpenseRow key={e.id} e={e} t={t} currency={cur} rates={rates} first={i === 0} onPress={onEdit} />
            ))}
          </Card>
        )}
      </ScrollView>

      <View style={[styles.dock, { backgroundColor: t.bg, borderColor: t.border }]}>
        {saved && (
          <View style={[styles.toast, { backgroundColor: t.accentSoft }]} accessibilityLiveRegion="polite">
            <T size={15} color={t.text} style={{ flex: 1 }}>
              Saved {savedAmount} {saved.kind === 'income' ? 'from' : 'for'} {saved.category}.
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
        <Button label={cta} onPress={save} t={t} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 4, paddingBottom: 24, maxWidth: 560, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  // Sits above the floating nav (60 tall + 12 gap), so Save is never covered.
  dock: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 82, width: '100%', maxWidth: 560, alignSelf: 'center' },
  toast: { marginBottom: 10, borderRadius: radius, padding: 14, flexDirection: 'row', alignItems: 'center' },
});
