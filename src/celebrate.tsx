import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { prefersReducedMotion } from './fx';
import { Check, Send } from './lucide';
import { Theme } from './theme';
import { T } from './ui';

// Joe's v3 test round: small moments of delight. All decorative: pointerEvents none, hidden from
// screen readers, skipped under reduced motion.

const native = Platform.OS !== 'web';
const GOLD = '#F2C230';
const GOLD_DARK = '#C8961A';
const GOLD_LIGHT = '#FFE58A';

// ---------- Tap the pig: gold coins shower down for about 3 seconds ----------

export function CoinRain({ run, onDone }: { run: number; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const coins = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        x: Math.random() * (width - 40),
        size: 26 + Math.random() * 16,
        delay: Math.random() * 1400,
        dur: 1300 + Math.random() * 900,
        spin: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360),
        key: `${run}-${i}`,
      })),
    [run, width],
  );
  // Values exist before the first draw (made with the coins), so every coin renders from frame one.
  const vals = useMemo(() => coins.map(() => new Animated.Value(0)), [coins]);
  useEffect(() => {
    if (!run) return;
    if (prefersReducedMotion()) {
      onDone();
      return;
    }
    const anims = coins.map((c, i) =>
      Animated.timing(vals[i], { toValue: 1, duration: c.dur, delay: c.delay, easing: Easing.in(Easing.quad), useNativeDriver: native }),
    );
    Animated.parallel(anims).start(() => onDone());
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run || prefersReducedMotion()) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {coins.map((c, i) => {
        const v = vals[i];
        return (
          <Animated.View
            key={c.key}
            style={[
              styles.coin,
              { left: c.x, width: c.size, height: c.size, borderRadius: c.size / 2 },
              {
                transform: [
                  { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-60, height + 60] }) },
                  { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.spin}deg`] }) },
                  { scaleX: v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.35, 1, 0.35, 1] }) }, // flipping
                ],
              },
            ]}
          >
            <View style={[styles.coinInner, { borderRadius: c.size / 2 }]}>
              <T size={Math.round(c.size * 0.5)} w="bold" color={GOLD_DARK} style={{ lineHeight: Math.round(c.size * 0.6) }}>
                ₱
              </T>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ---------- Feedback sent: a paper airplane glides away over ~3 s, with confetti ----------

export function SentCelebration({ t, onDone }: { t: Theme; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const plane = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        x: width / 2 + (Math.random() - 0.5) * width * 0.9,
        drift: (Math.random() - 0.5) * 120,
        delay: 500 + Math.random() * 700,
        dur: 1500 + Math.random() * 900,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        color: [t.accent, GOLD, '#7FC2A0', '#F29E8E', '#8DB9FF', t.text][i % 6],
        spin: (Math.random() > 0.5 ? 1 : -1) * (270 + Math.random() * 360),
      })),
    [width, t.accent, t.text],
  );
  const vals = useRef(pieces.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (prefersReducedMotion()) {
      const timer = setTimeout(onDone, 600);
      return () => clearTimeout(timer);
    }
    Animated.parallel([
      Animated.timing(plane, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.cubic), useNativeDriver: native }),
      ...pieces.map((p, i) => Animated.timing(vals[i], { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: native })),
    ]).start(() => onDone());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Plane path: from lower left, a loop-ish arc, off the top right.
  const px = plane.interpolate({ inputRange: [0, 0.35, 0.65, 1], outputRange: [-40, width * 0.45, width * 0.3, width + 60] });
  const py = plane.interpolate({ inputRange: [0, 0.35, 0.65, 1], outputRange: [height * 0.7, height * 0.45, height * 0.3, -80] });
  const rot = plane.interpolate({ inputRange: [0, 0.35, 0.65, 1], outputRange: ['-10deg', '-35deg', '-80deg', '-40deg'] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: height * 0.32,
            width: p.w,
            height: p.h,
            borderRadius: 2,
            backgroundColor: p.color,
            opacity: vals[i].interpolate({ inputRange: [0, 0.05, 0.85, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: vals[i].interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { translateY: vals[i].interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, -60, height * 0.6] }) },
              { rotate: vals[i].interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: px }, { translateY: py }, { rotate: rot }] }}>
        <Send size={44} color={t.accent} strokeWidth={1.8} fill={t.accentSoft} />
      </Animated.View>
    </View>
  );
}

// ---------- "Saved ✓": a small pill after any Settings change (Joe v3 test round) ----------

export function SavedPill({ t, show, inline, label = 'Saved' }: { t: Theme; show: number; inline?: boolean; label?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!show) return;
    v.setValue(0);
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 180, easing: Easing.out(Easing.back(1.6)), useNativeDriver: native }),
      Animated.delay(1100),
      Animated.timing(v, { toValue: 0, duration: 220, useNativeDriver: native }),
    ]).start();
  }, [show, v]);
  if (!show) return null;
  return (
    <View pointerEvents="none" style={inline ? styles.pillInline : styles.pillWrap}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.pill,
          { backgroundColor: t.accent },
          { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        ]}
      >
        <Check size={16} color={t.accentText} strokeWidth={2.6} />
        <T size={15} w="semibold" color={t.accentText}>{label}</T>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  coin: {
    position: 'absolute',
    top: 0,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: GOLD_DARK,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  coinInner: { width: '74%', height: '74%', borderWidth: 1.5, borderColor: GOLD_LIGHT, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center' },
  pillInline: { alignItems: 'center', marginTop: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
});
