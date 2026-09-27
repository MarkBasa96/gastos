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
    document.body.appendChild(a); // attached, like the restore picker: Android Chrome can ignore a detached click
    a.click();
    a.remove();
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
    // text/plain too: Android often saves a downloaded .json as plain text, and the picker greys it out.
    input.accept = 'application/json,.json,text/plain';
    // On the page, not floating free: Android Chrome ignores a click on a detached file input
    // (Joe's v3 test: "nothing pops up").
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    const done = () => input.remove();
    input.onchange = () => {
      const file = input.files?.[0];
      done();
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    };
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    input.click();
  });
}
