import { act } from '@testing-library/react';

import { REDUCED_MOTION, WIDE_SCREEN } from '../useMediaQuery';

/*
 * jsdom has no matchMedia. This fake answers the two queries the app asks,
 * from a screen the test sets, and fires `change` like a browser does when
 * the window is resized. Installed for every test by vitest.setup.ts, as a
 * phone-width screen with motion allowed.
 */

interface Screen {
  wide: boolean;
  reducedMotion: boolean;
}

const PHONE: Screen = { wide: false, reducedMotion: false };
let screen: Screen = { ...PHONE };
const listeners = new Map<string, Set<() => void>>();

function matches(query: string): boolean {
  if (query === WIDE_SCREEN) return screen.wide;
  if (query === REDUCED_MOTION) return screen.reducedMotion;
  throw new Error(`The matchMedia fake does not know ${query}`);
}

export function installMatchMedia(): void {
  screen = { ...PHONE };
  listeners.clear();
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return matches(query);
      },
      addEventListener: (_type: string, listener: () => void) => {
        const set = listeners.get(query) ?? new Set();
        set.add(listener);
        listeners.set(query, set);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.get(query)?.delete(listener);
      },
    }) as unknown as MediaQueryList;
}

/** Change the fake screen, as resizing the window or changing a setting would. */
export function setScreen(change: Partial<Screen>): void {
  act(() => {
    screen = { ...screen, ...change };
    for (const set of listeners.values()) for (const listener of set) listener();
  });
}
