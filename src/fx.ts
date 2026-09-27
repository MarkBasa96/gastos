import { AccessibilityInfo, Platform } from 'react-native';

// Sounds are synthesised with Web Audio: no files, no network (Kenshin v3 Part 5). One AudioContext,
// created on the first tap (browsers refuse to start audio before a user gesture).

type Sound = 'clink' | 'thud' | 'chime';

let ctx: AudioContext | null = null;
let soundsOn = true;
let reduceMotion = false;

AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => (reduceMotion = v))
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduceMotion = v));

export function setSoundsOn(on: boolean) {
  soundsOn = on;
}

export function prefersReducedMotion(): boolean {
  return reduceMotion;
}

function audio(): AudioContext | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (!ctx) {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    ctx = new C() as AudioContext;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Plays after `delay` seconds. Silent when Sounds is off in Settings. */
export function play(name: Sound, delay = 0) {
  if (!soundsOn) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  if (name === 'clink') {
    tone(c, 'sine', 2637, 0, t, 0.18, 0.18);
    tone(c, 'sine', 3951, 0, t, 0.12, 0.07);
    tone(c, 'sine', 3136, 0, t + 0.07, 0.22, 0.13);
    tone(c, 'sine', 4699, 0, t + 0.07, 0.14, 0.05);
  } else if (name === 'thud') {
    tone(c, 'sine', 160, 70, t, 0.16, 0.35);
  } else {
    tone(c, 'triangle', 880, 0, t, 0.35, 0.16);
    tone(c, 'triangle', 1318.5, 0, t + 0.14, 0.5, 0.14);
  }
}

/** A very light buzz on the main buttons. Also warms up audio so the first sound isn't lost. */
export function buzz(ms = 10) {
  audio();
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}
