import { Check, Pencil, Pin, Plus, Search, Tag, X } from './lucide';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useBackHandler } from './backNav';
import { CATEGORIES, INCOME_CATEGORIES, Kind, cleanCategoryName } from './data';
import { Theme, cardRadius, font, radius } from './theme';
import { Button, Field, T, backdropBlur } from './ui';

// "What was it?" (Joe v3.1, mockup rounds 3 and 5): the grid keeps its 8 tiles, and her own names
// live here. Pinned ones on top, the rest most used first, a search box that also takes a new name,
// and a pencil on each to rename it or take it off the list.

export type CategoryTools = {
  list: string[];
  pinned: string[];
  /** How many expenses use each name, for "most used first" and "rename my N past entries". */
  usage: Record<string, number>;
  togglePin: (name: string) => void;
  /** Throws when past entries can't be renamed (signed in and offline). */
  rename: (from: string, to: string, renamePast: boolean) => Promise<void>;
  remove: (name: string) => void;
};

const ROW = 48;
const BOX = 266; // about 5 rows: a cut-off last row says "there's more, scroll"

function Modalish({ visible, t, onClose, children, top }: { visible: boolean; t: Theme; onClose: () => void; children: ReactNode; top?: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, backdropBlur]} onPress={onClose} accessibilityLabel="Cancel" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.dialog, { backgroundColor: t.surface, borderColor: t.border }, top && { zIndex: 2 }]} accessibilityViewIsModal>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function Tick({ t, on, onPress, children }: { t: Theme; on: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} style={styles.tick}>
      <View style={[styles.box, on ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.border }]}>
        {on && <Check size={14} color={t.accentText} strokeWidth={3} />}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

/** The list scrolls in its own box, with a bar on the right that stays visible (phones hide theirs). */
function ListBox({ t, fixed, children }: { t: Theme; fixed: boolean; children: ReactNode }) {
  const [view, setView] = useState(0);
  const [content, setContent] = useState(0);
  const [y, setY] = useState(0);
  const scrolls = content > view + 1 && view > 0;
  const thumb = scrolls ? Math.max(32, (view * view) / content) : 0;
  const top = scrolls ? (y / (content - view)) * (view - 12 - thumb) + 6 : 0;
  return (
    <View style={[styles.listBox, { borderColor: t.border, backgroundColor: t.bg }, fixed ? { height: BOX } : { maxHeight: BOX }]}>
      <ScrollView
        onLayout={(e) => setView(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContent(h)}
        onScroll={(e) => setY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={Platform.OS === 'web' ? ({ scrollbarWidth: 'none' } as any) : null}
      >
        {children}
      </ScrollView>
      {scrolls && (
        <View pointerEvents="none" style={[styles.track, { backgroundColor: t.border }]}>
          <View style={[styles.thumb, { backgroundColor: t.muted, height: thumb, top: top - 6 }]} />
        </View>
      )}
    </View>
  );
}

/** The typed part of a name, in the theme colour. */
function Highlight({ t, name, q }: { t: Theme; name: string; q: string }) {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <T size={16} color={t.text} numberOfLines={1} style={{ flex: 1 }}>{name}</T>;
  return (
    <T size={16} color={t.text} numberOfLines={1} style={{ flex: 1 }}>
      {name.slice(0, i)}
      <T size={16} w="bold" color={t.accent}>{name.slice(i, i + q.length)}</T>
      {name.slice(i + q.length)}
    </T>
  );
}

export function OtherPicker({
  visible,
  t,
  kind,
  initial,
  canKeep,
  tools,
  onDone,
  onCancel,
}: {
  visible: boolean;
  t: Theme;
  kind: Kind;
  initial: string;
  /** Offer "Save to my list" for a new name (the Log screen; editing an entry doesn't). */
  canKeep: boolean;
  tools: CategoryTools;
  /** name = '' keeps plain Other; keep = add a new name to her list. */
  onDone: (name: string, keep: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [keep, setKeep] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setText(initial);
    setKeep(true);
    setEditing(null);
    // Web: focus the search box once the pop-up is in (autoFocus inside a modal is unreliable there).
    const timer = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useBackHandler(visible && !editing, onCancel); // Back = Cancel

  const income = kind === 'income';
  const q = cleanCategoryName(text);
  const ql = q.toLowerCase();
  const builtIns = [...CATEGORIES, ...INCOME_CATEGORIES];
  const known = q ? [...builtIns, ...tools.list].find((c) => c.toLowerCase() === ql) : undefined;
  const isNew = !!q && !known;

  // Her list is for expenses; income keeps a plain "where from?" box.
  const { pinned, rest } = useMemo(() => {
    if (income) return { pinned: [] as string[], rest: [] as string[] };
    const match = (n: string) => !ql || n.toLowerCase().includes(ql);
    const pinned = tools.pinned.filter((n) => tools.list.includes(n) && match(n));
    const rest = tools.list
      .filter((n) => !tools.pinned.includes(n) && match(n))
      .sort((a, b) => (tools.usage[b] ?? 0) - (tools.usage[a] ?? 0) || a.localeCompare(b));
    return { pinned, rest };
  }, [income, ql, tools]);
  const total = pinned.length + rest.length;

  function finish(name: string, keepIt: boolean) {
    Keyboard.dismiss();
    onDone(name, keepIt);
  }
  const done = () => finish(known ?? q, isNew && canKeep && !income && keep);

  const row = (n: string, on: boolean, first: boolean) => (
    <View key={n} style={[styles.row, !first && { borderTopWidth: 1, borderTopColor: t.border }]}>
      <Pressable
        onPress={() => finish(n, false)}
        accessibilityRole="button"
        accessibilityLabel={`Use ${n}`}
        style={(s: any) => [styles.rowMain, s.pressed && { backgroundColor: t.accentSoft }]}
      >
        <Tag size={18} color={t.muted} strokeWidth={1.8} />
        <Highlight t={t} name={n} q={q} />
      </Pressable>
      <Pressable onPress={() => setEditing(n)} accessibilityRole="button" accessibilityLabel={`Edit ${n}`} hitSlop={4} style={styles.iconBtn}>
        <Pencil size={16} color={t.muted} strokeWidth={2} />
      </Pressable>
      <Pressable
        onPress={() => tools.togglePin(n)}
        accessibilityRole="button"
        accessibilityLabel={on ? `Unpin ${n}` : `Pin ${n}`}
        aria-pressed={on}
        hitSlop={4}
        style={[styles.iconBtn, on && { backgroundColor: t.accentSoft }]}
      >
        <Pin size={17} color={on ? t.accent : t.muted} fill={on ? t.accent : 'none'} strokeWidth={2} />
      </Pressable>
    </View>
  );

  return (
    <>
      <Modalish visible={visible} t={t} onClose={onCancel}>
        <T size={20} w="bold" color={t.text} accessibilityRole="header">{income ? 'Where did it come from?' : 'What was it?'}</T>
        <View style={{ marginTop: 14 }}>
          <Field
            ref={input}
            t={t}
            value={text}
            onChangeText={setText}
            placeholder={income ? 'e.g. Bonus' : 'Search, or type a new one'}
            maxLength={24}
            returnKeyType="done"
            onSubmitEditing={done}
            accessibilityLabel={income ? 'Where did it come from?' : 'What was it?'}
            left={<Search size={18} color={t.muted} strokeWidth={2} />}
            right={
              text ? (
                <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel="Clear" hitSlop={10}>
                  <X size={16} color={t.muted} strokeWidth={2} />
                </Pressable>
              ) : undefined
            }
          />
        </View>

        {isNew && !income && (
          <>
            <Pressable
              onPress={done}
              accessibilityRole="button"
              accessibilityLabel={`Use ${q}`}
              style={(s: any) => [styles.useNew, { borderColor: t.accent, backgroundColor: s.pressed ? t.accent : t.accentSoft }]}
            >
              {(s: any) => (
                <>
                  <Plus size={18} color={s.pressed ? t.accentText : t.accent} strokeWidth={2.2} />
                  <T size={16} w="semibold" color={s.pressed ? t.accentText : t.accent} numberOfLines={1} style={{ flex: 1 }}>Use “{q}”</T>
                </>
              )}
            </Pressable>
            {canKeep && (
              <Tick t={t} on={keep} onPress={() => setKeep(!keep)}>
                <T size={14} w="medium" color={t.text}>Save “{q}” to my list</T>
              </Tick>
            )}
          </>
        )}
        {!!q && known && !tools.list.includes(known) && (
          <T size={13} color={t.muted} style={{ marginTop: 10 }}>Saves under {known}.</T>
        )}
        {!q && income && (
          <T size={13} color={t.muted} style={{ marginTop: 10, lineHeight: 18 }}>Optional. Leave it empty to save as plain Other income.</T>
        )}

        {!income && (tools.list.length > 0 ? (
          <>
            <View style={styles.listHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                <T size={13} w="semibold" color={t.muted}>Your list · tap</T>
                <Pin size={12} color={t.muted} strokeWidth={2.2} />
                <T size={13} w="semibold" color={t.muted}>to keep one on top</T>
              </View>
              <T size={13} w="semibold" color={t.muted} num>{total}</T>
            </View>
            {total ? (
              <ListBox t={t} fixed={tools.list.length > 4}>
                {pinned.length > 0 && <T size={12} w="bold" color={t.muted} style={styles.section}>PINNED</T>}
                {pinned.map((n, i) => row(n, true, i === 0))}
                {rest.length > 0 && <T size={12} w="bold" color={t.muted} style={styles.section}>{q ? 'IN YOUR LIST' : 'MOST USED'}</T>}
                {rest.map((n, i) => row(n, false, i === 0))}
              </ListBox>
            ) : (
              <View style={[styles.listBox, { borderColor: t.border, backgroundColor: t.bg, padding: 14 }]}>
                <T size={14} color={t.muted}>Nothing in your list matches “{q}”.</T>
              </View>
            )}
          </>
        ) : (
          <T size={13} color={t.muted} style={{ marginTop: 10, lineHeight: 18 }}>
            {q ? '' : 'Optional. Leave it empty to save as plain Other. Names you save show up here next time.'}
          </T>
        ))}

        <View style={styles.buttons}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" kind="outline" onPress={onCancel} t={t} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Done" onPress={done} t={t} />
          </View>
        </View>
      </Modalish>

      <EditName t={t} name={editing} tools={tools} onClose={() => setEditing(null)} />
    </>
  );
}

/** Round 5: rename a name (and, ticked by default, the past entries that use it), or remove it. */
function EditName({ t, name, tools, onClose }: { t: Theme; name: string | null; tools: CategoryTools; onClose: () => void }) {
  const [text, setText] = useState('');
  const [past, setPast] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(name);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  // Reset while rendering, not in an effect: an effect lands one render late, so anything typed in
  // that gap got the old name glued onto it ("coffeeTuition").
  if (name !== openFor) {
    setOpenFor(name);
    if (name) {
      setShown(name);
      setText(name);
      setPast(true);
      setBusy(false);
      setErr(null);
    }
  }
  useEffect(() => {
    if (!name) return;
    const timer = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [name]);
  useBackHandler(!!name, onClose);

  const n = name ?? shown ?? '';
  const q = cleanCategoryName(text);
  const count = tools.usage[n] ?? 0;
  const builtIn = [...CATEGORIES, ...INCOME_CATEGORIES].find((c) => c.toLowerCase() === q.toLowerCase());
  const other = tools.list.find((c) => c !== n && c.toLowerCase() === q.toLowerCase());
  const target = builtIn ?? other ?? q;
  const same = target === n;

  async function save() {
    if (!q || busy) return;
    if (same) return onClose();
    setBusy(true);
    setErr(null);
    try {
      await tools.rename(n, target, past && count > 0);
      onClose();
    } catch {
      setErr('Renaming past entries needs the internet. Try again online, or untick the box to rename only the list.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modalish visible={!!name} t={t} onClose={onClose} top>
      <T size={20} w="bold" color={t.text} accessibilityRole="header" numberOfLines={2}>Edit “{n}”</T>
      <View style={{ marginTop: 14 }}>
        <Field
          ref={input}
          t={t}
          value={text}
          onChangeText={setText}
          maxLength={24}
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel={`New name for ${n}`}
          left={<Tag size={18} color={t.accent} strokeWidth={2} />}
          right={
            text ? (
              <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel="Clear" hitSlop={10}>
                <X size={16} color={t.muted} strokeWidth={2} />
              </Pressable>
            ) : undefined
          }
        />
      </View>
      {count > 0 && (
        <Tick t={t} on={past} onPress={() => setPast(!past)}>
          <T size={14} w="medium" color={t.text}>
            Rename my {count} past {count === 1 ? 'entry' : 'entries'} too
          </T>
          <T size={13} color={t.muted}>So History and the charts stay together</T>
        </Tick>
      )}
      {!same && (builtIn || other) && (
        <T size={13} color={t.muted} style={{ marginTop: 10, lineHeight: 18 }}>
          {builtIn ? `“${builtIn}” is one of the 8 built-in tiles.` : `“${other}” is already in your list.`} Saving merges “{n}” into it.
        </T>
      )}
      {err && <T size={13} color={t.danger} style={{ marginTop: 10, lineHeight: 18 }}>{err}</T>}
      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" kind="outline" onPress={onClose} t={t} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Save" onPress={save} t={t} loading={busy} disabled={!q} />
        </View>
      </View>
      <Pressable
        onPress={() => {
          tools.remove(n);
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${n} from my list`}
        style={(s: any) => [styles.remove, { borderColor: t.danger, backgroundColor: s.pressed ? t.bg : 'transparent' }]}
      >
        <X size={16} color={t.danger} strokeWidth={2.4} />
        <T size={15} w="semibold" color={t.danger}>Remove from my list</T>
      </Pressable>
      <T size={12} color={t.muted} style={{ textAlign: 'center', marginTop: 8 }}>Past entries keep their name if you remove it.</T>
    </Modalish>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  dialog: { borderRadius: cardRadius, borderWidth: 1, padding: 18, paddingBottom: 16, width: '100%', maxWidth: 440, alignSelf: 'center' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, minHeight: 32 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  useNew: { marginTop: 12, minHeight: 52, borderWidth: 1.5, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  listHead: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 8, paddingHorizontal: 2 },
  listBox: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  section: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 5, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: ROW, paddingRight: 18 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: ROW, paddingLeft: 14 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', top: 6, bottom: 6, right: 5, width: 5, borderRadius: 3, opacity: 0.8 },
  thumb: { position: 'absolute', left: 0, right: 0, borderRadius: 3 },
  remove: { marginTop: 10, minHeight: 48, borderWidth: 1.5, borderRadius: radius, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: { fontFamily: font.regular },
});
