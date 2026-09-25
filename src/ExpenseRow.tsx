import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Expense, PayLabel, Rates, convert, formatMoney, paidLabel } from './data';
import { EntryForm, EntryFormHandle, draftFrom } from './EntryForm';
import { categoryIcon } from './icons';
import { Theme } from './theme';
import { Button, IconTile, Row, Sheet, T } from './ui';

/** Amount in the display currency; the original shows underneath when it was typed in another one. */
export function money(e: Pick<Expense, 'cents' | 'currency'>, display: string, rates: Rates | null) {
  const c = convert(e.cents, e.currency, rates, display);
  if (c === null) return { main: formatMoney(e.cents, e.currency), sub: null as string | null };
  return { main: formatMoney(c, display), sub: e.currency !== display ? formatMoney(e.cents, e.currency) : null };
}

export function ExpenseRow({
  e,
  t,
  currency,
  rates,
  first,
  onPress,
}: {
  e: Expense;
  t: Theme;
  currency: string;
  rates: Rates | null;
  first?: boolean;
  onPress: (e: Expense) => void;
}) {
  const m = money(e, currency, rates);
  const income = e.kind === 'income';
  const detail = [e.note, paidLabel(e)].filter(Boolean).join(' · ');
  return (
    <Row t={t} first={first} onPress={() => onPress(e)} label={`${e.category}, ${income ? 'plus' : 'minus'} ${m.main}. Tap to edit.`}>
      <IconTile icon={categoryIcon(e.category)} t={t} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={15} w="semibold" color={t.text} numberOfLines={1}>{e.category}</T>
        <T size={13} color={t.muted} numberOfLines={1}>{detail}</T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {/* No red on expenses: sign carries the meaning, colour marks income (Erina v2 §1) */}
        <T size={15} w="semibold" color={income ? t.accent : t.text} num>
          {income ? '+' : '−'}
          {m.main}
        </T>
        {m.sub && <T size={12} color={t.muted} num>{m.sub}</T>}
      </View>
    </Row>
  );
}

export function EditSheet({
  e,
  t,
  currency,
  customCategories,
  labels,
  onAddLabel,
  onClose,
  onSave,
  onDelete,
}: {
  e: Expense | null;
  t: Theme;
  currency: string;
  customCategories: string[];
  labels: PayLabel[];
  onAddLabel: (l: PayLabel) => void;
  onClose: () => void;
  onSave: (e: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => (e ? draftFrom(e, labels) : null));
  const [confirm, setConfirm] = useState(false);
  const form = useRef<EntryFormHandle>(null);

  useEffect(() => {
    setDraft(e ? draftFrom(e, labels) : null);
    setConfirm(false);
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);

  if (!e || !draft) return null;
  const created = new Date(e.createdAt);
  const stamp = e.createdAt ? created.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '';

  function save() {
    const v = form.current?.take();
    if (!v || !e || !draft) return;
    const cash = draft.paidWith === '' || draft.group === 'cash';
    onSave({
      ...e,
      kind: draft.kind,
      cents: v.cents,
      category: v.category,
      note: draft.note.trim(),
      paidWith: cash ? '' : draft.paidWith,
      method: cash ? 'cash' : 'card',
      date: draft.date,
      // The amount was typed in the entry's own currency; keep it unless she's in a new one.
      currency: e.currency,
    });
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      t={t}
      title={e.kind === 'income' ? 'Edit income' : 'Edit expense'}
      right={stamp ? <T size={13} color={t.muted} style={{ marginTop: 4 }}>Added {stamp}</T> : null}
    >
      <EntryForm
        ref={form}
        t={t}
        draft={draft}
        onChange={setDraft}
        currency={e.currency}
        customCategories={customCategories}
        labels={labels}
        onAddLabel={onAddLabel}
      />
      <Button label="Save changes" onPress={save} t={t} style={{ marginTop: 18 }} />
      <Button
        label={confirm ? 'Tap again to delete' : e.kind === 'income' ? 'Delete this income' : 'Delete this expense'}
        kind={confirm ? 'danger' : 'text'}
        onPress={() => (confirm ? onDelete(e.id) : setConfirm(true))}
        t={t}
        style={{ marginTop: 4 }}
      />
    </Sheet>
  );
}
