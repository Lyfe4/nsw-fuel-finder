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
