import { describe, expect, it, vi } from 'vitest';

import { setScreen } from '@/lib/testing/matchMedia';

import {
  getPreference,
  readPreference,
  resolveTheme,
  setPreference,
  THEME_STORAGE_KEY,
} from './theme';
import indexHtml from '../../../index.html?raw';

/** Runs index.html's inline theme script, as the browser does before first paint. */
function runBootScript(): void {
  const script = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1];
  if (!script) throw new Error('index.html has no inline theme script');
  // The script under test is index.html's own, run as the browser runs it.
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  const run = new Function(script) as () => void;
  run();
}

describe('reading the stored theme', () => {
  it('is "follow the device" when nothing is stored', () => {
    expect(readPreference()).toBe('system');
  });

  it('reads a stored choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readPreference()).toBe('dark');
  });

  it('ignores anything else that is stored', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readPreference()).toBe('system');
  });

  it('follows the device when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readPreference()).toBe('system');
  });
});

describe('choosing a theme', () => {
  it('remembers a theme, and forgets it for "match device"', () => {
    setPreference('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    setPreference('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getPreference()).toBe('system');
  });

  it('still applies a choice for this visit when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    setPreference('dark');
    expect(getPreference()).toBe('dark');
  });

  it('resolves "match device" from the device', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe("index.html's first-paint script", () => {
  it('uses the stored choice, with the same key as the app', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows the device when nothing is stored', () => {
    setScreen({ dark: true });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');

    setScreen({ dark: false });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the device when storage throws or holds junk', () => {
    setScreen({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
