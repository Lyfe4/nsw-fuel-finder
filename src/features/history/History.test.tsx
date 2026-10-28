import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderApp, stationRow } from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import {
  apiError,
  fakeApi,
  historyResponse,
  json,
  prices,
  station,
  summary,
} from '@/lib/testing/fakeApi';
import { setScreen } from '@/lib/testing/matchMedia';

const ERINA = station({ stationCode: '1', name: 'Ampol Foodary Erina' });

function setup(
  url = '/?query=Erina',
  history = () => json(historyResponse({ station: summary(ERINA) })),
) {
  const api = fakeApi({ location: () => json(prices({ stations: [ERINA] })), history });
  return { api, ...renderApp(url) };
}

const nameLink = () => screen.getByRole('link', { name: 'Price history, Ampol Foodary Erina' });

/** The way in: the station's row opens its card, which has the link. */
async function openCard(user: ReturnType<typeof setup>['user']) {
  await screen.findByRole('list', { name: 'Stations, cheapest first' });
  await user.click(stationRow('Ampol Foodary Erina'));
}

describe('a station’s price history', () => {
  /*
   * The view's body is lazily imported (LazyHistoryView), so the first test
   * to need it also paid for a cold import: transforming the module and its
   * CSS. Under the full suite's parallel load that sometimes took longer than
   * findBy's one second, and the test failed with the view still loading.
   * Importing it once up front takes module loading out of what is timed;
   * what each test waits for is then only what the app does.
   */
  beforeAll(async () => {
    await import('./HistoryView');
  });

  it('opens from the station’s card: a real link, a new history entry, focus on its heading', async () => {
    const { api, user } = setup();
    await openCard(user);
    const link = nameLink();
    expect(link).toHaveAttribute('href', '/?fuel=U91&query=Erina&station=1&history=1');
    expect(link).toHaveAccessibleDescription('Opens its price history');

    const length = window.history.length;
    await user.click(link);
    expect(window.location.search).toBe('?fuel=U91&query=Erina&station=1&history=1');
    expect(window.history.length).toBe(length + 1);
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Price history: Ampol Foodary Erina',
    });
    expect(heading).toHaveFocus();
    expect(api.calls('history')).toEqual([{ station: '1', fuel: 'U91' }]);
    // The results stay mounted underneath, hidden.
    expect(
      screen.queryByRole('list', { name: 'Stations, cheapest first' }),
    ).not.toBeInTheDocument();
  });

  it('says what matters in words, has every day in a table, and credits the published data', async () => {
    const { user, container } = setup('/?query=Erina&history=1');
    expect(
      await screen.findByText(
        'Lowest in the last 26 days: 199.9 cents a litre on Wed, 30 Sept. Highest: 229.9 on Sat, 24 Oct.',
      ),
    ).toBeVisible();
    await user.click(screen.getByText('Daily prices as a table'));
    const table = screen.getByRole('table', { name: /Unleaded 91 at Ampol Foodary Erina/ });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent('Sat, 24 Oct224.9229.9229.9');
    expect(screen.getByText(/No data for 1 Oct 2026 to 22 Oct 2026/)).toBeVisible();
    const view = screen.getByRole('region', { name: /^Price history/ });
    expect(within(view).getByRole('link', { name: 'NSW FuelCheck price history' })).toHaveAttribute(
      'href',
      'https://data.nsw.gov.au/data/dataset/fuel-check',
    );
    await expectNoAxeViolations(container);
  });

  it('the chart is a slider over the days, for the keyboard as for the pointer', async () => {
    const { user } = setup('/?query=Erina&history=1');
    const slider = await screen.findByRole('slider', {
      name: 'Day on the Unleaded 91 price chart',
    });
    expect(slider).toHaveAttribute('aria-valuenow', '4');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      'Sat, 24 Oct: last 229.9, low 224.9, high 229.9 cents a litre',
    );
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '3');
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^Tue, 29 Sept: last 209\.9/),
    );
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '4');
  });

  it('Back closes it and returns focus to the link that opened it', async () => {
    const { user } = setup();
    await openCard(user);
    await user.click(nameLink());
    await screen.findByRole('heading', { name: 'Price history: Ampol Foodary Erina' });

    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    // Back, to the entry as it was before the history opened.
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=Erina&station=1');
    });
    expect(nameLink()).toHaveFocus();
  });

  it('returns focus to the list’s link, not the closed favourites panel’s link to the same station', async () => {
    window.localStorage.setItem(
      'fuel-finder:favourites:v1',
      JSON.stringify([{ code: '1', name: 'Ampol Foodary Erina' }]),
    );
    const { user } = setup();
    await openCard(user);
    const inList = within(screen.getByRole('list', { name: 'Stations, cheapest first' })).getByRole(
      'link',
      { name: 'Price history, Ampol Foodary Erina' },
    );
    await user.click(inList);
    await screen.findByRole('heading', { name: 'Price history: Ampol Foodary Erina' });
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    await waitFor(() => {
      expect(inList).toHaveFocus();
    });
  });

  it('opened from a shared link, Back to results stays on the page', async () => {
    const { user } = setup('/?query=Erina&history=1');
    await screen.findByRole('heading', { name: 'Price history: Ampol Foodary Erina' });
    const length = window.history.length;
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    expect(window.history.length).toBe(length);
    // The station is in the results underneath, its card closed, so its row takes focus.
    expect(stationRow('Ampol Foodary Erina')).toHaveFocus();
  });

  it('copes with little or no history, and with a station that has gone', async () => {
    const few = setup('/?query=Erina&history=1', () =>
      json(
        historyResponse({
          station: summary(ERINA),
          days: [['2026-10-24', 229.9, 229.9, 229.9]],
          sources: [],
        }),
      ),
    );
    expect(await screen.findByText('Only 1 day so far, so no chart yet.')).toBeVisible();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    few.unmount();

    const none = setup('/?query=Erina&history=1', () =>
      json(historyResponse({ station: summary(ERINA), days: [], sources: [] })),
    );
    expect(
      await screen.findByText(
        'No Unleaded 91 price history for this station yet. We add a day every morning.',
      ),
    ).toBeVisible();
    none.unmount();

    setup('/?query=Erina&history=999', () => apiError(404, 'not_found', 'Gone.'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'FuelCheck no longer lists this station',
    );
  });

  it.each(['light', 'dark'])('has no axe violations (%s)', async (theme) => {
    window.localStorage.setItem('fuel-finder:theme:v1', theme);
    const { container } = setup('/?query=Erina&history=1');
    await screen.findByRole('slider');
    await expectNoAxeViolations(container);
  });
});

describe('the station’s own page', () => {
  it('lists every fuel it sells now, in the picker’s order, marking the one charted', async () => {
    setup('/?query=Erina&history=1', () =>
      json(
        historyResponse({
          station: {
            ...summary(ERINA),
            prices: {
              DL: { priceCents: 249.9, updatedAt: '2026-10-22T03:30:00Z' },
              U91: { priceCents: 229.9, updatedAt: '2026-10-23T00:30:00Z' },
              P98: { priceCents: 251.9, updatedAt: '2026-10-23T00:30:00Z' },
            },
          },
        }),
      ),
    );
    const table = await screen.findByRole('table', { name: 'Every fuel here now, cents a litre' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Unleaded 91 (on the chart)',
      'Premium 98',
      'Diesel',
    ]);
    const diesel = rows[2];
    if (!diesel) throw new Error('no Diesel row');
    expect(within(diesel).getByRole('cell', { name: '249.9' })).toBeInTheDocument();
  });

  it('keeps every fuel behind a disclosure on a phone, and open beside the chart on a wide screen', async () => {
    setup('/?query=Erina&history=1');
    const phoneTable = await screen.findByRole('table', {
      name: 'Every fuel here now, cents a litre',
    });
    expect(phoneTable.closest('details')).not.toHaveAttribute('open');
    setScreen({ wide: true });
    expect(phoneTable.closest('details')).toHaveAttribute('open');
  });

  it('has directions to it', async () => {
    setup('/?query=Erina&history=1');
    const view = await screen.findByRole('region', { name: /^Price history/ });
    expect(
      await within(view).findByRole('link', {
        name: 'Directions to Ampol Foodary Erina, opens in a new tab',
      }),
    ).toHaveAttribute('target', '_blank');
  });
});
