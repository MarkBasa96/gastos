import { ChevronLeft, Delete, LockOpen, Mail, Repeat, ShieldCheck } from './lucide';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { buzz, prefersReducedMotion } from './fx';
import Svg, { Defs, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { maskEmail } from './pin';
import { Turnstile, TurnstileHandle, turnstileEnabled } from './Turnstile';
import { Theme, font } from './theme';
import { Button, Field, IconButton, Label, T } from './ui';

const LOGO_WHITE = require('../assets/brand/logo-white.png');
const ICON = require('../assets/brand/icon-1024.png');
const LOGO_RATIO = 1983 / 793;

/** 'offline' = this phone knows an MPIN exists but can't check it without internet. */
export type PinTry = 'ok' | 'locked' | 'offline' | { left: number };

function wrongMsg(left: number): string {
  return left <= 1 ? 'Wrong MPIN. 1 try left, then you’ll need the email code.' : `Wrong MPIN. ${left} tries left.`;
}

const OFFLINE_MSG = 'No internet. Connect once and try again: this phone needs to check your MPIN online.';
const BRAND_BG = '#0F2E20';
const ON_BRAND = '#EDF1EE';

function Page({ children, t }: { children: ReactNode; t: Theme }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

function friendly(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/expired|invalid|token/i.test(msg)) return 'That code didn’t work. Check the newest email, or send a new code.';
  if (/signups? not allowed|not found/i.test(msg)) return 'We couldn’t find an account for that email.';
  return fallback;
}

// ---------- Welcome (first open only) ----------

export function Welcome({ t, onSignIn, onSkip }: { t: Theme; onSignIn: () => void; onSkip: () => void }) {
  return (
    <Page t={t}>
      <View style={styles.welcomeTop}>
        <Image source={ICON} style={styles.appIcon} accessibilityIgnoresInvertColors />
        <T size={40} w="brand" color={t.text} style={{ marginTop: 20, letterSpacing: -0.8, lineHeight: 48 }} accessibilityRole="header">
          Gastos
        </T>
        <T size={18} color={t.muted} style={{ marginTop: 8, textAlign: 'center', maxWidth: 280, lineHeight: 26 }}>
          Know where your money went, in two taps a day.
        </T>
      </View>
      <View style={{ alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <ShieldCheck size={20} color={t.muted} strokeWidth={1.8} />
        <T size={14} color={t.muted} style={{ textAlign: 'center', lineHeight: 20 }}>
          Sign in to back up your expenses and see them on any phone. Skip, and they stay on this phone only.
        </T>
      </View>
      <Button label="Sign in to sync" icon={Mail} onPress={onSignIn} t={t} />
      <Button label="Skip, try it first" kind="outline" onPress={onSkip} t={t} style={{ marginTop: 10 }} />
      <T size={13} w="medium" color={t.muted} style={{ textAlign: 'center', marginTop: 16 }}>
        No password. We email you a 6-digit code.
      </T>
    </Page>
  );
}

// ---------- Email + code (sign in, sign in again, forgot MPIN) ----------

export function SignIn({
  t,
  fixedEmail,
  title,
  intro,
  onSend,
  onVerify,
  onBack,
  backLabel = 'Back',
  extra,
}: {
  t: Theme;
  fixedEmail?: string; // sign-in again / forgot MPIN: the email can't be changed (Kenshin 1.7)
  title?: string;
  intro?: string;
  onSend: (email: string, captchaToken?: string) => Promise<void>;
  onVerify: (email: string, code: string) => Promise<void>;
  onBack?: () => void;
  backLabel?: string;
  extra?: ReactNode;
}) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>(fixedEmail ? 'email' : 'email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const check = useRef<TurnstileHandle>(null);
  const needsCheck = turnstileEnabled && !captcha;

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function send() {
    if (!validEmail) return setError('Type your email, like name@gmail.com.');
    if (needsCheck) return setError('One moment: finishing the security check below.');
    setBusy(true);
    setError(null);
    try {
      await onSend(email.trim().toLowerCase(), captcha ?? undefined);
      setStep('code');
      setWait(45);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(/captcha/i.test(msg) ? 'The security check didn’t go through. Please try again.' : friendly(e, 'Could not send the code. Check your internet and try again.'));
    } finally {
      setBusy(false);
      check.current?.reset(); // tokens work once; get a fresh one for "Send a new code"
    }
  }

  async function verify() {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(email.trim().toLowerCase(), code);
    } catch (e) {
      setError(friendly(e, 'Could not sign in. Check your internet and try again.'));
      setBusy(false);
    }
  }

  const back = step === 'code' && !fixedEmail ? () => { setStep('email'); setCode(''); setError(null); } : onBack;

  return (
    <Page t={t}>
      {back ? (
        <View style={{ marginLeft: -10 }}>
          <IconButton icon={ChevronLeft} onPress={back} t={t} label={backLabel} />
        </View>
      ) : null}
      {step === 'email' ? (
        <>
          <T size={28} w="bold" color={t.text} style={styles.h1} accessibilityRole="header">
            {title ?? 'Sign in to sync'}
          </T>
          <T size={16} color={t.muted} style={{ marginTop: 8 }}>
            {intro ?? 'We’ll email you a 6-digit code. No password to remember.'}
          </T>
          <Label t={t} style={{ marginTop: 28 }}>
            Email
          </Label>
          {fixedEmail ? (
            <View style={[styles.fixed, { backgroundColor: t.surface, borderColor: t.border }]}>
              <T size={16} color={t.text}>{maskEmail(fixedEmail)}</T>
            </View>
          ) : (
            <Field
              t={t}
              value={email}
              onChangeText={setEmail}
              placeholder="name@gmail.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              textContentType="emailAddress"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={send}
              accessibilityLabel="Email"
              error={!!error}
            />
          )}
          {error && <T size={14} color={t.danger} style={{ marginTop: 8 }}>{error}</T>}
          <Button label="Send me a code" onPress={send} t={t} loading={busy} disabled={needsCheck} style={{ marginTop: 18 }} />
          {!fixedEmail && (
            <T size={13} w="medium" color={t.muted} style={{ textAlign: 'center', marginTop: 14 }}>
              New here? The same code makes your account.
            </T>
          )}
        </>
      ) : (
        <>
          <T size={28} w="bold" color={t.text} style={styles.h1} accessibilityRole="header">
            Check your email
          </T>
          <T size={16} color={t.muted} style={{ marginTop: 8 }}>
            We sent a 6-digit code to <T size={16} w="semibold" color={t.text}>{fixedEmail ? maskEmail(email) : email}</T>
          </T>
          <Label t={t} style={{ marginTop: 28 }}>
            Code
          </Label>
          <TextInput
            value={code}
            onChangeText={(v) => {
              const c = v.replace(/\D/g, '').slice(0, 6);
              setCode(c);
              setError(null);
            }}
            onSubmitEditing={verify}
            placeholder="••••••"
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
            maxLength={6}
            accessibilityLabel="6-digit code"
            style={[
              styles.code,
              { color: t.text, backgroundColor: t.surface, borderColor: error ? t.danger : t.accent, fontFamily: font.bold },
            ]}
          />
          <T size={13} w="medium" color={t.muted} style={{ textAlign: 'center', marginTop: 8 }}>
            Your phone can fill this in from the email.
          </T>
          {error && <T size={14} color={t.danger} style={{ marginTop: 8, textAlign: 'center' }}>{error}</T>}
          <Button label="Sign in" onPress={verify} t={t} loading={busy} disabled={code.length !== 6} style={{ marginTop: 18 }} />
          <View style={styles.codeLinks}>
            {wait > 0 ? (
              <T size={14} color={t.muted}>Resend in 0:{String(wait).padStart(2, '0')}</T>
            ) : (
              <T size={14} w="semibold" color={t.accent} onPress={send} accessibilityRole="button">
                Send a new code
              </T>
            )}
            {!fixedEmail && (
              <T size={14} w="semibold" color={t.accent} onPress={() => { setStep('email'); setCode(''); }} accessibilityRole="button">
                Use a different email
              </T>
            )}
          </View>
        </>
      )}
      <Turnstile ref={check} onToken={setCaptcha} dark={t.dark} />
      {extra}
    </Page>
  );
}

// ---------- MPIN keypad (custom: keeps the PIN out of autofill and keyboard learning) ----------

function Keypad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <View style={styles.keypad}>
      {keys.map((k, i) =>
        k === '' ? (
          <View key={i} style={styles.key} />
        ) : (
          <Pressable
            key={i}
            disabled={disabled}
            onPress={() => (k === 'del' ? onDelete() : onDigit(k))}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete' : k}
            style={({ pressed }) => [
              styles.key,
              k !== 'del' && { backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)' },
            ]}
          >
            {k === 'del' ? (
              <Delete size={26} color={ON_BRAND} strokeWidth={1.8} />
            ) : (
              <T size={30} w="medium" color={ON_BRAND}>
                {k}
              </T>
            )}
          </Pressable>
        ),
      )}
    </View>
  );
}

function Dots({ n, shake }: { n: number; shake: number }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shake) return;
    buzz([70, 40, 70]); // follows the phone's own vibration setting
    if (prefersReducedMotion()) return;
    const native = Platform.OS !== 'web';
    const step = (to: number) => Animated.timing(x, { toValue: to, duration: 55, easing: Easing.linear, useNativeDriver: native });
    Animated.sequence([step(12), step(-12), step(9), step(-9), step(5), step(0)]).start();
  }, [shake, x]);
  return (
    <Animated.View style={[styles.dots, { transform: [{ translateX: x }] }]} accessibilityLabel={`${n} of 4 digits entered`}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.pinDot, i < n && styles.pinDotOn]} />
      ))}
    </Animated.View>
  );
}

function BrandBackground({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: BRAND_BG }}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern id="peso" width={120} height={120} patternUnits="userSpaceOnUse">
            <SvgText x={18} y={44} fontSize={30} fontWeight="700" fill="#FFFFFF" fillOpacity={0.045}>
              ₱
            </SvgText>
            <SvgText x={76} y={104} fontSize={30} fontWeight="700" fill="#FFFFFF" fillOpacity={0.045}>
              ₱
            </SvgText>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#peso)" />
      </Svg>
      {children}
    </View>
  );
}

/** Lock screen: logo, masked account, MPIN card -> keypad. Rendered INSTEAD of the app, never over it. */
export function Lock({
  maskedEmail,
  onTry,
  onForgot,
  onSwitch,
  hint,
}: {
  maskedEmail: string;
  onTry: (pin: string) => Promise<PinTry>;
  onForgot: () => void;
  onSwitch: () => void;
  /** e.g. "The same MPIN you use on your other phone." */
  hint?: string;
}) {
  // A phone new to the account goes straight to the keypad with the "same MPIN" line (approved pin-new, Erina build review).
  const [pad, setPad] = useState(!!hint);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const checking = useRef(false); // a fast double tap must not count as one guess (Kenshin audit)

  async function digit(d: string) {
    if (busy || checking.current || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setMsg(null);
    if (next.length < 4) return;
    checking.current = true;
    setBusy(true);
    const r = await onTry(next);
    checking.current = false;
    if (typeof r === 'object') {
      setShake((s) => s + 1);
      setMsg(wrongMsg(r.left));
      setPin('');
    } else if (r === 'offline') {
      setMsg(OFFLINE_MSG);
      setPin('');
    }
    setBusy(false);
  }

  return (
    <BrandBackground>
      <View style={styles.lock}>
        {!pad ? (
          <>
            <Image source={LOGO_WHITE} style={{ width: 270, height: 270 / LOGO_RATIO, marginTop: 72 }} accessibilityLabel="Gastos" />
            <Pressable onPress={onSwitch} accessibilityRole="button" accessibilityLabel={`Signed in as ${maskedEmail}. Switch account`} style={styles.acct}>
              <T size={17} w="semibold" color={ON_BRAND}>{maskedEmail}</T>
              <Repeat size={18} color={ON_BRAND} strokeWidth={1.8} />
            </Pressable>
            <Pressable onPress={() => setPad(true)} accessibilityRole="button" style={({ pressed }) => [styles.mpinCard, { opacity: pressed ? 0.9 : 1 }]}>
              <View style={styles.keyDots}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <View key={i} style={styles.keyDot} />
                ))}
              </View>
              <T size={17} w="bold" color="#1D6B45">MPIN Login</T>
            </Pressable>
            <View style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <Image source={LOGO_WHITE} style={{ width: 170, height: 170 / LOGO_RATIO, marginTop: 36 }} accessibilityLabel="Gastos" />
            <T size={20} w="semibold" color={ON_BRAND} style={{ marginTop: 30 }} accessibilityRole="header">
              Enter your MPIN
            </T>
            {hint ? (
              <T size={14} color="rgba(237,241,238,0.75)" style={{ marginTop: 6, textAlign: 'center', paddingHorizontal: 16 }}>
                {hint}
              </T>
            ) : null}
            <Dots n={pin.length} shake={shake} />
            <T size={14} color={msg ? '#F2B8B5' : 'transparent'} style={{ minHeight: 20, marginBottom: 10, textAlign: 'center' }} accessibilityLiveRegion="polite">
              {msg ?? ' '}
            </T>
            <Keypad onDigit={digit} onDelete={() => setPin((p) => p.slice(0, -1))} disabled={busy} />
          </>
        )}
        <View style={styles.lockLinks}>
          <T size={15} w="semibold" color={ON_BRAND} onPress={onSwitch} accessibilityRole="button">
            Not you? Switch
          </T>
          <T size={15} w="semibold" color={ON_BRAND} onPress={onForgot} accessibilityRole="button">
            Forgot MPIN?
          </T>
        </View>
        <T size={12} color="rgba(237,241,238,0.5)" style={{ marginTop: 12, marginBottom: 24 }}>
          Gastos 3.0
        </T>
      </View>
    </BrandBackground>
  );
}

/** "Enter your current MPIN first": before turning it off or changing it. Wrong tries count toward the 5. */
export function VerifyPin({
  title,
  intro,
  onTry,
  onCancel,
  onForgot,
}: {
  title: string;
  intro: string;
  onTry: (pin: string) => Promise<PinTry>;
  onCancel: () => void;
  onForgot: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const checking = useRef(false);

  async function digit(d: string) {
    if (busy || checking.current || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setMsg(null);
    if (next.length < 4) return;
    checking.current = true;
    setBusy(true);
    const r = await onTry(next);
    checking.current = false;
    if (typeof r === 'object') {
      setShake((s) => s + 1);
      setMsg(wrongMsg(r.left));
      setPin('');
    } else if (r === 'offline') {
      setMsg(OFFLINE_MSG);
      setPin('');
    }
    setBusy(false);
  }

  return (
    <BrandBackground>
      <View style={styles.lock}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel} hitSlop={8}>
          <ChevronLeft size={22} color={ON_BRAND} strokeWidth={2} />
          <T size={16} w="semibold" color={ON_BRAND}>Cancel</T>
        </Pressable>
        <View style={styles.verifyIcon}>
          <LockOpen size={28} color={ON_BRAND} strokeWidth={1.8} />
        </View>
        <T size={20} w="semibold" color={ON_BRAND} style={{ marginTop: 18 }} accessibilityRole="header">
          {title}
        </T>
        <T size={14} color="rgba(237,241,238,0.75)" style={{ marginTop: 6, textAlign: 'center', paddingHorizontal: 16 }}>
          {intro}
        </T>
        <Dots n={pin.length} shake={shake} />
        <T size={14} color={msg ? '#F2B8B5' : 'transparent'} style={{ minHeight: 20, marginBottom: 10, textAlign: 'center' }} accessibilityLiveRegion="polite">
          {msg ?? ' '}
        </T>
        <Keypad onDigit={digit} onDelete={() => setPin((p) => p.slice(0, -1))} disabled={busy} />
        <T size={15} w="semibold" color={ON_BRAND} onPress={onForgot} accessibilityRole="button" style={{ marginTop: 22, marginBottom: 30 }}>
          Forgot MPIN?
        </T>
      </View>
    </BrandBackground>
  );
}

/** Create (or change) the MPIN: enter, then confirm. Blocks the most-guessed PINs. */
export function SetPin({
  t,
  isWeak,
  onDone,
  onSkip,
  skipLabel = 'Skip for now',
}: {
  t: Theme;
  isWeak: (p: string) => boolean;
  /** Resolves to an error message to show, or null when done. */
  onDone: (pin: string) => Promise<string | null>;
  /** Missing = no way out (resetting a forgotten MPIN must end with a new one: Kenshin H2). */
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function digit(d: string) {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setMsg(null);
    if (next.length < 4) return;
    if (!first) {
      if (isWeak(next)) {
        setMsg('That one’s too easy to guess. Try another.');
        setPin('');
        return;
      }
      setFirst(next);
      setPin('');
      return;
    }
    if (next !== first) {
      setMsg('Those didn’t match. Start again.');
      setFirst(null);
      setPin('');
      return;
    }
    setBusy(true);
    const err = await onDone(next).catch(() => 'Something went wrong. Try again.');
    if (err) {
      setMsg(err);
      setFirst(null);
      setPin('');
      setBusy(false);
    }
  }

  return (
    <BrandBackground>
      <View style={styles.lock}>
        <Image source={LOGO_WHITE} style={{ width: 170, height: 170 / LOGO_RATIO, marginTop: 36 }} accessibilityLabel="Gastos" />
        <T size={20} w="semibold" color={ON_BRAND} style={{ marginTop: 30 }} accessibilityRole="header">
          {first ? 'Enter it again' : 'Create your MPIN'}
        </T>
        <T size={14} color="rgba(237,241,238,0.7)" style={{ marginTop: 6, textAlign: 'center', paddingHorizontal: 24 }}>
          It works on every phone you sign in to. Don’t reuse your GCash, bank or phone PIN.
        </T>
        <Dots n={pin.length} shake={0} />
        <T size={14} color={msg ? '#F2B8B5' : 'transparent'} style={{ minHeight: 20, marginBottom: 10 }} accessibilityLiveRegion="polite">
          {msg ?? ' '}
        </T>
        <Keypad onDigit={digit} onDelete={() => setPin((p) => p.slice(0, -1))} disabled={busy} />
        {onSkip ? (
          <T size={15} w="semibold" color={ON_BRAND} onPress={onSkip} accessibilityRole="button" style={{ marginTop: 22, marginBottom: 30 }}>
            {skipLabel}
          </T>
        ) : (
          <View style={{ height: 30 }} />
        )}
      </View>
    </BrandBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 16, paddingTop: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  welcomeTop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  appIcon: { width: 92, height: 92, borderRadius: 22 },
  h1: { marginTop: 18, lineHeight: 34, letterSpacing: -0.4 },
  fixed: { minHeight: 48, borderRadius: 12, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 14 },
  code: {
    minHeight: 60,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    outlineWidth: 0,
    outlineStyle: 'none',
  } as any,
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap', gap: 12 },
  lock: { flex: 1, alignItems: 'center', paddingHorizontal: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  acct: {
    marginTop: 34,
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: '#1D6B45',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 24,
    paddingRight: 20,
  },
  mpinCard: {
    marginTop: 70,
    width: 150,
    height: 150,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  keyDots: { width: 58, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keyDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#1D6B45' },
  dots: { flexDirection: 'row', gap: 18, marginTop: 22, marginBottom: 14 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: ON_BRAND },
  pinDotOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  keypad: { width: 284, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  key: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, marginTop: 8 },
  verifyIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  lockLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 6,
    marginTop: Platform.OS === 'web' ? 24 : 16,
  },
});
