import { useLayoutEffect, useSyncExternalStore } from 'react';

import { useMediaQuery } from '@/lib/useMediaQuery';

import {
  DARK_SCHEME,
  getPreference,
  resolveTheme,
  setPreference,
  subscribePreference,
  type Theme,
  type ThemePreference,
} from './theme';

export interface ThemeState {
  /** What the user chose: a theme, or "follow the device". */
  preference: ThemePreference;
  /** What is on screen. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribePreference,
    getPreference,
    () => 'system',
  );
  const deviceDark = useMediaQuery(DARK_SCHEME);
  return { preference, theme: resolveTheme(preference, deviceDark), setPreference };
}

/**
 * Keeps <html data-theme> and the browser's own chrome in step with the
 * theme: after a choice here, and when the device switches between light and
 * dark while the page is open. Called once, by the app shell. A layout
 * effect, so the change lands before the next paint.
 */
export function useApplyTheme(): Theme {
  const { theme } = useTheme();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // The address bar on Android and the title bar of an installed page.
    const meta = document.querySelector('meta[name="theme-color"]');
    const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
    if (meta && background) meta.setAttribute('content', background);
  }, [theme]);
  return theme;
}
