import { CalendarRange, ChartPie, ChevronDown, ChevronLeft, ChevronRight, Search, X } from './lucide';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Expense, Kind, MONTHS, Rates, SHORT_MONTHS, convert, formatMoney, localDate, parseLocalDate, paidLabel, sumIn } from './data';
import { whenLabel } from './EntryForm';
import { ExpenseRow } from './ExpenseRow';
import { CountUp, Skeleton } from './motion';
import { DateRange, RangeSheet, rangeLabel } from './sheets';
import { Theme, radius } from './theme';
import { Card, Donut, Field, IconButton, Segmented, T } from './ui';

type Period = 'week' | 'month' | 'year' | 'dates';
type Filter = 'all' | Kind;

// About a screenful of entries, then "See more" (Joe v3): no more scrolling top to bottom.
const FIRST_PAGE = 8;
const PAGE = 20;

function addDay(iso: string): string {
  const d = parseLocalDate(iso);
  return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

/** Start (inclusive) and end (exclusive) ISO dates for the period containing `anchor`. Weeks start Sunday. */
function range(period: Exclude<Period, 'dates'>, anchor: Date): { from: string; to: string; label: string } {
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

function shift(period: Exclude<Period, 'dates'>, anchor: Date, dir: 1 | -1): Date {
  if (period === 'year') return new Date(anchor.getFullYear() + dir, 0, 1);
  if (period === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * dir);
}

export function HistoryScreen({
  t,
  expenses,
  currency,
  rates,
  loading,
  onEdit,
  onLogFirst,
}: {
  t: Theme;
  expenses: Expense[];
  currency: string;
  rates: Rates | null;
  loading?: boolean;
  onEdit: (e: Expense) => void;
  onLogFirst: () => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [lastPeriod, setLastPeriod] = useState<Exclude<Period, 'dates'>>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [custom, setCustom] = useState<DateRange | null>(null);
  const [rangeOpen, setRangeOpen] = useState(0); // counter: remounts the sheet fresh each time
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(FIRST_PAGE);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');

  const r =
    period === 'dates' && custom
      ? { from: custom.from, to: addDay(custom.to), label: rangeLabel(custom) }
      : range(period === 'dates' ? lastPeriod : period, anchor);
  const isCurrent = localDate() >= r.from && localDate() < r.to;
  const inRange = useMemo(() => expenses.filter((e) => e.date >= r.from && e.date < r.to), [expenses, r.from, r.to]);

  const query = q.trim().toLowerCase();
  const list = useMemo(() => {
    const base = query ? expenses : inRange; // search looks through everything
    const hits = base
      .filter((e) => filter === 'all' || e.kind === filter)
      .filter((e) => !query || [e.category, e.note, paidLabel(e)].some((s) => s.toLowerCase().includes(query)));
    return [...hits].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [expenses, inRange, query, filter]);

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

  const page = list.slice(0, shown);
  const groups = useMemo(() => {
    const out: { day: string; items: Expense[] }[] = [];
    for (const e of page) {
      const g = out[out.length - 1];
      if (g && g.day === e.date) g.items.push(e);
      else out.push({ day: e.date, items: [e] });
    }
    return out;
  }, [page]);

  const periodWord =
    period === 'dates' ? `on ${r.label}` : period === 'week' ? 'this week' : period === 'month' ? `in ${MONTHS[parseLocalDate(r.from).getMonth()]}` : `in ${r.label}`;

  function pickPeriod(p: Period) {
    setShown(FIRST_PAGE);
    if (p === 'dates') {
      setRangeOpen((n) => n + 1);
      return; // stays on the old period until dates are actually picked
    }
    setPeriod(p);
    setLastPeriod(p);
    setAnchor(new Date());
  }

  const totalFor = filter === 'income' ? income : spent.cents;

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
            onChangeText={(v) => {
              setQ(v);
              setShown(FIRST_PAGE);
            }}
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
            onChange={pickPeriod}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
              { value: 'dates', label: 'Dates', icon: CalendarRange },
            ]}
          />
          {period === 'dates' && custom ? (
            <View style={[styles.rangeBar, { borderColor: t.border, backgroundColor: t.surface }]}>
              <Pressable onPress={() => setRangeOpen((n) => n + 1)} accessibilityRole="button" accessibilityLabel={`Dates: ${r.label}. Tap to change.`} style={styles.rangeLabel}>
                <CalendarRange size={18} color={t.accent} strokeWidth={1.8} />
                <T size={16} w="semibold" color={t.text} num>{r.label}</T>
              </Pressable>
              <IconButton
                icon={X}
                t={t}
                label="Back to the month"
                size={18}
                onPress={() => {
                  setPeriod(lastPeriod);
                  setCustom(null);
                  setShown(FIRST_PAGE);
                }}
              />
            </View>
          ) : (
            <View style={styles.period}>
              <IconButton boxed icon={ChevronLeft} t={t} label="Earlier" onPress={() => { setAnchor(shift(lastPeriod, anchor, -1)); setShown(FIRST_PAGE); }} />
              <T size={16} w="semibold" color={t.text}>{r.label}</T>
              <IconButton boxed icon={ChevronRight} t={t} label="Later" disabled={isCurrent} onPress={() => { setAnchor(shift(lastPeriod, anchor, 1)); setShown(FIRST_PAGE); }} />
            </View>
          )}
        </>
      )}

      {loading ? (
        <>
          <View style={styles.chartRow}>
            <View style={[styles.ringSk, { borderColor: t.border }]} />
            <View style={[styles.legend, { gap: 12 }]}>
              <Skeleton t={t} w="100%" h={12} />
              <Skeleton t={t} w="80%" h={12} />
              <Skeleton t={t} w="90%" h={12} />
              <Skeleton t={t} w="70%" h={12} />
            </View>
          </View>
          <Skeleton t={t} w={60} h={12} style={{ marginTop: 22, marginBottom: 8 }} />
          <Card t={t}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skRow, i > 0 && { borderTopWidth: 1, borderTopColor: t.border }]}>
                <Skeleton t={t} w={36} h={36} r={10} />
                <View style={{ flex: 1, gap: 7 }}>
                  <Skeleton t={t} w={90} h={14} />
                  <Skeleton t={t} w={140} h={11} />
                </View>
                <Skeleton t={t} w={70} h={14} />
              </View>
            ))}
          </Card>
        </>
      ) : !query && inRange.length === 0 ? (
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
          {!query && period !== 'dates' && spentList.length > 0 && (
            <View style={styles.chartRow}>
              <Donut
                t={t}
                size={150}
                slices={slices.map((s) => ({ value: s.cents, color: s.color }))}
                center={
                  <>
                    <T size={13} w="medium" color={t.muted}>Spent</T>
                    <CountUp cents={spent.cents} currency={currency} size={16} color={t.text} style={{ letterSpacing: -0.3 }} />
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
          {!query && period === 'dates' && (
            <Card t={t} style={styles.summary}>
              <View>
                <T size={13} color={t.muted}>{filter === 'income' ? 'Came in' : 'Spent'}, {r.label}</T>
                <CountUp cents={totalFor} currency={currency} size={24} color={t.text} style={{ letterSpacing: -0.4, marginTop: 2 }} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T size={13} color={t.muted}>Entries</T>
                <T size={24} w="bold" color={t.text} num style={{ marginTop: 2 }}>{list.length}</T>
              </View>
            </Card>
          )}
          {!query && period !== 'dates' && (income > 0 || spentList.length === 0) && (
            <T size={14} color={t.muted} style={{ marginTop: 10 }} num>
              {spentList.length === 0 ? 'No spending yet. ' : ''}Income {periodWord}: {formatMoney(income, currency)}
            </T>
          )}
          {!query && spent.missing > 0 && (
            <T size={13} color={t.warning} style={{ marginTop: 8 }}>
              {spent.missing} {spent.missing === 1 ? 'entry is' : 'entries are'} in another currency with no rate yet. Connect to the internet to include {spent.missing === 1 ? 'it' : 'them'}.
            </T>
          )}

          {/* All / Expense / Income (Joe v3) */}
          <View style={styles.filters} accessibilityRole="radiogroup">
            {(['all', 'expense', 'income'] as const).map((k) => {
              const on = filter === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    setFilter(k);
                    setShown(FIRST_PAGE);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={(s: any) => [
                    styles.filter,
                    { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : s.pressed ? t.accentSoft : t.surface, transform: [{ scale: s.pressed ? 0.95 : 1 }] },
                  ]}
                >
                  <T size={14} w={on ? 'semibold' : 'medium'} color={t.text}>{k === 'all' ? 'All' : k === 'expense' ? 'Expense' : 'Income'}</T>
                </Pressable>
              );
            })}
          </View>

          {query && (
            <T size={14} color={t.muted} style={{ marginTop: 10, marginBottom: 4 }}>
              {list.length === 0 ? `Nothing matches “${q.trim()}”.` : `${list.length} ${list.length === 1 ? 'match' : 'matches'}`}
            </T>
          )}
          {!query && list.length === 0 && (
            <T size={15} color={t.muted} style={{ marginTop: 14 }}>
              No {filter === 'income' ? 'income' : 'expenses'} {periodWord}.
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

          {list.length > shown && (
            <Pressable
              onPress={() => setShown((n) => n + PAGE)}
              accessibilityRole="button"
              style={(s: any) => [styles.more, { borderColor: t.border, backgroundColor: s.pressed ? t.accentSoft : t.surface, transform: [{ scale: s.pressed ? 0.98 : 1 }] }]}
            >
              <T size={15} w="semibold" color={t.accent}>
                See {Math.min(PAGE, list.length - shown)} more{list.length - shown > PAGE ? ` of ${list.length - shown}` : ''}
              </T>
              <ChevronDown size={18} color={t.accent} strokeWidth={2} />
            </Pressable>
          )}
        </>
      )}

      {rangeOpen > 0 && (
        <RangeSheet
          key={rangeOpen}
          visible
          onClose={() => setRangeOpen(0)}
          t={t}
          value={custom}
          onPick={(rng) => {
            setCustom(rng);
            setPeriod('dates');
            setShown(FIRST_PAGE);
            setRangeOpen(0);
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 16, paddingTop: 4, paddingBottom: 110, maxWidth: 560, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52 },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  rangeBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6, borderWidth: 1, borderRadius: radius, paddingLeft: 14, minHeight: 48 },
  rangeLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minHeight: 44 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  ringSk: { width: 150, height: 150, borderRadius: 75, borderWidth: 20 },
  legend: { flex: 1, gap: 9 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 9, height: 9, borderRadius: 3 },
  summary: { marginTop: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filters: { flexDirection: 'row', gap: 8, marginTop: 14 },
  filter: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius, borderWidth: 1, justifyContent: 'center' },
  day: { marginTop: 18, marginBottom: 6 },
  more: { minHeight: 48, marginTop: 14, borderRadius: radius, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  // Centered between the period control and the nav (Erina mockup + build review).
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 40 },
});
