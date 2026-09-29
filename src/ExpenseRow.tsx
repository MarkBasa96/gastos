import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Pencil, StickyNote } from './lucide';
import { Expense, PayLabel, Rates, SHORT_MONTHS, convert, formatMoney, paidLabel, parseLocalDate } from './data';
import { useBackHandler } from './backNav';
import { EntryForm, EntryFormHandle, draftFrom, whenLabel } from './EntryForm';
import type { CategoryTools } from './OtherPicker';
import { play } from './fx';
import { ConfirmDialog } from './motion';
import { categoryIcon } from './icons';
import { Theme, cardRadius } from './theme';
import { Button, IconTile, Row, Sheet, T, backdropBlur } from './ui';

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
  /** One tap shows the entry's details (Joe v3.1); editing is a button in there, so a stray tap changes nothing. */
  onPress: (e: Expense) => void;
}) {
  const m = money(e, currency, rates);
  const income = e.kind === 'income';
  const detail = [e.note, paidLabel(e)].filter(Boolean).join(' · ');
  const row = (
    <Row
      t={t}
      first={first}
      onPress={() => onPress(e)}
      label={`${e.category}, ${income ? 'plus' : 'minus'} ${m.main}. Tap for details.`}
    >
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
  return row;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  dialog: { borderRadius: cardRadius, borderWidth: 1, padding: 20, paddingBottom: 18, width: '100%', maxWidth: 420, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20 },
  facts: { marginTop: 16, borderTopWidth: 1 },
  fact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderBottomWidth: 1 },
  note: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});

/** One entry, as shown in a pop-up: exactly what's about to be saved or deleted (same row for both, Erina). */
export function EntryPreview({ e, t, currency, rates }: { e: Expense; t: Theme; currency: string; rates: Rates | null }) {
  const m = money(e, currency, rates);
  const income = e.kind === 'income';
  const detail = [e.paidWith || (e.method === 'card' ? 'Card' : 'Cash'), whenLabel(e.date)].join(' · ');
  return (
    <View style={{ borderRadius: 20, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={categoryIcon(e.category)} t={t} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={15} w="semibold" color={t.text} numberOfLines={1}>{e.category}</T>
          <T size={13} color={t.muted} numberOfLines={1}>{detail}</T>
        </View>
        <T size={15} w="semibold" color={income ? t.accent : t.text} num>
          {income ? '+' : '−'}
          {m.main}
        </T>
      </View>
      {/* The note on its own line, in the theme colour, so it's easy to check before saving (Joe v3.1). */}
      {e.note ? (
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
          <StickyNote size={14} color={t.accent} strokeWidth={2} />
          <T size={13} w="medium" color={t.text} style={{ flex: 1 }}>{e.note}</T>
        </View>
      ) : null}
    </View>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Tap an entry in History: everything about it in one pop-up, Edit at the top (Joe v3.1).
 * Read-only, so a stray tap can't change anything; Back, Close or a tap outside closes it.
 */
export function EntryDetails({
  e,
  t,
  currency,
  rates,
  onClose,
  onEdit,
}: {
  e: Expense | null;
  t: Theme;
  currency: string;
  rates: Rates | null;
  onClose: () => void;
  onEdit: (e: Expense) => void;
}) {
  // Keep the last entry while the pop-up fades out.
  const [shown, setShown] = useState<Expense | null>(e);
  useEffect(() => {
    if (e) setShown(e);
  }, [e]);
  const closeRef = useRef<View>(null);
  useBackHandler(!!e, onClose); // phone Back closes it, never edits
  useEffect(() => {
    if (!e || Platform.OS !== 'web') return;
    const timer = setTimeout(() => (closeRef.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: true }), 30);
    return () => clearTimeout(timer);
  }, [e]);
  const x = e ?? shown;
  if (!x) return null;
  const m = money(x, currency, rates);
  const income = x.kind === 'income';
  const d = parseLocalDate(x.date);
  const day = `${WEEKDAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const added = x.createdAt
    ? new Date(x.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const facts: [string, string][] = [
    ['Type', income ? 'Income' : 'Expense'],
    ['When', `${whenLabel(x.date)}${whenLabel(x.date) === day ? '' : ` · ${day}`}`],
    [income ? 'Received in' : 'Paid with', paidLabel(x)],
  ];
  if (m.sub) facts.push(['Typed as', m.sub]);
  if (added) facts.push(['Added', added]);
  return (
    <Modal visible={!!e} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, backdropBlur]} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.dialog, { backgroundColor: t.surface, borderColor: t.border }]} accessibilityViewIsModal>
          <View style={styles.head}>
            <IconTile icon={categoryIcon(x.category)} t={t} tint />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T size={18} w="bold" color={t.text} numberOfLines={2} accessibilityRole="header">{x.category}</T>
            </View>
            <Pressable
              onPress={() => onEdit(x)}
              accessibilityRole="button"
              accessibilityLabel={`Edit this ${income ? 'income' : 'expense'}`}
              style={(s: any) => [styles.editPill, { backgroundColor: s.pressed ? t.accent : t.accentSoft }]}
            >
              {(s: any) => (
                <>
                  <Pencil size={15} color={s.pressed ? t.accentText : t.accent} strokeWidth={2.2} />
                  <T size={15} w="semibold" color={s.pressed ? t.accentText : t.accent}>Edit</T>
                </>
              )}
            </Pressable>
          </View>
          <T size={30} w="bold" color={income ? t.accent : t.text} num style={{ marginTop: 14, letterSpacing: -0.5 }}>
            {income ? '+' : '−'}
            {m.main}
          </T>
          <View style={[styles.facts, { borderTopColor: t.border }]}>
            {facts.map(([k, v]) => (
              <View key={k} style={[styles.fact, { borderBottomColor: t.border }]}>
                <T size={14} color={t.muted}>{k}</T>
                <T size={15} w="medium" color={t.text} style={{ flexShrink: 1, textAlign: 'right' }} num>{v}</T>
              </View>
            ))}
          </View>
          {x.note ? (
            <View style={[styles.note, { backgroundColor: t.accentSoft }]}>
              <StickyNote size={16} color={t.accent} strokeWidth={2} style={{ marginTop: 2 }} />
              <T size={15} color={t.text} style={{ flex: 1, lineHeight: 21 }}>{x.note}</T>
            </View>
          ) : null}
          <View ref={closeRef} style={{ marginTop: 16 }}>
            <Button label="Close" kind="outline" onPress={onClose} t={t} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function EditSheet({
  e,
  t,
  currency,
  customCategories,
  catTools,
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
  catTools: CategoryTools;
  labels: PayLabel[];
  onAddLabel: (l: PayLabel) => void;
  onClose: () => void;
  onSave: (e: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => (e ? draftFrom(e, labels) : null));
  const [ask, setAsk] = useState<null | 'save' | 'delete'>(null);
  const [pending, setPending] = useState<Expense | null>(null);
  const form = useRef<EntryFormHandle>(null);

  useEffect(() => {
    setDraft(e ? draftFrom(e, labels) : null);
    setAsk(null);
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e || !draft) return null;
  const created = new Date(e.createdAt);
  const stamp = e.createdAt ? created.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '';

  function save() {
    const v = form.current?.take();
    if (!v || !e || !draft) return;
    const cash = draft.paidWith === '' || draft.group === 'cash';
    setPending({
      ...e,
      kind: e.kind, // locked while editing (Joe v3)
      cents: v.cents,
      category: v.category,
      note: draft.note.trim(),
      paidWith: cash ? '' : draft.paidWith,
      method: cash ? 'cash' : 'card',
      date: draft.date,
      // The amount was typed in the entry's own currency; keep it unless she's in a new one.
      currency: e.currency,
    });
    setAsk('save');
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
        catTools={catTools}
        labels={labels}
        onAddLabel={onAddLabel}
        lockKind
      />
      <Button label="Save changes" onPress={save} t={t} style={{ marginTop: 18 }} />
      <Button
        label={e.kind === 'income' ? 'Delete this income' : 'Delete this expense'}
        kind="danger"
        onPress={() => setAsk('delete')}
        t={t}
        style={{ marginTop: 4 }}
      />
      <ConfirmDialog
        visible={ask === 'save'}
        t={t}
        title="Save changes?"
        action="Save it"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          setAsk(null);
          if (pending) onSave(pending);
        }}
      >
        {pending && <EntryPreview e={pending} t={t} currency={currency} rates={null} />}
      </ConfirmDialog>
      <ConfirmDialog
        visible={ask === 'delete'}
        t={t}
        title={e.kind === 'income' ? 'Delete this income?' : 'Delete this expense?'}
        body="It’s removed from all your phones."
        action="Delete"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          setAsk(null);
          play('thud');
          onDelete(e.id);
        }}
      >
        <EntryPreview e={e} t={t} currency={currency} rates={null} />
      </ConfirmDialog>
    </Sheet>
  );
}
