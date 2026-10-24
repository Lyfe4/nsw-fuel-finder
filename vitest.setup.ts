// Adds the jest-dom matchers (toBeInTheDocument, toHaveAccessibleName, ...)
// to Vitest's `expect`, including their TypeScript types.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { resetPreferenceForTests } from './src/features/theme/theme';
import { installMatchMedia } from './src/lib/testing/matchMedia';

// jsdom has no matchMedia. Every test starts on a phone-width screen; one
// that needs a wide screen says so with setScreen().
beforeEach(() => {
  if (typeof window !== 'undefined') installMatchMedia();
});

// Testing Library only auto-cleans when Vitest globals are enabled, and they
// are not, so unmount between tests explicitly.
afterEach(() => {
  cleanup();
  // A test that stubbed fetch or geolocation must not leak it into the next.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // jsdom has no geolocation; a test that faked one must not leave it behind.
  if (typeof navigator !== 'undefined') Reflect.deleteProperty(navigator, 'geolocation');
  // The search lives in the URL; every test starts from a bare page.
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
  // A theme chosen in one test must not carry into the next.
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    resetPreferenceForTests();
  }
});

beforeAll(() => {
  // jsdom has no layout, so no scrollIntoView. Downshift calls it to keep the
  // highlighted suggestion in view.
  if (typeof Element !== 'undefined') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {
      // no layout in jsdom, nothing to scroll
    };
  }
});
