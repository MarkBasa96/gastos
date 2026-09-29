import { StyleSheet, View } from 'react-native';
import { Theme, font } from './theme';
import { Button, PigLoader, T } from './ui';

/**
 * "Gastos is updating" (Joe's C1, 2026-09-29). Shown only when the phone is online, the account is signed
 * in and unlocked, and the server says the switch is on. One button drops her straight back into the app,
 * where everything she logs waits on the phone and syncs when the update is done.
 */
export function UpdatingScreen({ t, back, onContinue }: { t: Theme; back: string | null; onContinue: () => void }) {
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <View style={styles.mid}>
        {/* Slower than the opening spinner: she may look at this one for a while (Erina). */}
        <PigLoader t={t} turnMs={3600} />
        <T size={15} color={t.accent} style={{ fontFamily: font.brand, marginTop: 10 }}>
          Gastos
        </T>
        <T size={24} w="bold" color={t.text} style={styles.title} accessibilityRole="header">
          Gastos is updating
        </T>
        {back ? (
          <T size={18} w="semibold" color={t.text} style={styles.center}>
            {back}
          </T>
        ) : null}
        <T size={15} color={t.muted} style={[styles.center, styles.body]}>
          You can still log. Your entries save on your phone and sync once this is done.
        </T>
        <Button label="Keep logging offline" onPress={onContinue} t={t} style={styles.button} />
        <T size={13} color={t.muted} style={[styles.center, { marginTop: 12 }]}>
          We’ll check by ourselves and sync when it’s back.
        </T>
      </View>
      <View style={[styles.help, { borderTopColor: t.border }]}>
        <T size={14} color={t.muted} style={styles.center}>
          Something urgent? Message Joe directly.
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 28, paddingBottom: 24 },
  mid: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 22, textAlign: 'center' },
  center: { textAlign: 'center', marginTop: 8 },
  body: { marginTop: 14, lineHeight: 22, maxWidth: 300 },
  button: { marginTop: 26, alignSelf: 'stretch', maxWidth: 320, width: '100%' },
  help: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
});
