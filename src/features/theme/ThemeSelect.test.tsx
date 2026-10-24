import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '@/app/App';
import { createQueryClient } from '@/app/queryClient';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { setScreen } from '@/lib/testing/matchMedia';

import { THEME_STORAGE_KEY } from './theme';

function renderApp() {
  return render(<App queryClient={createQueryClient({ retry: false })} />);
}

const theme = () => document.documentElement.dataset.theme;

describe('the theme select', () => {
  it('follows the device by default, and as the device changes', () => {
    renderApp();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('system');
    expect(theme()).toBe('light');

    setScreen({ dark: true });
    expect(theme()).toBe('dark');
  });

  it('applies and remembers a choice, which then wins over the device', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'Dark');
    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    setScreen({ dark: false });
    expect(theme()).toBe('dark');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'Match device');
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('starts from a stored choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderApp();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
    expect(theme()).toBe('dark');
  });

  it('picks up a choice made in another tab', () => {
    renderApp();
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    });
    expect(theme()).toBe('dark');
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (chosen) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, chosen);
    const { container } = renderApp();
    expect(theme()).toBe(chosen);
    await expectNoAxeViolations(container);
  });
});
