import { CalendarRange, ChartPie, ChevronDown, ChevronLeft, ChevronRight, Search, X } from './lucide';
import { useEffect, useMemo, useState } from 'react';
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

  const expenseList = useMemo(() => inRange.filter((e) => e.kind === 'expense'), [inRange]);
  const incomeList = useMemo(() => inRange.filter((e) => e.kind === 'income'), [inRange]);
  const spent = sumIn(expenseList, currency, rates);
  const came = sumIn(incomeList, currency, rates);
  const income = came.cents;
  const missing = spent.missing + came.missing;

  // Donut: top 5 categories, the rest folded into "Everything else" so the legend stays readable.
  const slicesOf = (rows: Expense[]) => {
    const m = new Map<string, number>();
    for (const e of rows) {
      const c = convert(e.cents, e.currency, rates, currency);
      if (c !== null) m.set(e.category, (m.get(e.category) ?? 0) + c);
    }
    const byCat = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const out = byCat.slice(0, 5).map(([name, cents], i) => ({ name, cents, color: t.chart[i] }));
    const rest = byCat.slice(5).reduce((s, [, c]) => s + c, 0);
    if (rest > 0) out.push({ name: 'Everything else', cents: rest, color: t.chart[5] });
    return out;
  };
  const spentSlices = useMemo(() => slicesOf(expenseList), [expenseList, rates, currency, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const incomeSlices = useMemo(() => slicesOf(incomeList), [incomeList, rates, currency, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two taps to edit (Joe): the first tap arms a row and shows "Edit ›"; it disarms by itself.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

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
          {/* All / Expense / Income (Joe v3): drives the chart AND the list */}
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

          {!query && filter === 'all' && (
            // All: Spent and Came in, side by side (Joe picked two rings)
            <View style={styles.pair} key={`all-${r.from}-${r.to}`}>
              {[
                { label: 'Spent', cents: spent.cents, slices: spentSlices },
                { label: 'Came in', cents: income, slices: incomeSlices },
              ].map((ring) => (
                <View key={ring.label} style={styles.ringCol}>
                  <Donut
                    t={t}
                    size={132}
                    slices={ring.slices.map((s) => ({ value: s.cents, color: s.color }))}
                    center={
                      <>
                        <T size={12} w="medium" color={t.muted}>{ring.label}</T>
                        <CountUp cents={ring.cents} currency={currency} size={14} color={t.text} style={{ letterSpacing: -0.3 }} />
                      </>
                    }
                  />
                  <View style={styles.miniLegend}>
                    {ring.slices.slice(0, 3).map((s) => (
                      <View key={s.name} style={styles.legendRow}>
                        <View style={[styles.swatch, { backgroundColor: s.color }]} />
                        <T size={12} color={t.text} numberOfLines={1} style={{ flex: 1 }}>{s.name}</T>
                        <T size={12} color={t.muted} num>{Math.round((s.cents / (ring.cents || 1)) * 100)}%</T>
                      </View>
                    ))}
                    {ring.slices.length === 0 && <T size={12} color={t.muted}>Nothing yet</T>}
                  </View>
                </View>
              ))}
            </View>
          )}
          {!query && filter !== 'all' && (() => {
            const inc = filter === 'income';
            const ring = inc ? incomeSlices : spentSlices;
            const total = inc ? income : spent.cents;
            if (!ring.length)
              return (
                <T size={15} color={t.muted} style={{ marginTop: 14 }}>
                  No {inc ? 'income' : 'expenses'} {periodWord}.
                </T>
              );
            return (
              <View style={styles.chartRow} key={`${filter}-${r.from}-${r.to}`}>
                <Donut
                  t={t}
                  size={150}
                  slices={ring.map((s) => ({ value: s.cents, color: s.color }))}
                  center={
                    <>
                      <T size={13} w="medium" color={t.muted}>{inc ? 'Came in' : 'Spent'}</T>
                      <CountUp cents={total} currency={currency} size={16} color={t.text} style={{ letterSpacing: -0.3 }} />
                    </>
                  }
                />
                <View style={styles.legend}>
                  {ring.map((s) => (
                    <View key={s.name} style={styles.legendRow}>
                      <View style={[styles.swatch, { backgroundColor: s.color }]} />
                      <T size={14} color={t.text} numberOfLines={1} style={{ flex: 1 }}>{s.name}</T>
                      <T size={13} color={t.muted} num>{Math.round((s.cents / (total || 1)) * 100)}%</T>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}
          {!query && period === 'dates' && (
            <T size={13} color={t.muted} style={{ marginTop: 10 }} num>
              {list.length} {list.length === 1 ? 'entry' : 'entries'} on {r.label}
            </T>
          )}
          {!query && missing > 0 && (
            <T size={13} color={t.warning} style={{ marginTop: 8 }}>
              {missing} {missing === 1 ? 'entry is' : 'entries are'} in another currency with no rate yet. Connect to the internet to include {missing === 1 ? 'it' : 'them'}.
            </T>
          )}

          {query && (
            <T size={14} color={t.muted} style={{ marginTop: 10, marginBottom: 4 }}>
              {list.length === 0 ? `Nothing matches “${q.trim()}”.` : `${list.length} ${list.length === 1 ? 'match' : 'matches'}`}
            </T>
          )}

          {groups.map((g) => (
            <View key={g.day}>
              <T size={13} w="semibold" color={t.muted} style={styles.day}>
                {whenLabel(g.day)}
              </T>
              <Card t={t}>
                {g.items.map((e, i) => (
                  <ExpenseRow key={e.id} e={e} t={t} currency={currency} rates={rates} first={i === 0} onPress={onEdit} armed={armed === e.id} onArm={setArmed} />
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
  filters: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4 },
  pair: { flexDirection: 'row', gap: 12, marginTop: 12 },
  ringCol: { flex: 1, alignItems: 'center', gap: 10 },
  miniLegend: { alignSelf: 'stretch', gap: 6, paddingHorizontal: 4 },
  filter: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius, borderWidth: 1, justifyContent: 'center' },
  day: { marginTop: 18, marginBottom: 6 },
  more: { minHeight: 48, marginTop: 14, borderRadius: radius, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  // Centered between the period control and the nav (Erina mockup + build review).
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 40 },
});
