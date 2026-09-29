import { Check, ChevronDown, ChevronUp, Search } from './lucide';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { COLOR_THEMES, COLOR_THEME_NAMES, ColorTheme, Theme, font, radius, themeFor } from './theme';
import { Card, Sheet, T } from './ui';

// ---------- Colour theme picker (Joe v3.1) ----------

/** The top card in miniature, drawn in that theme: its glow, a sample amount and the button colour. */
function MiniHero({ th, id }: { th: Theme; id: string }) {
  // Gradient ids are global on web: each card needs its own, or all eight draw the first one's colours.
  const [w, setW] = useState(150);
  const h = 56;
  const [c1, c2, c3] = th.mesh;
  const [o1, o2, o3] = th.meshOpacity;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[styles.mini, { backgroundColor: th.bg }]}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`m1-${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c1} stopOpacity={o1} />
            <Stop offset="1" stopColor={c1} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`m2-${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c2} stopOpacity={o2} />
            <Stop offset="1" stopColor={c2} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`m3-${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c3} stopOpacity={o3} />
            <Stop offset="1" stopColor={c3} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={w * 0.12} cy={h * 0.05} rx={w * 0.62} ry={h * 1.1} fill={`url(#m1-${id})`} />
        <Ellipse cx={w * 0.95} cy={h * 1.05} rx={w * 0.55} ry={h * 1.0} fill={`url(#m2-${id})`} />
        <Ellipse cx={w * 0.72} cy={0} rx={w * 0.26} ry={h * 0.62} fill={`url(#m3-${id})`} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: th.glass }]} />
      <T size={15} w="bold" color={th.text} num>₱7,713</T>
      <View style={[styles.miniBar, { backgroundColor: th.accent }]} />
    </View>
  );
}

export function ThemeSheet({
  visible,
  onClose,
  t,
  value,
  signedIn,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  value: ColorTheme;
  signedIn: boolean;
  onPick: (c: ColorTheme) => void;
}) {
  const mode = t.dark ? 'dark' : 'light';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      t={t}
      title="Color theme"
      subtitle={
        signedIn
          ? 'Pick the color you like. Light and dark both follow it, on every phone you sign in on.'
          : 'Pick the color you like. Light and dark both follow it.'
      }
    >
      <View style={styles.themes} accessibilityRole="radiogroup">
        {COLOR_THEMES.map((k) => {
          const on = k === value;
          return (
            <Pressable
              key={k}
              onPress={() => onPick(k)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={COLOR_THEME_NAMES[k]}
              style={(s: any) => [
                styles.theme,
                { backgroundColor: t.surface, borderColor: on ? t.accent : t.border, borderWidth: on ? 2 : 1, padding: on ? 7 : 8 },
                { transform: [{ scale: s.pressed ? 0.97 : 1 }] },
              ]}
            >
              <MiniHero th={themeFor(k, mode)} id={k} />
              {on && (
                <View style={[styles.tick, { backgroundColor: t.accent }]}>
                  <Check size={14} color={t.accentText} strokeWidth={3} />
                </View>
              )}
              <T size={14} w="semibold" color={t.text} style={{ marginTop: 8, paddingHorizontal: 2 }} numberOfLines={1}>
                {COLOR_THEME_NAMES[k]}
              </T>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

// ---------- FAQ (Joe v3.1): ships inside the app, so it works offline ----------

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Where are my entries saved?',
    a: 'On this phone first, so Gastos works with no signal. If you sign in, they also back up to your account and show on your other phones.',
  },
  {
    q: 'How safe is my data?',
    a: 'Each account can only ever see its own entries: the database itself enforces that, not just the app. Your MPIN is stored scrambled where even the app can’t read it. “Paid with” holds names only, never card or account numbers. Sign-in uses a one-time code sent to your email, so there’s no password to leak. The MPIN keeps casual eyes out; keep your phone’s own screen lock on too.',
  },
  {
    q: 'Is there a backup?',
    a: 'Yes, two kinds. Sign in and every entry backs up to your account by itself. You can also save a backup file any time from Settings → Back up to a file, and bring it back with Restore from a file. “Add what’s missing” only adds entries; it never overwrites newer ones.',
  },
  {
    q: 'What does “3 waiting” mean?',
    a: 'Those entries are saved on this phone but haven’t reached your account yet, usually because you’re offline. They upload by themselves once you’re back online. Tap the status to try right away.',
  },
  {
    q: 'Can I use Gastos with no internet?',
    a: 'Yes. It opens and logs with no signal, and syncs later. Only switching currency and sending feedback need the internet.',
  },
  {
    q: 'I forgot my MPIN. What do I do?',
    a: 'On the MPIN screen, tap “Forgot MPIN?”. We email you a code; enter it and set a new MPIN. After 5 wrong tries, across all your phones, an email code is needed too.',
  },
  {
    q: 'How do I edit or delete an entry?',
    a: 'In History, tap the entry to see all its details, then tap Edit at the top. From there you can change it or delete it. Just looking never changes anything.',
  },
  {
    q: 'How do I add my own category?',
    a: 'When logging, tap Other and type a name, like “Haircut”. Leave “Keep as a tile” ticked and it shows up next time. You can also add and remove them in Settings → Categories.',
  },
  {
    q: 'How do I change the color?',
    a: 'Settings → Color theme. Pick one and the whole app follows it, in light and dark. When you’re signed in, your other phones follow it too.',
  },
  {
    q: 'How does currency conversion work?',
    a: 'Settings → Currency shows every amount in the currency you pick, at today’s rate. Your original amounts are always kept, so switching back is exact.',
  },
  {
    q: 'How do I install Gastos on my phone?',
    a: 'Android: download the app from the Gastos releases page, or open Gastos in Chrome and choose Add to Home screen. iPhone: open it in Safari, tap Share, then Add to Home Screen.',
  },
];

export function FaqSheet({ visible, onClose, t }: { visible: boolean; onClose: () => void; t: Theme }) {
  const [open, setOpen] = useState<number>(0);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ.map((f, i) => ({ ...f, i })).filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [query]);
  return (
    <Sheet visible={visible} onClose={onClose} t={t} title="FAQ" subtitle="Quick answers about Gastos. Still stuck? Send feedback from Settings.">
      <View style={[styles.search, { borderColor: t.border, backgroundColor: t.surface }]}>
        <Search size={17} color={t.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search questions"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search questions"
          style={[styles.searchInput, { color: t.text }]}
        />
      </View>
      <Card t={t} style={{ marginTop: 12 }}>
        {shown.length === 0 ? (
          <T size={15} color={t.muted} style={{ padding: 16 }}>
            No question matches “{query.trim()}”. Try another word, or send feedback.
          </T>
        ) : (
          shown.map((f, n) => {
            const on = open === f.i;
            const Chev = on ? ChevronUp : ChevronDown;
            return (
              <View key={f.i} style={[n > 0 && { borderTopWidth: 1, borderTopColor: t.border }, on && { backgroundColor: t.accentSoft }]}>
                <Pressable
                  onPress={() => setOpen(on ? -1 : f.i)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: on }}
                  aria-expanded={on}
                  accessibilityLabel={f.q}
                  style={styles.q}
                >
                  <T size={15} w="semibold" color={t.text} style={{ flex: 1 }}>{f.q}</T>
                  <Chev size={18} color={on ? t.accent : t.muted} />
                </Pressable>
                {on && (
                  <T size={15} color={t.text} style={styles.a}>
                    {f.a}
                  </T>
                )}
              </View>
            );
          })
        )}
      </Card>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  theme: { width: '48.4%', borderRadius: 16 },
  mini: { height: 56, borderRadius: 11, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 8 },
  miniBar: { marginTop: 5, height: 10, width: 56, borderRadius: 5 },
  tick: { position: 'absolute', top: 13, right: 13, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 16, paddingVertical: 10, outlineStyle: 'none' } as any,
  q: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  a: { paddingHorizontal: 16, paddingBottom: 14, lineHeight: 22 },
});
