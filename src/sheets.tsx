import { ArrowRight, Check, ChevronLeft, ChevronRight, Plus, Search } from './lucide';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  COMMON_CURRENCIES,
  CURRENCIES,
  MONTHS,
  PayGroup,
  SHORT_MONTHS,
  PayLabel,
  Rates,
  currencySymbol,
  formatMoney,
  localDate,
  parseLocalDate,
  validLabel,
} from './data';
import { payIcon } from './icons';
import { Theme, radius } from './theme';
import { Button, Card, Field, IconButton, IconTile, Label, Row, Segmented, Sheet, T } from './ui';

// ---------- Paid with: Cash / Cards / E-wallets and digital banks ----------

export function PaidWithSheet({
  visible,
  onClose,
  t,
  value,
  labels,
  onPick,
  onAddLabel,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  value: string; // '' = Cash
  labels: PayLabel[];
  onPick: (name: string, group: PayGroup) => void;
  onAddLabel: (l: PayLabel) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<PayGroup>('ewallet');
  const [err, setErr] = useState<string | null>(null);
  const cards = labels.filter((l) => l.g === 'card');
  const wallets = labels.filter((l) => l.g === 'ewallet');

  function add() {
    const n = name.trim();
    if (!validLabel(n)) {
      setErr(n.replace(/\D/g, '').length > 4 ? 'Just a name, please. No card or account numbers.' : 'Type a name, like “BPI Debit”.');
      return;
    }
    if (labels.some((l) => l.n.toLowerCase() === n.toLowerCase()) || n.toLowerCase() === 'cash') {
      setErr('You already have that one.');
      return;
    }
    onAddLabel({ n, g: group });
    onPick(n, group);
    setAdding(false);
    setName('');
    setErr(null);
  }

  const item = (n: string, g: PayGroup, first: boolean) => {
    const on = (value || 'Cash') === n;
    return (
      <Row key={n} t={t} first={first} onPress={() => onPick(n === 'Cash' ? '' : n, g)} label={n}>
        <IconTile icon={payIcon(n, g)} t={t} tint={on} />
        <T size={16} w="semibold" color={t.text} style={{ flex: 1 }}>
          {n}
        </T>
        {on && <Check size={20} color={t.accent} strokeWidth={2} />}
      </Row>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} t={t} title="Paid with" subtitle="Remembers your cards and wallets. Names only, never account numbers.">
      <Card t={t}>{item('Cash', 'cash', true)}</Card>
      {cards.length > 0 && (
        <>
          <Label t={t} style={{ marginTop: 14 }}>Cards</Label>
          <Card t={t}>{cards.map((l, i) => item(l.n, 'card', i === 0))}</Card>
        </>
      )}
      {wallets.length > 0 && (
        <>
          <Label t={t} style={{ marginTop: 14 }}>E-wallets and digital banks</Label>
          <Card t={t}>{wallets.map((l, i) => item(l.n, 'ewallet', i === 0))}</Card>
        </>
      )}
      {adding ? (
        <View style={{ marginTop: 16 }}>
          <Segmented
            t={t}
            small
            value={group}
            onChange={setGroup}
            options={[
              { value: 'card', label: 'Card' },
              { value: 'ewallet', label: 'E-wallet or bank' },
            ]}
          />
          <View style={{ height: 10 }} />
          <Field
            t={t}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setErr(null);
            }}
            placeholder={group === 'card' ? 'Card name, like “BPI Debit”' : 'Name, like “GCash”'}
            maxLength={40}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={add}
            accessibilityLabel="Name"
            error={!!err}
          />
          {err && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{err}</T>}
          <Button label="Add" onPress={add} t={t} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={styles.addLink}>
          <Plus size={18} color={t.accent} strokeWidth={2} />
          <T size={15} w="semibold" color={t.accent}>
            Add a card, e-wallet or bank
          </T>
        </Pressable>
      )}
    </Sheet>
  );
}

// ---------- When: Today / Yesterday + calendar (no future dates) ----------

export function DateSheet({
  visible,
  onClose,
  t,
  value,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  value: string;
  onPick: (iso: string) => void;
}) {
  const today = localDate();
  const yesterday = localDate(new Date(Date.now() - 86_400_000));
  const [month, setMonth] = useState(() => {
    const d = parseLocalDate(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [month]);
  const atThisMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  return (
    <Sheet visible={visible} onClose={onClose} t={t} title="When was it?">
      <View style={styles.quick}>
        {[
          { iso: today, label: 'Today' },
          { iso: yesterday, label: 'Yesterday' },
        ].map((q) => {
          const on = value === q.iso;
          return (
            <Pressable
              key={q.label}
              onPress={() => onPick(q.iso)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
            >
              <T size={15} w={on ? 'semibold' : 'medium'} color={t.text}>{q.label}</T>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.monthRow}>
        <IconButton boxed icon={ChevronLeft} t={t} label="Previous month" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <T size={16} w="semibold" color={t.text}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </T>
        <IconButton
          boxed
          icon={ChevronRight}
          t={t}
          label="Next month"
          disabled={atThisMonth}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        />
      </View>
      <View style={styles.cal}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <View key={`h${i}`} style={styles.calCell}>
            <T size={12} w="semibold" color={t.muted}>{d}</T>
          </View>
        ))}
        {days.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={styles.calCell} />;
          const iso = localDate(new Date(month.getFullYear(), month.getMonth(), d));
          const future = iso > today;
          const on = iso === value;
          return (
            <Pressable
              key={iso}
              disabled={future}
              onPress={() => onPick(iso)}
              accessibilityRole="button"
              accessibilityLabel={`${MONTHS[month.getMonth()]} ${d}`}
              accessibilityState={{ selected: on, disabled: future }}
              style={[styles.calCell, styles.calDay, on && { backgroundColor: t.accent }]}
            >
              <T size={15} w={on ? 'bold' : 'medium'} color={on ? t.accentText : future ? t.border : t.text} num>
                {d}
              </T>
            </Pressable>
          );
        })}
      </View>
      <Button label="Done" onPress={onClose} t={t} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

// ---------- Pick dates: a start-to-end range for History (Joe v3) ----------

export type DateRange = { from: string; to: string }; // inclusive, YYYY-MM-DD

export function rangeLabel(r: DateRange): string {
  const a = parseLocalDate(r.from);
  const b = parseLocalDate(r.to);
  const yr = a.getFullYear() !== new Date().getFullYear() || b.getFullYear() !== a.getFullYear();
  const fa = `${SHORT_MONTHS[a.getMonth()]} ${a.getDate()}${yr ? `, ${a.getFullYear()}` : ''}`;
  if (r.from === r.to) return fa;
  const fb = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() && !yr
    ? String(b.getDate())
    : `${SHORT_MONTHS[b.getMonth()]} ${b.getDate()}${yr ? `, ${b.getFullYear()}` : ''}`;
  return `${fa} to ${fb}`;
}

export function RangeSheet({
  visible,
  onClose,
  t,
  value,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  value: DateRange | null;
  onPick: (r: DateRange) => void;
}) {
  const today = localDate();
  const [start, setStart] = useState<string | null>(value?.from ?? null);
  const [end, setEnd] = useState<string | null>(value?.to ?? null);
  const [month, setMonth] = useState(() => {
    const d = parseLocalDate(value?.to ?? today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [month]);
  const atThisMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  const now = new Date();
  const quick: { label: string; r: DateRange }[] = [
    { label: 'Last 7 days', r: { from: localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to: today } },
    {
      label: 'Last month',
      r: { from: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    },
    { label: 'This year', r: { from: `${now.getFullYear()}-01-01`, to: today } },
  ];

  // Tap a start day, then an end day. Tapping before the start begins again from there.
  function tap(iso: string) {
    if (!start || end || iso < start) {
      setStart(iso);
      setEnd(null);
    } else {
      setEnd(iso);
    }
  }
  const from = start;
  const to = end ?? start;
  const count = from && to ? Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000) + 1 : 0;

  return (
    <Sheet visible={visible} onClose={onClose} t={t} title="Pick dates">
      <View style={styles.quick}>
        {quick.map((q) => (
          <Pressable
            key={q.label}
            onPress={() => onPick(q.r)}
            accessibilityRole="button"
            style={(s: any) => [styles.chip, { borderColor: t.border, backgroundColor: s.pressed ? t.accentSoft : t.surface, transform: [{ scale: s.pressed ? 0.95 : 1 }] }]}
          >
            <T size={15} w="medium" color={t.text}>{q.label}</T>
          </Pressable>
        ))}
      </View>
      <View style={styles.monthRow}>
        <IconButton boxed icon={ChevronLeft} t={t} label="Previous month" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <T size={16} w="semibold" color={t.text}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </T>
        <IconButton boxed icon={ChevronRight} t={t} label="Next month" disabled={atThisMonth} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
      </View>
      <View style={styles.cal}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <View key={`h${i}`} style={styles.calCell}>
            <T size={12} w="semibold" color={t.muted}>{d}</T>
          </View>
        ))}
        {days.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={styles.calCell} />;
          const iso = localDate(new Date(month.getFullYear(), month.getMonth(), d));
          const future = iso > today;
          const isA = iso === from;
          const isB = iso === to;
          const inside = !!from && !!to && iso > from && iso < to;
          const ends = isA || isB;
          return (
            <Pressable
              key={iso}
              disabled={future}
              onPress={() => tap(iso)}
              accessibilityRole="button"
              accessibilityLabel={`${MONTHS[month.getMonth()]} ${d}`}
              accessibilityState={{ selected: ends || inside, disabled: future }}
              style={[
                styles.calCell,
                inside && { backgroundColor: t.accentSoft },
                ends && { backgroundColor: t.accent },
                isA && { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
                isB && { borderTopRightRadius: 10, borderBottomRightRadius: 10 },
              ]}
            >
              <T size={15} w={ends ? 'bold' : 'medium'} color={ends ? t.accentText : future ? t.border : t.text} num>
                {d}
              </T>
            </Pressable>
          );
        })}
      </View>
      <T size={13} color={t.muted} style={{ textAlign: 'center', marginTop: 10 }} num>
        {from && to ? `${rangeLabel({ from, to })} · ${count} ${count === 1 ? 'day' : 'days'}. ` : ''}Tap a start day, then an end day.
      </T>
      <Button
        label={from && to ? `Show ${rangeLabel({ from, to })}` : 'Pick a start day'}
        disabled={!from}
        onPress={() => from && to && onPick({ from, to })}
        t={t}
        style={{ marginTop: 14 }}
      />
    </Sheet>
  );
}

// ---------- Currency: searchable list; changing it needs internet ----------

export function CurrencySheet({
  visible,
  onClose,
  t,
  value,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  value: string;
  onPick: (code: string) => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CURRENCIES.filter((c) => COMMON_CURRENCIES.includes(c.code));
    return CURRENCIES.filter((c) => c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s));
  }, [q]);
  return (
    <Sheet visible={visible} onClose={onClose} t={t} title="Currency">
      <Field t={t} value={q} onChangeText={setQ} placeholder="Search currencies" left={<Search size={18} color={t.muted} />} accessibilityLabel="Search currencies" autoCapitalize="none" />
      <Label t={t} style={{ marginTop: 16 }}>{q.trim() ? 'Results' : 'Common'}</Label>
      {list.length === 0 ? (
        <T size={15} color={t.muted}>No currency matches “{q.trim()}”.</T>
      ) : (
        <Card t={t}>
          {list.map((c, i) => (
            <Row key={c.code} t={t} first={i === 0} onPress={() => onPick(c.code)} label={c.name}>
              <View style={[styles.sym, { backgroundColor: t.bg }]}>
                <T size={15} w="bold" color={t.text}>{currencySymbol(c.code)}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T size={16} w="semibold" color={t.text}>{c.name}</T>
                <T size={13} color={t.muted}>{c.code}</T>
              </View>
              {c.code === value && <Check size={20} color={t.accent} strokeWidth={2} />}
            </Row>
          ))}
        </Card>
      )}
      {!q.trim() && (
        <T size={13} color={t.muted} style={{ marginTop: 12, textAlign: 'center' }}>
          Search finds any other currency.
        </T>
      )}
    </Sheet>
  );
}

export function ConvertSheet({
  visible,
  onClose,
  t,
  from,
  to,
  monthCents,
  rates,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  from: string;
  to: string;
  monthCents: number;
  rates: Rates | null;
  onConfirm: () => void;
}) {
  const name = CURRENCIES.find((c) => c.code === to)?.name ?? to;
  const r = rates?.rates[from];
  const converted = r ? Math.round(monthCents / r) : null;
  // Exact rate, not money-rounded: "1 PHP = 2.5634 JPY" (yen has no decimals, so ¥3 would mislead).
  const perOne = r ? `${Number((1 / r).toPrecision(5))} ${to}` : null;
  return (
    <Sheet visible={visible} onClose={onClose} t={t} title={`Show everything in ${name}?`}
      subtitle="Every amount converts at today’s rate. Your original entries stay saved, so switching back is exact.">
      <Card t={t} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <T size={13} color={t.muted}>This month</T>
          <T size={22} w="bold" color={t.text} num>{formatMoney(monthCents, from)}</T>
        </View>
        <ArrowRight size={20} color={t.muted} />
        <View style={{ alignItems: 'flex-end' }}>
          <T size={13} color={t.muted}>In {to}</T>
          <T size={22} w="bold" color={t.accent} num>{converted === null ? '—' : formatMoney(converted, to)}</T>
        </View>
      </Card>
      {r && (
        <T size={13} color={t.muted} style={{ textAlign: 'center', marginTop: 10 }} num>
          1 {from} = {perOne} · rates from {rates?.date || 'today'}
        </T>
      )}
      <Button label={`Switch to ${to}`} onPress={onConfirm} t={t} disabled={!r} style={{ marginTop: 18 }} />
      <Button label={`Keep ${from}`} kind="text" onPress={onClose} t={t} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 10 },
  quick: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius, borderWidth: 1, justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cal: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
  calDay: { borderRadius: 10 },
  sym: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
