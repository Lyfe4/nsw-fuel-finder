import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept up to date as the window resizes or
 * a setting (reduced motion, say) changes.
 *
 * Use CSS for anything CSS can do. This is for the few decisions that change
 * what is rendered or loaded, not just how it looks: the map's JavaScript is
 * only fetched when the map is actually on screen.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Wide enough for the list and the map side by side. Matches the CSS breakpoint in StationsPanel.module.css. */
export const WIDE_SCREEN = '(min-width: 60rem)';

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
