import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// The phone's Back button. Back closes the newest open sheet or pop-up, History/Settings go to Log,
// and on Log the first Back asks ("Press back again to exit") and the next one leaves.
//
// 3.0 did this with a spare history entry pushed at startup and again after every Back. Chrome (and
// so the Android app) skips history entries a page adds without a tap, so Back went straight past
// Gastos and closed it (Joe, 3.1: "the back button feature does not work").
//
// 3.1: where the browser has CloseWatcher (Chrome/Android 126+, which is what the Android app runs
// on), each open sheet, pop-up or tab gets its own close watcher: Chrome's built-in way for a page to
// take the Back button, no history involved. Each one is made right after the tap that opened it,
// so Chrome treats them as separate steps. Elsewhere we fall back to the spare history entry, but
// only ever push it during a tap, so it's never skipped.

type Handler = { run: () => void; watcher?: CloseWatcherLike | null };
type CloseWatcherLike = { onclose: (() => void) | null; destroy: () => void };

const stack: Handler[] = [];
let started = false;
let askExit: () => void = () => {};

const web = Platform.OS === 'web' && typeof window !== 'undefined' && typeof history !== 'undefined';
const CW: (new () => CloseWatcherLike) | null = web && typeof (window as any).CloseWatcher === 'function' ? (window as any).CloseWatcher : null;

function makeWatcher(onClose: () => void): CloseWatcherLike | null {
  if (!CW) return null;
  try {
    const w = new CW();
    w.onclose = onClose;
    return w;
  } catch {
    return null; // e.g. the page is being hidden; the next tap tries again
  }
}

// ---------- CloseWatcher mode ----------

/** On Log with nothing open: the first Back shows the hint; with no watcher left, the next one leaves. */
let rootWatcher: CloseWatcherLike | null = null;

function armRoot() {
  if (rootWatcher || stack.length) return;
  rootWatcher = makeWatcher(() => {
    rootWatcher = null;
    askExit();
  });
}

function watch(h: Handler) {
  h.watcher = makeWatcher(() => {
    h.watcher = null;
    h.run();
    // Most handlers close their sheet, and React then drops the handler. One that stays active
    // (a screen Back must not leave) gets a fresh watcher so it keeps catching Back.
    setTimeout(() => {
      if (stack.includes(h) && !h.watcher) watch(h);
    }, 50);
  });
}

// ---------- history fallback (no CloseWatcher) ----------

const isGuard = () => (history.state as { gastos?: string } | null)?.gastos === 'guard';
let lastRootBack = 0;

/** Call once at startup. `onAskExit` shows the "Press back again to exit" hint. */
export function startBackNav(onAskExit: () => void) {
  if (!web || started) return;
  started = true;
  askExit = onAskExit;

  if (CW) {
    armRoot(); // a page gets one watcher without a tap; this is it
    // After a tap, re-arm the exit question if it was used. Later than the tap itself, so a sheet or
    // tab opened by that tap makes its own watcher first.
    const rearm = () => setTimeout(armRoot, 400);
    window.addEventListener('click', rearm, true);
    window.addEventListener('keydown', rearm, true);
    return;
  }

  history.replaceState({ gastos: 'root' }, '');
  // Push the spare entry only during a tap: Chrome skips entries added without one.
  const arm = () => {
    if (!isGuard()) history.pushState({ gastos: 'guard' }, '');
  };
  window.addEventListener('click', arm, true);
  window.addEventListener('keydown', arm, true);
  window.addEventListener('popstate', () => {
    const top = stack[stack.length - 1];
    if (top) {
      top.run();
      return; // the next tap puts the spare entry back
    }
    if (Date.now() - lastRootBack < 2000) {
      history.back(); // past the app's first entry: the Android app closes, a browser tab goes back
      return;
    }
    lastRootBack = Date.now();
    onAskExit();
  });
}

/** While `active`, the Back button runs `onBack` (newest registration first). */
export function useBackHandler(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!web || !active) return;
    const h: Handler = { run: () => latest.current() };
    stack.push(h);
    if (CW) watch(h);
    return () => {
      const i = stack.lastIndexOf(h);
      if (i >= 0) stack.splice(i, 1);
      h.watcher?.destroy();
      h.watcher = null;
    };
  }, [active]);
}
