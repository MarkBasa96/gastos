import { Calendar, Lock, Pencil, StickyNote, Wallet } from './lucide';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  CATEGORIES,
  Expense,
  cleanCategoryName,
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
import { Chip } from './motion';
import { CategoryTools, OtherPicker } from './OtherPicker';
import { DateSheet, PaidWithSheet } from './sheets';
import { Theme, radius } from './theme';
import { Field, Label, Segmented, T } from './ui';

export type Draft = {
  kind: Kind;
  amount: string;
  category: string | null;
  paidWith: string; // '' = Cash
  group: PayGroup;
  date: string;
  note: string;
  /** Tapped Other: what it really was, like "Haircut" (Joe v3.1). Empty = plain Other. */
  other: string;
  /** Keep that name as a tile for next time (expenses only). */
  keepOther: boolean;
};

const OTHER = new Set(['Other', 'Other income']);
export function emptyDraft(last?: { paidWith: string; group: PayGroup }): Draft {
  return {
    kind: 'expense',
    amount: '',
    category: null,
    paidWith: last?.paidWith ?? '',
    group: last?.group ?? 'cash',
    date: localDate(),
    note: '',
    other: '',
    keepOther: true,
  };
}

export function draftFrom(e: Expense, labels: PayLabel[]): Draft {
  const builtIn = (e.kind === 'income' ? INCOME_CATEGORIES : CATEGORIES).includes(e.category);
  const g = e.paidWith ? labels.find((l) => l.n === e.paidWith)?.g ?? 'card' : e.method === 'card' ? 'card' : 'cash';
  return {
    kind: e.kind,
    amount: (e.cents / 100).toFixed(2),
    // Her own names (and old v1 ones) live behind Other now (v3.1), so the grid stays at 8 tiles.
    category: builtIn ? e.category : e.kind === 'income' ? 'Other income' : 'Other',
    paidWith: e.paidWith || (e.method === 'card' ? 'Card' : ''),
    group: g,
    date: e.date,
    note: e.note,
    other: builtIn ? '' : e.category,
    keepOther: false,
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
  take: () => { cents: number; category: string; newTile: string | null } | null;
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
    /** Her list behind Other: pins, most used, rename, remove (v3.1). */
    catTools: CategoryTools;
    /** Extra space (px) added above each section, so the Log screen fills the phone (v3.1). */
    spread?: number;
    labels: PayLabel[];
    onAddLabel: (l: PayLabel) => void;
    onSubmit?: () => void;
    /** Editing: an expense stays an expense and income stays income (Joe, v3). */
    lockKind?: boolean;
    /** Offer "Keep as a tile" for a named Other (the Log screen; editing doesn't). */
    canKeep?: boolean;
  }
>(function EntryForm({ t, draft, onChange, currency, customCategories, catTools, spread = 0, labels, onAddLabel, onSubmit, lockKind, canKeep }, ref) {
  const [tried, setTried] = useState(false);
  const [gridW, setGridW] = useState(0);
  const [paySheet, setPaySheet] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Tapping Other asks "What was it?" in a pop-up (Joe v3.1). Cancel puts back what was picked before.
  const [otherAsk, setOtherAsk] = useState<{ category: string | null; other: string } | null>(null);
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

  const cats = draft.kind === 'income' ? [...INCOME_CATEGORIES] : [...CATEGORIES];
  // Keep a legacy/removed category visible when editing an old entry that uses it.
  if (draft.category && !cats.includes(draft.category)) cats.push(draft.category);

  const otherOn = !!draft.category && OTHER.has(draft.category);
  const otherName = otherOn ? cleanCategoryName(draft.other) : '';
  // "food" typed into Other is just Food; any known name keeps its own spelling.
  const known = [...CATEGORIES, ...INCOME_CATEGORIES, ...customCategories].find((c) => c.toLowerCase() === otherName.toLowerCase());
  const isNewName = !!otherName && !known;
  const showKeep = !!canKeep && draft.kind === 'expense' && isNewName;

  useImperativeHandle(ref, () => ({
    take: () => {
      setTried(true);
      if (cents === null || !draft.category) return null;
      setTried(false);
      setNoteOpen(false); // the note shows as a box again, whatever the browser did with focus
      const category = otherName ? known ?? otherName : draft.category;
      return { cents, category, newTile: showKeep && draft.keepOther ? otherName : null };
    },
    focusAmount: () => amountRef.current?.focus(),
  }));

  return (
    <View>
      {lockKind ? (
        <View>
          <View style={[styles.locked, { borderColor: t.border, backgroundColor: t.surface }]} accessibilityLabel={`${draft.kind === 'income' ? 'Income' : 'Expense'}. Can't be changed while editing.`}>
            {(['expense', 'income'] as const).map((k) => {
              const on = draft.kind === k;
              return (
                <View key={k} style={[styles.lockedItem, on && { backgroundColor: t.accentSoft }, !on && { opacity: 0.45 }]}>
                  {!on && <Lock size={13} color={t.muted} strokeWidth={2} />}
                  <T size={14} w={on ? 'semibold' : 'medium'} color={on ? t.text : t.muted}>{k === 'expense' ? 'Expense' : 'Income'}</T>
                </View>
              );
            })}
          </View>
          <T size={13} color={t.muted} style={{ marginTop: 8, lineHeight: 18 }}>
            {draft.kind === 'income'
              ? 'An income stays an income. To make it an expense, delete it and log it again.'
              : 'An expense stays an expense. To make it income, delete it and log it again.'}
          </T>
        </View>
      ) : (
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
      )}

      <Label t={t} style={{ marginTop: 12 + spread }}>Amount</Label>
      <Field
        ref={amountRef}
        t={t}
        big
        value={draft.amount}
        onChangeText={(v) => set({ amount: v })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        inputMode="decimal"
        accessibilityLabel="Amount"
        error={!!amountError}
        left={<T size={26} w="semibold" color={t.muted}>{currencySymbol(currency)}</T>}
      />
      {amountError && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{amountError}</T>}

      <Label t={t} style={{ marginTop: 12 + spread }}>{draft.kind === 'income' ? 'From where?' : 'What for?'}</Label>
      <View style={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {cats.map((c) => {
          const Icon = categoryIcon(c);
          const on = draft.category === c;
          return (
            <Pressable
              key={c}
              onPress={() => {
                if (OTHER.has(c)) {
                  setOtherAsk({ category: draft.category, other: draft.other });
                  set({ category: c, other: on ? draft.other : '' });
                  return;
                }
                set({ category: c });
                Keyboard.dismiss(); // keeps Save in reach, right under the chips
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={on && OTHER.has(c) && otherName ? `${c}: ${otherName}` : c}
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
              {on && OTHER.has(c) && (
                <View style={styles.pen}>
                  <Pencil size={11} color={t.accent} strokeWidth={2.2} />
                </View>
              )}
              <Icon size={20} color={on ? t.accent : t.muted} strokeWidth={1.8} />
              {/* Long names ("Other income") drop to 12 so they fit a quarter-width tile (Erina) */}
              {(() => {
                const shown = on && OTHER.has(c) && otherName ? otherName : c;
                return (
                  <T size={shown.length > 10 ? 12 : 13} w={on ? 'semibold' : 'medium'} color={t.text} numberOfLines={1} style={{ maxWidth: '92%' }}>
                    {shown}
                  </T>
                );
              })()}
            </Pressable>
          );
        })}
      </View>
      {categoryError && <T size={14} color={t.danger} style={{ marginTop: 6 }}>{categoryError}</T>}

      {/* Layout C (Joe v3): wallet and date as chips, so Save sits right under What for? */}
      <View style={[styles.chips, { marginTop: 12 + spread }]}>
        <Chip t={t} icon={Wallet} label={draft.paidWith || 'Cash'} chevron onPress={() => setPaySheet(true)}
          a11y={`${draft.kind === 'income' ? 'Received in' : 'Paid with'}: ${draft.paidWith || 'Cash'}`} />
        <Chip t={t} icon={Calendar} label={whenLabel(draft.date)} chevron onPress={() => setDateSheet(true)} a11y={`When: ${whenLabel(draft.date)}`} />
      </View>

      {/* The note gets its own full-width box in the theme colour, easy to spot (Joe v3.1). The
          keyboard still only opens when she taps it. */}
      {noteOpen ? (
        <View style={{ marginTop: 12 + spread }}>
          <Field
            t={t}
            value={draft.note}
            onChangeText={(v) => set({ note: v })}
            placeholder="e.g. Jollibee lunch"
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              setNoteOpen(false);
              onSubmit?.();
            }}
            onBlur={() => setNoteOpen(false)}
            accessibilityLabel="Note"
            left={<StickyNote size={20} color={t.accent} strokeWidth={2} />}
          />
        </View>
      ) : (
        <Pressable
          onPress={() => setNoteOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={draft.note.trim() ? `Note: ${draft.note.trim()}. Tap to change.` : 'Add a note'}
          style={(st: any) => [
            styles.note,
            { marginTop: 12 + spread },
            { borderColor: t.accent, backgroundColor: t.accentSoft, transform: [{ scale: st.pressed ? 0.98 : 1 }] },
            Platform.OS === 'web' && st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: t.accent, outlineOffset: 2 } as any) : null,
          ]}
        >
          <StickyNote size={20} color={t.accent} strokeWidth={2} />
          {draft.note.trim() ? (
            <>
              <T size={15} w="medium" color={t.text} numberOfLines={1} style={{ flex: 1 }}>{draft.note.trim()}</T>
              <Pencil size={16} color={t.accent} strokeWidth={2} />
            </>
          ) : (
            <>
              <T size={15} w="medium" color={t.muted} numberOfLines={1} style={{ flex: 1 }}>Add a note, like “Jollibee lunch”</T>
              <T size={12} w="semibold" color={t.accent}>Optional</T>
            </>
          )}
        </Pressable>
      )}

      <OtherPicker
        visible={!!otherAsk}
        t={t}
        kind={draft.kind}
        initial={draft.other}
        canKeep={!!canKeep}
        tools={catTools}
        onCancel={() => {
          if (otherAsk) set({ category: otherAsk.category, other: otherAsk.other });
          setOtherAsk(null);
        }}
        onDone={(name, keep) => {
          set({ other: name, keepOther: keep });
          setOtherAsk(null);
        }}
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
  chips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pen: { position: 'absolute', top: 5, right: 6 },
  keep: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, minHeight: 32 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  note: { marginTop: 12, minHeight: 50, borderWidth: 1.5, borderRadius: radius, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  locked: { flexDirection: 'row', borderWidth: 1, borderRadius: radius, padding: 3, gap: 3, width: 220 },
  lockedItem: { flex: 1, minHeight: 34, borderRadius: radius - 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
});
