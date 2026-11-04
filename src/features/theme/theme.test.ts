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
import staticTheme from '../../../public/static-theme.js?raw';

const appScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1];
if (!appScript) throw new Error('index.html has no inline theme script');

/**
 * The two first-paint scripts: index.html's inline one, and the static
 * pages' file (privacy, 404). They must decide alike.
 */
const BOOT_SCRIPTS = { 'index.html': appScript, 'static-theme.js': staticTheme };

/** Runs a first-paint script, as the browser does before first paint. */
function run(script: string): void {
  // The script under test is the page's own, run as the browser runs it.
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  (new Function(script) as () => void)();
}

describe('reading the stored theme', () => {
  it('is light for a visitor who never chose', () => {
    expect(readPreference()).toBe('light');
  });

  it('reads a stored "match device"', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    expect(readPreference()).toBe('system');
  });

  it('reads a stored choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readPreference()).toBe('dark');
  });

  it('ignores anything else that is stored', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readPreference()).toBe('light');
  });

  it('is light when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readPreference()).toBe('light');
  });
});

describe('choosing a theme', () => {
  it('remembers every choice, "match device" included', () => {
    setPreference('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    setPreference('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
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

describe.each(Object.entries(BOOT_SCRIPTS))('the first-paint script in %s', (_, script) => {
  const runBootScript = () => {
    run(script);
  };

  it('uses the stored choice, with the same key as the app', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('is light for a new visitor, even on a dark device', () => {
    setScreen({ dark: true });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps a stored light choice on a dark device', () => {
    setScreen({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the device for a stored "match device"', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    setScreen({ dark: true });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');

    setScreen({ dark: false });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('is light when storage throws or holds junk', () => {
    setScreen({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
