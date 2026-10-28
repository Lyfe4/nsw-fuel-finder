import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, stationRow } from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { fakeApi, json, prices, station, stationsResponse, summary } from '@/lib/testing/fakeApi';

import { FAVOURITES_STORAGE_KEY, readFavourites } from './favourites';

const ERINA = station({ stationCode: '1', name: 'Ampol Foodary Erina', priceCents: 229.9 });
const GOSFORD = station({ stationCode: '2', name: 'Metro Gosford', priceCents: 219.9 });

function store(favourites: { code: string; name: string }[]) {
  window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(favourites));
}

const panel = () => screen.getByText(/^Favourites/, { selector: 'summary' }).closest('details');

describe('favourites storage', () => {
  it('reads nothing from junk, duplicates or a throwing storage', () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, '{"not":"a list"}');
    expect(readFavourites()).toEqual([]);
    store([
      { code: '1', name: 'A' },
      { code: '1', name: 'A again' },
    ]);
    window.localStorage.setItem(
      FAVOURITES_STORAGE_KEY,
      JSON.stringify([
        { code: '1', name: 'A' },
        { code: '1', name: 'B' },
        { code: '<x>', name: 'C' },
        7,
      ]),
    );
    expect(readFavourites()).toEqual([{ code: '1', name: 'A' }]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readFavourites()).toEqual([]);
  });
});

describe('favourites', () => {
  it('a station is starred from its card: a toggle with one name and its state', async () => {
    fakeApi({
      location: () => json(prices({ stations: [ERINA, GOSFORD] })),
      stations: () => json(stationsResponse([summary(ERINA)])),
    });
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });

    await user.click(stationRow('Ampol Foodary Erina'));
    const star = screen.getByRole('button', { name: 'Favourite, Ampol Foodary Erina' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toHaveFocus();
    expect(readFavourites()).toEqual([{ code: '1', name: 'Ampol Foodary Erina' }]);
    expect(within(panel() ?? document.body).getByText('Favourites (1)')).toBeVisible();

    await user.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(readFavourites()).toEqual([]);
  });

  it('at 50 favourites, says why another cannot be added instead of ignoring the press', async () => {
    store(
      Array.from({ length: 50 }, (_, i) => ({
        code: String(100 + i),
        name: `Station ${String(i)}`,
      })),
    );
    fakeApi({
      location: () => json(prices({ stations: [ERINA] })),
      stations: () => json(stationsResponse([])),
    });
    const { user, container } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });

    await user.click(stationRow('Ampol Foodary Erina'));
    const star = screen.getByRole('button', { name: 'Favourite, Ampol Foodary Erina' });
    await user.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You already have 50 favourites, the most this device keeps. Remove one to add this station.',
    );
    expect(readFavourites()).toHaveLength(50);
    await expectNoAxeViolations(container);
  });

  it('lists favourites with today’s prices for the chosen fuel, cheapest first, from /api/stations', async () => {
    store([
      { code: '1', name: 'Ampol Foodary Erina' },
      { code: '2', name: 'Metro Gosford' },
    ]);
    const api = fakeApi({
      stations: () => json(stationsResponse([summary(ERINA), summary(GOSFORD)])),
    });
    const { container } = renderApp('/');

    // No search yet: the panel is open, since favourites are the point of this visit.
    expect(panel()).toHaveAttribute('open');
    const list = await screen.findByRole('list', { name: 'Favourites, Unleaded 91' });
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('219.9 cents a litre');
    });
    const names = within(list)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Metro Gosford', 'Ampol Foodary Erina']);
    // Asked once, sorted, with no search in sight.
    expect(api.calls('stations')).toEqual([{ codes: '1,2' }]);
    expect(api.calls('location')).toEqual([]);
    await expectNoAxeViolations(container);
  });

  it('says when a station does not sell the fuel, or FuelCheck no longer lists it, and can remove it', async () => {
    store([
      { code: '1', name: 'Ampol Foodary Erina' },
      { code: '9', name: 'Closed Servo' },
    ]);
    fakeApi({ stations: () => json(stationsResponse([summary(ERINA, 'E10')], ['9'])) });
    const { user } = renderApp('/');

    expect(await screen.findByText('FuelCheck no longer lists this station.')).toBeVisible();
    expect(screen.getByText('Does not sell Unleaded 91.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Remove, Closed Servo' }));
    expect(screen.queryByText('Closed Servo')).not.toBeInTheDocument();
    // Its button is gone; focus goes to the next row's Remove, not <body>.
    expect(screen.getByRole('button', { name: 'Remove, Ampol Foodary Erina' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove, Ampol Foodary Erina' }));
    expect(screen.getByText('Favourites', { selector: 'summary' })).toHaveFocus();
    expect(screen.getByText(/No favourites yet/)).toBeVisible();
  });

  it('is closed once there is a search, so the results are not pushed down', async () => {
    store([{ code: '1', name: 'Ampol Foodary Erina' }]);
    fakeApi({ stations: () => json(stationsResponse([summary(ERINA)])) });
    renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(panel()).not.toHaveAttribute('open');
  });

  it('picks up a favourite added in another tab', async () => {
    fakeApi({ stations: () => json(stationsResponse([summary(ERINA)])) });
    renderApp('/');
    act(() => {
      store([{ code: '1', name: 'Ampol Foodary Erina' }]);
      window.dispatchEvent(new StorageEvent('storage', { key: FAVOURITES_STORAGE_KEY }));
    });
    expect(await screen.findByText('Favourites (1)')).toBeVisible();
  });

  it.each(['light', 'dark'])(
    'has no axe violations with favourites and a search (%s)',
    async (theme) => {
      window.localStorage.setItem('fuel-finder:theme:v1', theme);
      store([{ code: '1', name: 'Ampol Foodary Erina' }]);
      fakeApi({ stations: () => json(stationsResponse([summary(ERINA)])) });
      const { container } = renderApp('/?query=Erina');
      await screen.findByRole('list', { name: 'Stations, cheapest first' });
      await expectNoAxeViolations(container);
    },
  );
});
