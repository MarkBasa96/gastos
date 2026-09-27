import { AccessibilityInfo, Platform } from 'react-native';

// Sounds are synthesised with Web Audio: no files, no network (Kenshin v3 Part 5). One AudioContext,
// created on the first tap (browsers refuse to start audio before a user gesture).

type Sound = 'clink' | 'thud' | 'chime' | 'coins' | 'whoosh';

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

/** Filtered noise sweeping from f0 to f1 Hz: swishes and whooshes. */
function noise(c: AudioContext, t0: number, dur: number, f0: number, f1: number, vol: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, t0);
  bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
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
    // Delete: a quick swish down plus a small "pop" into the bin. The v3 160 Hz thud was below what
    // phone speakers can play (Joe couldn't hear it); everything here sits in 250-3000 Hz.
    noise(c, t, 0.26, 3200, 500, 0.5);
    tone(c, 'triangle', 620, 240, t + 0.16, 0.14, 0.32);
  } else if (name === 'coins') {
    // The pig's coin shower: ~18 bright clinks scattered over about 3 seconds.
    for (let i = 0; i < 18; i++) {
      const at = t + i * 0.15 + Math.random() * 0.1;
      const f = 2300 + Math.random() * 1600;
      tone(c, 'sine', f, 0, at, 0.14, 0.09);
      tone(c, 'sine', f * 1.5, 0, at + 0.03, 0.1, 0.04);
    }
  } else if (name === 'whoosh') {
    noise(c, t, 0.9, 400, 2600, 0.22);
  } else {
    tone(c, 'triangle', 880, 0, t, 0.35, 0.16);
    tone(c, 'triangle', 1318.5, 0, t + 0.14, 0.5, 0.14);
  }
}

/** A very light buzz on the main buttons. Also warms up audio so the first sound isn't lost. */
export function buzz(ms: number | number[] = 10) {
  audio();
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}
