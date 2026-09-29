import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Modal, Platform, Pressable, StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useBackHandler } from './backNav';
import { formatMoney } from './data';
import { prefersReducedMotion } from './fx';
import { ChevronDown, type LucideIcon } from './lucide';
import { Theme, cardRadius, radius } from './theme';
import { Button, PigIcon, T, backdropBlur, useProgress } from './ui';

/** Money with the minus before the currency mark: "-₱620.00", never "₱-620.00" (Erina v3 review). */
export function signedMoney(cents: number, currency: string): string {
  return (cents < 0 ? '-' : '') + formatMoney(Math.abs(cents), currency);
}

// ---------- Count-up: the big numbers count up each time their tab opens (Joe, v3) ----------

export function CountUp({
  cents,
  currency,
  size,
  color,
  style,
}: {
  cents: number;
  currency: string;
  size: number;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  const p = useProgress(550);
  return (
    <T size={size} w="bold" color={color} num style={style} accessibilityLabel={signedMoney(cents, currency)}>
      {signedMoney(Math.round(cents * p), currency)}
    </T>
  );
}

// ---------- Skeleton: grey shapes with a soft shimmer while a signed-in phone's data arrives ----------

export function Skeleton({ t, w, h, r = 7, style, onGlass }: { t: Theme; w?: number | string; h: number; r?: number; style?: StyleProp<ViewStyle>; onGlass?: boolean }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prefersReducedMotion() || !width) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [x, width]);
  const base = onGlass ? (t.dark ? 'rgba(255,255,255,0.16)' : 'rgba(22,32,27,0.10)') : t.border;
  const shine = t.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.65)';
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[{ width: w as any, height: h, borderRadius: r, backgroundColor: base, overflow: 'hidden' }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width, width] }) }] },
          ]}
        >
          <Svg width={width} height={h}>
            <Defs>
              <LinearGradient id="sk" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={shine} stopOpacity={0} />
                <Stop offset="0.5" stopColor={shine} stopOpacity={1} />
                <Stop offset="1" stopColor={shine} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={h} fill="url(#sk)" />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

// ---------- Confirm pop-up: Cancel or the action, before every save, delete and sign out ----------

export function ConfirmDialog({
  visible,
  t,
  title,
  body,
  children,
  action,
  danger,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  t: Theme;
  title: string;
  body?: string;
  children?: ReactNode;
  action: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // One press only: a double tap on the action must not save twice (Kenshin L10). A ref, not state:
  // two taps can land before React re-renders (the v3 harness caught exactly that).
  const [busy, setBusy] = useState(false);
  const used = useRef(false);
  const cancelRef = useRef<View>(null);
  useBackHandler(visible, onCancel); // phone Back = Cancel, never the action
  useEffect(() => {
    if (!visible) return;
    setBusy(false);
    used.current = false;
    // Focus lands on Cancel, never on the destructive button (Kenshin L10).
    if (Platform.OS === 'web') {
      const timer = setTimeout(() => (cancelRef.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: true }), 30);
      return () => clearTimeout(timer);
    }
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, backdropBlur]} onPress={onCancel} accessibilityLabel="Cancel" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.dialog, { backgroundColor: t.surface, borderColor: t.border }]} accessibilityViewIsModal accessibilityRole="alert">
          <T size={20} w="bold" color={t.text} accessibilityRole="header">
            {title}
          </T>
          {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
          {body ? (
            <T size={15} color={t.muted} style={{ marginTop: 10, lineHeight: 22 }}>
              {body}
            </T>
          ) : null}
          <View style={styles.row}>
            <View style={{ flex: 1 }} ref={cancelRef}>
              <Button label="Cancel" kind="outline" onPress={onCancel} t={t} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={action}
                kind={danger ? 'solidDanger' : 'primary'}
                disabled={busy}
                onPress={() => {
                  if (used.current) return;
                  used.current = true;
                  setBusy(true);
                  onConfirm();
                }}
                t={t}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------- Pig beside Save: the coin drops in and the pig wiggles (pig B, Joe v3) ----------

export function PigSlot({ t, drop, label, onTap }: { t: Theme; drop: number; label: string; onTap?: () => void }) {
  const coin = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  // Tap the pig (Joe v3 test round): a happy wiggle first, then the coin shower.
  const tapped = () => {
    if (prefersReducedMotion()) return onTap?.();
    const native = Platform.OS !== 'web';
    const step = (to: number, d: number) => Animated.timing(wiggle, { toValue: to, duration: d, useNativeDriver: native });
    Animated.sequence([step(1, 70), step(-1, 110), step(1, 110), step(-1, 110), step(0, 70)]).start();
    setTimeout(() => onTap?.(), 250);
  };
  useEffect(() => {
    if (!drop) return;
    if (prefersReducedMotion()) return;
    setShown(true);
    coin.setValue(0);
    wiggle.setValue(0);
    const native = Platform.OS !== 'web';
    Animated.sequence([
      Animated.timing(coin, { toValue: 1, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 80, useNativeDriver: native }),
        Animated.timing(wiggle, { toValue: -1, duration: 120, useNativeDriver: native }),
        Animated.timing(wiggle, { toValue: 1, duration: 120, useNativeDriver: native }),
        Animated.timing(wiggle, { toValue: 0, duration: 80, useNativeDriver: native }),
      ]),
    ]).start(() => setShown(false));
  }, [drop, coin, wiggle]);
  return (
    <Pressable
      onPress={tapped}
      accessibilityRole="button"
      accessibilityLabel="Piggy bank"
      style={(s: any) => [styles.slot, { backgroundColor: t.accentSoft, transform: [{ scale: s.pressed ? 0.92 : 1 }] }]}
    >
      {shown && (
        <Animated.View
          style={[
            styles.coin,
            { backgroundColor: t.accent },
            {
              opacity: coin.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateY: coin.interpolate({ inputRange: [0, 1], outputRange: [-70, 18] }) },
                { scale: coin.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.85, 0.4] }) },
              ],
            },
          ]}
        >
          <T size={12} w="bold" color={t.accentText} num numberOfLines={1}>
            {label}
          </T>
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] }) }] }}>
        <PigIcon t={t} size={30} />
      </Animated.View>
    </Pressable>
  );
}

// ---------- Switch: on/off only (Erina: switches are for on/off, segmented for named choices) ----------

export function Switch({ t, value, onChange, label }: { t: Theme; value: boolean; onChange: (v: boolean) => void; label: string }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: prefersReducedMotion() ? 0 : 160, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [value, x]);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      style={(s: any) => [
        styles.track,
        { backgroundColor: value ? t.accent : t.border, transform: [{ scale: s.pressed ? 0.95 : 1 }] },
        Platform.OS === 'web' && s.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: t.accent, outlineOffset: 2 } as any) : null,
      ]}
    >
      <Animated.View style={[styles.knob, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
    </Pressable>
  );
}

// ---------- Chip: wallet, date and note above Save (layout C) ----------

export function Chip({
  t,
  icon: Icon,
  label,
  onPress,
  chevron,
  add,
  grow,
  a11y,
}: {
  t: Theme;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  chevron?: boolean;
  add?: boolean;
  grow?: boolean;
  a11y: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={(s: any) => [
        styles.chip,
        {
          borderColor: add ? t.accent : t.border,
          borderStyle: add ? 'dashed' : 'solid',
          backgroundColor: s.pressed ? t.accentSoft : t.surface,
          transform: [{ scale: s.pressed ? 0.95 : 1 }],
        },
        grow ? { flexGrow: 1, flexShrink: 1, minWidth: 0 } : { flexShrink: 0 },
        Platform.OS === 'web' && s.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: t.accent, outlineOffset: 2 } as any) : null,
      ]}
    >
      <Icon size={16} color={add ? t.accent : t.muted} strokeWidth={1.8} />
      <T size={15} w="medium" color={add ? t.accent : t.text} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
      {chevron && <ChevronDown size={14} color={t.muted} strokeWidth={1.8} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  dialog: { borderRadius: cardRadius, borderWidth: 1, padding: 20, paddingBottom: 18, width: '100%', maxWidth: 420, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  slot: { width: 52, height: 52, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  coin: { position: 'absolute', top: 10, minWidth: 48, height: 26, borderRadius: 13, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  track: { width: 50, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  chip: { minHeight: 44, borderRadius: radius, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
});
