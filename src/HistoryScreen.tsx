import { ChartPie, ChevronLeft, ChevronRight, Search, X } from './lucide';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Expense, MONTHS, Rates, SHORT_MONTHS, convert, formatMoney, localDate, parseLocalDate, paidLabel, sumIn } from './data';
import { whenLabel } from './EntryForm';
import { ExpenseRow } from './ExpenseRow';
import { Theme } from './theme';
import { Card, Donut, Field, IconButton, Segmented, T } from './ui';

type Period = 'week' | 'month' | 'year';

/** Start (inclusive) and end (exclusive) ISO dates for the period containing `anchor`. Weeks start Sunday. */
function range(period: Period, anchor: Date): { from: string; to: string; label: string } {
  if (period === 'year') {
    const y = anchor.getFullYear();
    return { from: `${y}-01-01`, to: `${y + 1}-01-01`, label: String(y) };
  }
  if (period === 'month') {
    const a = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const b = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    return { from: localDate(a), to: localDate(b), label: `${MONTHS[a.getMonth()]} ${a.getFullYear()}` };
  }
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7);
  const last = new Date(b.getTime() - 86_400_000);
  const label =
    a.getMonth() === last.getMonth()
      ? `${SHORT_MONTHS[a.getMonth()]} ${a.getDate()} to ${last.getDate()}`
      : `${SHORT_MONTHS[a.getMonth()]} ${a.getDate()} to ${SHORT_MONTHS[last.getMonth()]} ${last.getDate()}`;
  return { from: localDate(a), to: localDate(b), label };
}

function shift(period: Period, anchor: Date, dir: 1 | -1): Date {
  if (period === 'year') return new Date(anchor.getFullYear() + dir, 0, 1);
  if (period === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * dir);
}

export function HistoryScreen({
  t,
  expenses,
  currency,
  rates,
  onEdit,
  onLogFirst,
}: {
  t: Theme;
  expenses: Expense[];
  currency: string;
  rates: Rates | null;
  onEdit: (e: Expense) => void;
  onLogFirst: () => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');

  const r = range(period, anchor);
  const isCurrent = localDate() >= r.from && localDate() < r.to;
  const inRange = useMemo(() => expenses.filter((e) => e.date >= r.from && e.date < r.to), [expenses, r.from, r.to]);

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const base = query ? expenses : inRange; // search looks through everything
    const hits = query
      ? base.filter((e) => [e.category, e.note, paidLabel(e)].some((s) => s.toLowerCase().includes(query)))
      : base;
    return [...hits].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [expenses, inRange, query]);

  const spentList = inRange.filter((e) => e.kind === 'expense');
  const spent = sumIn(spentList, currency, rates);
  const income = sumIn(inRange.filter((e) => e.kind === 'income'), currency, rates).cents;

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of spentList) {
      const c = convert(e.cents, e.currency, rates, currency);
      if (c !== null) m.set(e.category, (m.get(e.category) ?? 0) + c);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [spentList, rates, currency]);

  // Donut: top 5 categories, the rest folded into "Everything else" so the legend stays readable.
  const slices = byCat.slice(0, 5).map(([name, cents], i) => ({ name, cents, color: t.chart[i] }));
  const restCents = byCat.slice(5).reduce((s, [, c]) => s + c, 0);
  if (restCents > 0) slices.push({ name: 'Everything else', cents: restCents, color: t.chart[5] });

  const groups = useMemo(() => {
    const out: { day: string; items: Expense[] }[] = [];
    for (const e of shown) {
      const g = out[out.length - 1];
      if (g && g.day === e.date) g.items.push(e);
      else out.push({ day: e.date, items: [e] });
    }
    return out;
  }, [shown]);

  const periodWord = period === 'week' ? 'this week' : period === 'month' ? `in ${MONTHS[parseLocalDate(r.from).getMonth()]}` : `in ${r.label}`;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <T size={28} w="bold" color={t.text} style={{ letterSpacing: -0.4, lineHeight: 34 }} accessibilityRole="header">
          History
        </T>
        <IconButton
          icon={searching ? X : Search}
          t={t}
          label={searching ? 'Close search' : 'Search'}
          onPress={() => {
            setSearching((s) => !s);
            setQ('');
          }}
          disabled={!searching && expenses.length === 0}
        />
      </View>

      {searching && (
        <View style={{ marginBottom: 12 }}>
          <Field
            t={t}
            value={q}
            onChangeText={setQ}
            placeholder="Search notes, categories, wallets"
            autoFocus
            accessibilityLabel="Search"
            left={<Search size={18} color={t.muted} />}
          />
        </View>
      )}

      {!query && (
        <>
          <Segmented
            t={t}
            small
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setAnchor(new Date());
            }}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
          />
          <View style={styles.period}>
            <IconButton boxed icon={ChevronLeft} t={t} label="Earlier" onPress={() => setAnchor(shift(period, anchor, -1))} />
            <T size={16} w="semibold" color={t.text}>{r.label}</T>
            <IconButton boxed icon={ChevronRight} t={t} label="Later" disabled={isCurrent} onPress={() => setAnchor(shift(period, anchor, 1))} />
          </View>
        </>
      )}

      {!query && inRange.length === 0 ? (
        <View style={styles.empty}>
          <ChartPie size={28} color={t.muted} strokeWidth={1.6} />
          <T size={18} w="semibold" color={t.text} style={{ marginTop: 12 }}>
            Nothing logged {periodWord} yet.
          </T>
          <T size={16} color={t.muted} style={{ marginTop: 6, lineHeight: 23 }}>
            Anything you log on the Log tab shows up here, sorted by day, with a breakdown of where it went.
          </T>
          {isCurrent && (
            <T size={16} w="semibold" color={t.accent} style={{ marginTop: 16 }} onPress={onLogFirst} accessibilityRole="button">
              Log your first expense
            </T>
          )}
        </View>
      ) : (
        <>
          {!query && spentList.length > 0 && (
            <View style={styles.chartRow}>
              <Donut
                t={t}
                slices={slices.map((s) => ({ value: s.cents, color: s.color }))}
                center={
                  <>
                    <T size={13} w="medium" color={t.muted}>Spent</T>
                    <T size={17} w="bold" color={t.text} num numberOfLines={1} style={{ letterSpacing: -0.3 }}>
                      {formatMoney(spent.cents, currency)}
                    </T>
                  </>
                }
              />
              <View style={styles.legend}>
                {slices.map((s) => (
                  <View key={s.name} style={styles.legendRow}>
                    <View style={[styles.swatch, { backgroundColor: s.color }]} />
                    <T size={14} color={t.text} numberOfLines={1} style={{ flex: 1 }}>{s.name}</T>
                    <T size={13} color={t.muted} num>{Math.round((s.cents / (spent.cents || 1)) * 100)}%</T>
                  </View>
                ))}
              </View>
            </View>
          )}
          {!query && (income > 0 || spentList.length === 0) && (
            <T size={14} color={t.muted} style={{ marginTop: 10 }} num>
              {spentList.length === 0 ? 'No spending yet. ' : ''}Income {periodWord}: {formatMoney(income, currency)}
            </T>
          )}
          {!query && spent.missing > 0 && (
            <T size={13} color={t.warning} style={{ marginTop: 8 }}>
              {spent.missing} {spent.missing === 1 ? 'entry is' : 'entries are'} in another currency with no rate yet. Connect to the internet to include {spent.missing === 1 ? 'it' : 'them'}.
            </T>
          )}

          {query && (
            <T size={14} color={t.muted} style={{ marginBottom: 4 }}>
              {shown.length === 0 ? `Nothing matches “${q.trim()}”.` : `${shown.length} ${shown.length === 1 ? 'match' : 'matches'}`}
            </T>
          )}

          {groups.map((g) => (
            <View key={g.day}>
              <T size={13} w="semibold" color={t.muted} style={styles.day}>
                {whenLabel(g.day)}
              </T>
              <Card t={t}>
                {g.items.map((e, i) => (
                  <ExpenseRow key={e.id} e={e} t={t} currency={currency} rates={rates} first={i === 0} onPress={onEdit} />
                ))}
              </Card>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 16, paddingTop: 4, paddingBottom: 110, maxWidth: 560, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52 },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  legend: { flex: 1, gap: 9 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 9, height: 9, borderRadius: 3 },
  day: { marginTop: 18, marginBottom: 6 },
  // Centered between the period control and the nav (Erina mockup + build review).
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 40 },
});
