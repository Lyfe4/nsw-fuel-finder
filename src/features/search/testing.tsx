import { render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { App } from '@/app/App';
import { createQueryClient } from '@/app/queryClient';

/** Renders the whole app at `url`, with retries off so failures show at once. */
export function renderApp(url = '/'): RenderResult & { user: UserEvent } {
  window.history.replaceState(null, '', url);
  const user = userEvent.setup();
  const view = render(<App queryClient={createQueryClient({ retry: false })} />);
  return { user, ...view };
}

/** The results section (the only region on the page). */
export const results = () => screen.getByRole('region');

/** What the results area's polite live region currently says. */
export const announced = () => within(results()).getByRole('status').textContent;

export const placeInput = () => screen.getByRole('combobox', { name: /suburb or postcode/i });

/** The place box even while the form is folded away (hidden), for its value. */
export const placeInputAnyway = () =>
  screen.getByRole('combobox', { name: /suburb or postcode/i, hidden: true });

/** On a phone after a search the form is folded into one line: open it. */
export async function openSearch(user: UserEvent): Promise<void> {
  const change = screen.queryByRole('button', { name: 'Change search' });
  if (change?.getAttribute('aria-expanded') === 'false') await user.click(change);
}

/**
 * The station names in a list, in order. A row is a heading holding one
 * button named for the whole row ("Shell Erina 229.9 cents a litre, ..."):
 * the name is what comes before the price.
 */
export const stationNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent.split(/\s*\d+\.\d\s/)[0]?.trim());

/** A station's row button, by the station's name. */
export const stationRow = (name: string) =>
  screen.getByRole('button', {
    name: (accessibleName) =>
      accessibleName.startsWith(`${name} `) && /^\d/.test(accessibleName.slice(name.length + 1)),
  });
