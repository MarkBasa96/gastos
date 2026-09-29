import { ChevronDown, Smartphone, type LucideIcon } from './lucide';
import { ReactNode, forwardRef, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { useBackHandler } from './backNav';
import { buzz, prefersReducedMotion } from './fx';
import { Theme, cardRadius, font, radius } from './theme';

// ---------- Text ----------

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'brand';

export function T({
  children,
  size = 16,
  w = 'regular',
  color,
  style,
  num,
  ...rest
}: {
  children: ReactNode;
  size?: number;
  w?: Weight;
  color: string;
  style?: StyleProp<TextStyle>;
  num?: boolean;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text' | 'button' | 'link';
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: font[w], fontSize: size, lineHeight: Math.round(size * 1.35), color },
        num && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Label({ children, t, style }: { children: ReactNode; t: Theme; style?: StyleProp<TextStyle> }) {
  return (
    <T size={14} w="semibold" color={t.muted} style={[{ marginBottom: 8 }, style]}>
      {children}
    </T>
  );
}

// ---------- Buttons ----------

const webFocus = (t: Theme, focused?: boolean) =>
  Platform.OS === 'web' && focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: t.accent, outlineOffset: 2 } as any) : null;

export function Button({
  label,
  onPress,
  t,
  kind = 'primary',
  disabled,
  loading,
  icon: Icon,
  style,
}: {
  label: string;
  onPress: () => void;
  t: Theme;
  kind?: 'primary' | 'outline' | 'text' | 'danger' | 'solidDanger';
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const solid = kind === 'primary' || kind === 'solidDanger';
  // Solid red must read as dangerous in dark too: t.danger is a pale pink there (for text), so the fill
  // uses a deeper red with white text (5.2:1). Erina build review.
  const dangerFill = t.dark ? '#C9302C' : t.danger;
  const bg = kind === 'primary' ? t.accent : kind === 'solidDanger' ? dangerFill : kind === 'outline' ? t.surface : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'solidDanger' ? '#FFFFFF' : kind === 'danger' ? t.danger : kind === 'text' ? t.muted : t.text;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={kind === 'primary' || kind === 'solidDanger' ? () => buzz() : undefined}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={(s: any) => [
        styles.button,
        kind === 'text' || kind === 'danger' ? styles.textButton : null,
        {
          backgroundColor: bg,
          borderColor: kind === 'outline' ? t.border : 'transparent',
          // Tap state: every button answers the finger (v3). Solid ones shrink and darken.
          opacity: disabled ? 0.45 : s.pressed ? (solid ? 0.86 : 0.6) : s.hovered && solid ? 0.92 : 1,
          transform: [{ scale: s.pressed ? 0.97 : 1 }],
        },
        webFocus(t, s.focused),
        style,
      ]}
    >
      {Icon && !loading && <Icon size={20} color={fg} strokeWidth={1.9} />}
      <T size={16} w={kind === 'text' ? 'medium' : 'semibold'} color={fg}>
        {loading ? 'One moment…' : label}
      </T>
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  t,
  label,
  boxed,
  disabled,
  size = 20,
}: {
  icon: LucideIcon;
  onPress: () => void;
  t: Theme;
  label: string;
  boxed?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={(s: any) => [
        styles.iconButton,
        boxed && { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, width: 40, height: 40 },
        { opacity: disabled ? 0.35 : s.pressed ? 0.6 : 1 },
        webFocus(t, s.focused),
      ]}
    >
      <Icon size={size} color={t.text} strokeWidth={1.8} />
    </Pressable>
  );
}

// ---------- Segmented control (named choices; text or icons) ----------

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  t,
  small,
  style,
}: {
  options: { value: V; label: string; icon?: LucideIcon }[];
  value: V;
  onChange: (v: V, at?: { x: number; y: number }) => void;
  t: Theme;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const iconOnly = options.every((o) => o.icon);
  return (
    <View
      style={[
        styles.segment,
        { borderColor: t.border, backgroundColor: t.surface },
        iconOnly && { alignSelf: 'center', width: options.length * 44 + (options.length - 1) * 3 + 8 },
        style,
      ]}
      accessibilityRole="radiogroup"
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <Pressable
            key={o.value}
            onPress={(e: any) => onChange(o.value, { x: e?.nativeEvent?.pageX ?? 0, y: e?.nativeEvent?.pageY ?? 0 })}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on }}
            style={(s: any) => [
              styles.segmentItem,
              { minHeight: small ? 34 : 40 },
              iconOnly && { flexGrow: 0, flexShrink: 0, flexBasis: 44, width: 44 },
              on && { backgroundColor: t.accentSoft },
              { transform: [{ scale: s.pressed ? 0.94 : 1 }] },
              webFocus(t, s.focused),
            ]}
          >
            {Icon && iconOnly ? (
              <Icon size={18} color={on ? t.accent : t.muted} strokeWidth={1.8} />
            ) : Icon ? (
              // Icon + label: the icon says "this opens something else" (History's Dates, Erina).
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon size={15} color={on ? t.accent : t.muted} strokeWidth={1.8} />
                <T size={small ? 14 : 15} w={on ? 'semibold' : 'medium'} color={on ? t.text : t.muted}>
                  {o.label}
                </T>
              </View>
            ) : (
              <T size={small ? 14 : 15} w={on ? 'semibold' : 'medium'} color={on ? t.text : t.muted}>
                {o.label}
              </T>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Text field with a visible focus ring ----------

export const Field = forwardRef<TextInput, TextInputProps & { t: Theme; error?: boolean; big?: boolean; left?: ReactNode; right?: ReactNode }>(
  function Field({ t, error, big, left, right, style, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false);
    return (
      <View
        style={[
          styles.field,
          {
            backgroundColor: t.surface,
            borderColor: error ? t.danger : focused ? t.accent : t.border,
            borderWidth: focused || error ? 2 : 1,
            margin: focused || error ? -1 : 0, // thicker border without the layout jumping
            minHeight: big ? 62 : 48,
          },
        ]}
      >
        {left}
        <TextInput
          ref={ref}
          placeholderTextColor={t.muted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.fieldInput,
            {
              color: t.text,
              fontFamily: big ? font.bold : font.regular,
              fontSize: big ? 32 : 16,
            },
            big && { fontVariant: ['tabular-nums'] },
            style,
          ]}
          {...rest}
        />
        {right}
      </View>
    );
  },
);

/** A tappable field that opens a sheet: "Paid with" and "When". */
export function PickerField({
  icon: Icon,
  value,
  onPress,
  t,
  label,
}: {
  icon: LucideIcon;
  value: string;
  onPress: () => void;
  t: Theme;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={(s: any) => [
        styles.picker,
        { backgroundColor: t.surface, borderColor: t.border, opacity: s.pressed ? 0.7 : 1 },
        webFocus(t, s.focused),
      ]}
    >
      <Icon size={18} color={t.muted} strokeWidth={1.8} />
      <T size={16} color={t.text} numberOfLines={1} style={{ flex: 1 }}>
        {value}
      </T>
      <ChevronDown size={16} color={t.muted} strokeWidth={1.8} />
    </Pressable>
  );
}

// ---------- Containers ----------

export function Card({ children, t, style }: { children: ReactNode; t: Theme; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function Row({
  children,
  onPress,
  t,
  first,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  t: Theme;
  first?: boolean;
  label?: string;
}) {
  const inner = <View style={[styles.row, !first && { borderTopWidth: 1, borderTopColor: t.border }]}>{children}</View>;
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(s: any) => [{ backgroundColor: s.pressed ? t.accentSoft : 'transparent' }, webFocus(t, s.focused)]}
    >
      {inner}
    </Pressable>
  );
}

export function IconTile({ icon: Icon, t, tint }: { icon: LucideIcon; t: Theme; tint?: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: tint ? t.accentSoft : t.bg }]}>
      <Icon size={18} color={tint ? t.accent : t.muted} strokeWidth={1.8} />
    </View>
  );
}

// ---------- Bottom sheet (modal) ----------

export function Sheet({
  visible,
  onClose,
  t,
  title,
  subtitle,
  children,
  right,
}: {
  visible: boolean;
  onClose: () => void;
  t: Theme;
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const titleRef = useRef<View>(null);
  useBackHandler(visible, onClose); // phone Back closes the sheet
  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
      // Web: the modal library focuses its full-screen container, and the browser outlines it. Put focus
      // on the title instead: screen readers announce it first, and tabindex -1 draws no ring.
      if (Platform.OS === 'web') {
        const timer = setTimeout(() => {
          const el = titleRef.current as unknown as HTMLElement | null;
          el?.setAttribute?.('tabindex', '-1');
          el?.focus?.({ preventScroll: true });
        }, 30);
        return () => clearTimeout(timer);
      }
    }
  }, [visible, slide]);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, backdropBlur]} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { backgroundColor: t.bg },
          { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] },
        ]}
      >
        <View style={[styles.grab, { backgroundColor: t.border }]} />
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }} ref={titleRef}>
            <T size={18} w="bold" color={t.text} accessibilityRole="header">
              {title}
            </T>
            {subtitle ? (
              <T size={14} color={t.muted} style={{ marginTop: 4 }}>
                {subtitle}
              </T>
            ) : null}
          </View>
          {right}
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** Behind every pop-up and sheet, the screen goes soft (Joe v3.1). Web only; the app ships as web. */
export const backdropBlur =
  Platform.OS === 'web' ? ({ backdropFilter: 'blur(9px) saturate(120%)', WebkitBackdropFilter: 'blur(9px) saturate(120%)' } as any) : null;

// ---------- Glass hero (mesh behind a neutral scrim; text always opaque) ----------

export function GlassHero({ t, children }: { t: Theme; children: ReactNode }) {
  const [size, setSize] = useState({ w: 358, h: 120 });
  const [c1, c2, c3] = t.mesh;
  const [o1, o2, o3] = t.meshOpacity;
  return (
    <View
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[styles.hero, { borderColor: t.glassBorder }, t.dark ? null : styles.heroShadow]}
    >
      <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="b1" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c1} stopOpacity={o1} />
            <Stop offset="1" stopColor={c1} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="b2" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c2} stopOpacity={o2} />
            <Stop offset="1" stopColor={c2} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="b3" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c3} stopOpacity={o3} />
            <Stop offset="1" stopColor={c3} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* irregular, off-axis blobs: not a two-stop sweep (Erina v2 §3) */}
        <Ellipse cx={size.w * 0.12} cy={size.h * 0.05} rx={size.w * 0.62} ry={size.h * 1.1} fill="url(#b1)" />
        <Ellipse cx={size.w * 0.95} cy={size.h * 1.05} rx={size.w * 0.55} ry={size.h * 1.0} fill="url(#b2)" />
        <Ellipse cx={size.w * 0.72} cy={size.h * 0.0} rx={size.w * 0.26} ry={size.h * 0.62} fill="url(#b3)" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glass }]} />
      <View style={styles.heroContent}>{children}</View>
    </View>
  );
}

// ---------- Sync indicator ----------

// 'paused' (4.0): Joe has the "updating" switch on. Its own warm dot, so it never reads as "Offline" (Erina).
export type SyncState = 'synced' | 'saving' | 'offline' | 'waiting' | 'local' | 'paused';

export function SyncBadge({ state, waiting, t, onPress }: { state: SyncState; waiting: number; t: Theme; onPress?: () => void }) {
  const label =
    state === 'synced'
      ? 'Synced'
      : state === 'saving'
        ? 'Saving…'
        : state === 'offline'
          ? 'Offline'
          : state === 'waiting'
            ? `${waiting} waiting`
            : state === 'paused'
              ? 'Sync paused'
              : 'This phone only';
  const breathe = useRef(new Animated.Value(1)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);
  useEffect(() => {
    if (state !== 'synced' || still) {
      breathe.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 0.35, duration: 1250, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(breathe, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, still, breathe]);
  const hollow = state === 'offline' || state === 'waiting';
  const body = (
    <View style={styles.sync} accessibilityLabel={`Sync status: ${label}`}>
      {state === 'local' ? (
        <Smartphone size={13} color={t.muted} strokeWidth={2} />
      ) : (
        <Animated.View
          style={[
            styles.dot,
            hollow ? { borderWidth: 1.5, borderColor: t.muted } : { backgroundColor: state === 'paused' ? t.warning : t.accent },
            state === 'synced' && { opacity: breathe, transform: [{ scale: breathe.interpolate({ inputRange: [0.35, 1], outputRange: [0.8, 1] }) }] },
            state === 'saving' && { opacity: 0.6 },
          ]}
        />
      )}
      <T size={13} w="medium" color={t.muted}>
        {label}
      </T>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

// ---------- Piggy-bank loader: circles the ring for as long as it's shown ----------
// v3: 88 px (was 160), no trail dots. Joe: the old one was too big.

const PIG_PATH =
  'M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z';

export function PigIcon({ t, size }: { t: Theme; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PIG_PATH} fill={t.accentSoft} stroke={t.accent} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M16 10h.01" stroke={t.accent} strokeWidth={2} strokeLinecap="round" />
      <Path d="M2 8v1a2 2 0 0 0 2 2h1" stroke={t.accent} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function PigLoader({ t, label, turnMs = 1600 }: { t: Theme; label?: string; turnMs?: number }) {
  const S = 88;
  const R = 34;
  const spin = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: turnMs, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, still, turnMs]);
  return (
    <View style={styles.loaderWrap} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <View style={{ width: S, height: S }}>
        <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
          <Circle cx={S / 2} cy={S / 2} r={R} stroke={t.accentSoft} strokeWidth={4} fill="none" />
        </Svg>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
          ]}
        >
          <View style={[styles.pig, { left: S / 2 - 13, top: S / 2 - R - 13 }]}>
            <View style={[styles.coin, { backgroundColor: t.accent }]}>
              <T size={8} w="bold" color={t.accentText} style={{ lineHeight: 10 }}>
                ₱
              </T>
            </View>
            <PigIcon t={t} size={26} />
          </View>
          {/* Trail dots behind the pig (back by Joe's request, v3 test round) */}
          <View style={[styles.trail, { width: 6, height: 6, left: 31.3 - 3, top: 12.5 - 3, opacity: 0.45, backgroundColor: t.accent }]} />
          <View style={[styles.trail, { width: 5, height: 5, left: 23.1 - 2.5, top: 17.2 - 2.5, opacity: 0.3, backgroundColor: t.accent }]} />
          <View style={[styles.trail, { width: 4, height: 4, left: 17.2 - 2, top: 23.1 - 2, opacity: 0.18, backgroundColor: t.accent }]} />
        </Animated.View>
      </View>
      {label ? (
        <T size={14} color={t.muted} style={{ marginTop: 16 }}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

// ---------- Opening screen: the wide green logo on white, the pig spinner below (Joe, v3 test round) ----------
// White in both themes, so it continues Android's white splash without a flash.

// The all-green wide logo (Joe's photo 3), not logo-color.png, which is a different art version.
const LOGO_COLOR = require('../assets/brand/logo-green.png');

export function BrandLoader({ t }: { t: Theme }) {
  // The loader's pig uses the light theme's greens on the white screen, whatever the phone's theme.
  const lightT = { ...t, accent: '#1D6B45', accentSoft: '#E3F0E8', accentText: '#FFFFFF', muted: '#5B6660', dark: false };
  return (
    <View style={styles.brand} accessibilityLabel="Opening Gastos">
      <Image source={LOGO_COLOR} style={{ width: 240, height: 240 / (1983 / 793) }} resizeMode="contain" accessibilityLabel="Gastos" />
      <PigLoader t={lightT} />
    </View>
  );
}

// ---------- Opening motion: 0 -> 1 once, ease-out (count-ups, the ring drawing in) ----------

/** Runs once when the screen mounts, which is every time its tab opens. Instant under reduced motion. */
export function useProgress(ms = 550, key?: unknown): number {
  const [p, setP] = useState(() => (prefersReducedMotion() ? 1 : 0));
  useEffect(() => {
    if (prefersReducedMotion()) {
      setP(1);
      return;
    }
    let raf = 0;
    const t0 = Date.now() + 120;
    const tick = () => {
      const x = Math.min(Math.max((Date.now() - t0) / ms, 0), 1);
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    setP(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms, key]);
  return p;
}

// ---------- Donut (one hue, total in the hole) ----------

export function Donut({
  slices,
  t,
  size = 168,
  center,
}: {
  slices: { value: number; color: string }[];
  t: Theme;
  size?: number;
  center: ReactNode;
}) {
  const p = useProgress(700);
  const r = size / 2 - 18;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let off = 0;
  const gap = slices.length > 1 ? 2 : 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.accentSoft} strokeWidth={20} fill="none" />
        {slices.map((s, i) => {
          const len = (s.value / total) * c * p;
          const el = (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={s.color}
              strokeWidth={20}
              fill="none"
              strokeDasharray={`${Math.max(len - gap, 0.01)} ${c}`}
              strokeDashoffset={-off}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          off += len;
          return el;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }]}>{center}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  textButton: { minHeight: 44 },
  iconButton: { width: 44, height: 44, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius - 3, paddingHorizontal: 10 },
  field: { borderRadius: radius, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  fieldInput: { flex: 1, minWidth: 0, paddingVertical: 10, outlineWidth: 0, outlineStyle: 'none' } as any,
  picker: {
    minHeight: 44,
    borderRadius: radius,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  card: { borderRadius: cardRadius, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    borderTopLeftRadius: cardRadius,
    borderTopRightRadius: cardRadius,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  grab: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  hero: { borderRadius: cardRadius, overflow: 'hidden', borderWidth: 1 },
  heroShadow: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroContent: { paddingHorizontal: 18, paddingVertical: 14 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  loaderWrap: { alignItems: 'center', justifyContent: 'center' },
  trail: { position: 'absolute', borderRadius: 4 },
  brand: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 36 },
  pig: { position: 'absolute', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  coin: {
    position: 'absolute',
    top: -8,
    left: 12,
    width: 13,
    height: 13,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
