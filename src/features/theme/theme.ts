/**
 * Light or dark. Light by default (round 17); "Match device" follows the
 * device's setting. A choice made here is remembered on this device.
 *
 * The very first paint is index.html's job: a small inline script there reads
 * the same storage key and sets `data-theme` on <html> before the stylesheet
 * applies, so there is never a flash of the wrong theme. This module keeps
 * that attribute right afterwards. The key and the values are shared with
 * that script by hand; src/features/theme/theme.test.ts runs the script to
 * hold the two together.
 */

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'fuel-finder:theme:v1';
export const DARK_SCHEME = '(prefers-color-scheme: dark)';
/** A visitor who has never chosen. */
export const DEFAULT_PREFERENCE: ThemePreference = 'light';

/**
 * Storage can throw (Safari private windows used to, and blocked site data
 * still does) or hold anything at all; both mean the default. Before round
 * 17 "Match device" was stored as no value at all, so it cannot be told
 * apart from never having chosen, and also becomes the default.
 */
export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** Every choice is stored, "Match device" too: no value means "never chose". */
function writePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

export function resolveTheme(preference: ThemePreference, deviceDark: boolean): Theme {
  if (preference === 'system') return deviceDark ? 'dark' : 'light';
  return preference;
}

/*
 * The preference as a tiny external store, for useSyncExternalStore. Another
 * tab changing it arrives as a `storage` event, so every open tab agrees.
 */
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

export function getPreference(): ThemePreference {
  current ??= readPreference();
  return current;
}

export function setPreference(preference: ThemePreference): void {
  writePreference(preference);
  current = preference;
  for (const listener of listeners) listener();
}

export function subscribePreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    current = readPreference();
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** For tests: forget the cached preference, as a fresh page load would. */
export function resetPreferenceForTests(): void {
  current = null;
}
