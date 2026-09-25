import { Calendar, Wallet } from './lucide';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  CATEGORIES,
  Expense,
  INCOME_CATEGORIES,
  Kind,
  MAX_CENTS,
  PayGroup,
  PayLabel,
  SHORT_MONTHS,
  currencySymbol,
  localDate,
  parseAmount,
  parseLocalDate,
} from './data';
import { categoryIcon } from './icons';
import { DateSheet, PaidWithSheet } from './sheets';
import { Theme, radius } from './theme';
import { Field, Label, PickerField, Segmented, T } from './ui';

export type Draft = {
  kind: Kind;
  amount: string;
  category: string | null;
  paidWith: string; // '' = Cash
  group: PayGroup;
  date: string;
  note: string;
};

export function emptyDraft(last?: { paidWith: string; group: PayGroup }): Draft {
  return {
    kind: 'expense',
    amount: '',
    category: null,
    paidWith: last?.paidWith ?? '',
    group: last?.group ?? 'cash',
    date: localDate(),
    note: '',
  };
}

export function draftFrom(e: Expense, labels: PayLabel[]): Draft {
  const g = e.paidWith ? labels.find((l) => l.n === e.paidWith)?.g ?? 'card' : e.method === 'card' ? 'card' : 'cash';
  return {
    kind: e.kind,
    amount: (e.cents / 100).toFixed(2),
    category: e.category,
    paidWith: e.paidWith || (e.method === 'card' ? 'Card' : ''),
    group: g,
    date: e.date,
    note: e.note,
  };
}

export function whenLabel(iso: string): string {
  const today = localDate();
  const yesterday = localDate(new Date(Date.now() - 86_400_000));
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  const d = parseLocalDate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
}

export type EntryFormHandle = {
  /** Validates; returns the parsed values or null and shows the errors. */
  take: () => { cents: number; category: string } | null;
  focusAmount: () => void;
};

export const EntryForm = forwardRef<
  EntryFormHandle,
  {
    t: Theme;
    draft: Draft;
    onChange: (d: Draft) => void;
    currency: string;
    customCategories: string[];
    labels: PayLabel[];
    onAddLabel: (l: PayLabel) => void;
    autoFocus?: boolean;
    onSubmit?: () => void;
  }
>(function EntryForm({ t, draft, onChange, currency, customCategories, labels, onAddLabel, autoFocus, onSubmit }, ref) {
  const [tried, setTried] = useState(false);
  const [gridW, setGridW] = useState(0);
  const [paySheet, setPaySheet] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const amountRef = useRef<TextInput>(null);
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });

  const cents = parseAmount(draft.amount);
  const typed = parseFloat(draft.amount.replace(/[,\s]/g, ''));
  const amountError =
    tried && cents === null
      ? typed * 100 > MAX_CENTS
        ? 'That amount is too large.'
        : draft.kind === 'income'
          ? 'Type how much came in, like 1500 or 89.50.'
          : 'Type how much you spent, like 150 or 89.50.'
      : null;
  const categoryError = tried && !draft.category ? (draft.kind === 'income' ? 'Pick where it came from.' : 'Pick what it was for.') : null;

  useImperativeHandle(ref, () => ({
    take: () => {
      setTried(true);
      if (cents === null || !draft.category) return null;
      setTried(false);
      return { cents, category: draft.category };
    },
    focusAmount: () => amountRef.current?.focus(),
  }));

  const cats = draft.kind === 'income' ? [...INCOME_CATEGORIES] : [...CATEGORIES, ...customCategories];
  // Keep a legacy/removed category visible when editing an old entry that uses it.
  if (draft.category && !cats.includes(draft.category)) cats.push(draft.category);

  return (
    <View>
      <Segmented
        t={t}
        small
        value={draft.kind}
        onChange={(k) => set({ kind: k, category: null })}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
        style={{ width: 200 }}
      />

      <Label t={t} style={{ marginTop: 12 }}>Amount</Label>
      <Field
        ref={amountRef}
        t={t}
        big
        value={draft.amount}
        onChangeText={(v) => set({ amount: v })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoFocus={autoFocus && Platform.OS === 'web'}
        accessibilityLabel="Amount"
        error={!!amountError}
        left={<T size={26} w="semibold" color={t.muted}>{currencySymbol(currency)}</T>}
      />
      {amountError && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{amountError}</T>}

      <Label t={t} style={{ marginTop: 12 }}>{draft.kind === 'income' ? 'From where?' : 'What for?'}</Label>
      <View style={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {cats.map((c) => {
          const Icon = categoryIcon(c);
          const on = draft.category === c;
          return (
            <Pressable
              key={c}
              onPress={() => {
                set({ category: c });
                Keyboard.dismiss(); // keeps the docked Save button in reach
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c}
              style={({ pressed }) => [
                styles.cat,
                gridW ? { width: Math.floor((gridW - 3 * 8) / 4) } : null,
                {
                  backgroundColor: on ? t.accentSoft : t.surface,
                  borderColor: on ? t.accent : t.border,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
              ]}
            >
              <Icon size={20} color={on ? t.accent : t.muted} strokeWidth={1.8} />
              <T size={13} w={on ? 'semibold' : 'medium'} color={t.text} numberOfLines={1}>
                {c}
              </T>
            </Pressable>
          );
        })}
      </View>
      {categoryError && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{categoryError}</T>}

      <View style={styles.two}>
        <View style={{ flex: 1 }}>
          <Label t={t} style={{ marginTop: 12 }}>{draft.kind === 'income' ? 'Received in' : 'Paid with'}</Label>
          <PickerField t={t} icon={Wallet} label="Paid with" value={draft.paidWith || 'Cash'} onPress={() => setPaySheet(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Label t={t} style={{ marginTop: 12 }}>When</Label>
          <PickerField t={t} icon={Calendar} label="When" value={whenLabel(draft.date)} onPress={() => setDateSheet(true)} />
        </View>
      </View>

      <Label t={t} style={{ marginTop: 12 }}>
        Note <T size={14} w="medium" color={t.muted}>(optional)</T>
      </Label>
      <Field
        t={t}
        value={draft.note}
        onChangeText={(v) => set({ note: v })}
        placeholder="e.g. Jollibee lunch"
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        accessibilityLabel="Note"
      />

      <PaidWithSheet
        visible={paySheet}
        onClose={() => setPaySheet(false)}
        t={t}
        value={draft.paidWith}
        labels={labels}
        onAddLabel={onAddLabel}
        onPick={(n, g) => {
          set({ paidWith: n, group: g });
          setPaySheet(false);
        }}
      />
      <DateSheet
        visible={dateSheet}
        onClose={() => setDateSheet(false)}
        t={t}
        value={draft.date}
        onPick={(iso) => {
          set({ date: iso });
          setDateSheet(false);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: {
    width: '22.9%',
    minHeight: 58,
    borderRadius: radius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 2,
  },
  two: { flexDirection: 'row', gap: 10 },
});
