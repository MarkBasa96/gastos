import { Platform, Share } from 'react-native';
import { localDate } from './data';

/** Web: downloads a .json file. Phone app: opens the share sheet (save to Files, Drive, email). */
export async function exportBackup(content: string): Promise<void> {
  const name = `gastos-backup-${localDate()}.json`;
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: name, message: content });
}

/** Web only for v1: pick a backup file and return its text. Native restore comes with the store build. */
export function pickBackupFile(): Promise<string | null> {
  if (Platform.OS !== 'web') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    };
    input.click();
  });
}
