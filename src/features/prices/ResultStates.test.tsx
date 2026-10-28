import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  announced,
  openSearch,
  placeInput,
  renderApp,
  results,
  stationNames,
} from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { apiError, FETCHED_AT, fakeApi, json, prices, station } from '@/lib/testing/fakeApi';

describe('result states', () => {
  it('nothing within the distance: the nearest stations instead, nearest first, and why', async () => {
    const far = (code: string, name: string, km: number, cents: number) =>
      station({ stationCode: code, name, distanceKm: km, priceCents: cents });
    fakeApi({
      location: () =>
        json(
          prices({
            origin: { latitude: -30.09, longitude: 145.94, label: 'Bourke NSW 2840' },
            stations: [],
            nearest: [
              far('7', 'Enngonia Store', 38.2, 239.9),
              far('8', 'Brewarrina Fuel', 71.6, 229.9),
            ],
          }),
        ),
    });
    const { container } = renderApp('/?query=Bourke&radius=25');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nearest stations, 38–72 km away' }),
    ).toBeInTheDocument();
    expect(
      within(results()).getByText(
        'None sell Unleaded 91 within 25 km of Bourke NSW 2840, so these are the nearest 2 that do, nearest first.',
      ),
    ).toBeVisible();
    const list = screen.getByRole('list', { name: 'Stations, nearest first' });
    expect(stationNames(list)).toEqual(['Enngonia Store', 'Brewarrina Fuel']);
    expect(announced()).toBe(
      'None within 25 km. The nearest 2 selling Unleaded 91 are 38 to 72 km away. Cheapest of them is 229.9 cents a litre at Brewarrina Fuel.',
    );
    // Ten far-flung stations need no sorting, filtering or saving sum.
    expect(screen.queryByRole('combobox', { name: 'Sort' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Cheapest .*, average/)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('nothing within 100 km either: says so, with somewhere to go next', async () => {
    fakeApi({ location: () => json(prices({ stations: [], nearest: [] })) });
    const { container } = renderApp('/?query=Erina&fuel=B20');
    expect(
      await within(results()).findByText(
        'No stations sell Biodiesel 20 within 100 km of Erina NSW 2250.',
      ),
    ).toBeVisible();
    expect(within(results()).getByText('Try another fuel, or a different place.')).toBeVisible();
    expect(announced()).toBe('No stations found selling Biodiesel 20.');
    await expectNoAxeViolations(container);
  });

  it('distance: offers 2, 5, 10 and 25 km, starts at 5, and keeps the choice in the URL', async () => {
    const api = fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    // On a phone the distance is behind Change once there are results.
    await openSearch(user);
    const distance = screen.getByRole('combobox', { name: 'Within' });
    expect(
      within(distance)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['2 km', '5 km', '10 km', '25 km']);
    expect(distance).toHaveValue('5');
    await user.selectOptions(distance, '2 km');
    expect(window.location.search).toBe('?fuel=U91&query=Erina&radius=2');
    expect(
      await screen.findByRole('heading', { name: '2 stations within 2 km of Erina NSW 2250' }),
    ).toBeVisible();
    expect(api.calls('location').at(-1)).toMatchObject({ radius: '2' });
  });

  it('ambiguous: lists the places, and a choice searches it', async () => {
    const api = fakeApi({
      location: (params) =>
        params.get('query') === 'Kingswood'
          ? apiError(409, 'ambiguous_location', 'There is more than one Kingswood.', [
              'Kingswood (Bega Valley) NSW 2550',
              'Kingswood (Penrith) NSW 2747',
            ])
          : json(
              prices({
                origin: {
                  latitude: -33.76,
                  longitude: 150.72,
                  label: 'Kingswood (Penrith) NSW 2747',
                },
              }),
            ),
    });
    const { user, container } = renderApp('/?query=Kingswood');

    // A question, not an error: said politely by the status region, not as an alert.
    await waitFor(() => {
      expect(announced()).toBe('There is more than one Kingswood. Which did you mean?');
    });
    expect(
      within(results()).getByText('There is more than one Kingswood. Which did you mean?', {
        selector: 'p:not([role])',
      }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Kingswood (Penrith) NSW 2747' }));
    expect(placeInput()).toHaveFocus();
    expect(placeInput()).toHaveValue('Kingswood (Penrith) NSW 2747');
    await waitFor(() => {
      expect(api.calls('location').at(-1)).toMatchObject({ query: 'Kingswood (Penrith) NSW 2747' });
    });
  });

  it('not found: explains, and leads back to the search box', async () => {
    fakeApi({
      location: () =>
        apiError(404, 'location_not_found', "We couldn't find Atlantis in NSW or the ACT."),
    });
    const { user } = renderApp('/?query=Atlantis');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't find Atlantis in NSW or the ACT. Check the spelling, or try a postcode.",
    );
    await user.click(screen.getByRole('button', { name: 'Change the search' }));
    expect(placeInput()).toHaveFocus();
  });

  it('prices unavailable (503): says to try again, and retrying works', async () => {
    let attempts = 0;
    const api = fakeApi({
      location: () =>
        ++attempts === 1
          ? apiError(503, 'snapshot_unavailable', 'Fuel prices are not available right now.')
          : json(prices()),
    });
    const { user, container } = renderApp('/?query=Erina');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fuel prices aren’t available right now. Please try again in a minute.',
    );
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(api.calls('location')).toHaveLength(2);
  });

  it('rate limited (429): says to wait, and does not retry by itself', async () => {
    // Netlify's edge answers a rate-limited request itself, not with our JSON.
    const api = fakeApi({ location: () => new Response('Too Many Requests', { status: 429 }) });
    renderApp('/?query=Erina');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A lot of searches are coming from your network right now. Please wait a minute and try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(api.calls('location')).toHaveLength(1);
  });

  it('offline: says to check the connection', async () => {
    fakeApi({ location: () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp('/?query=Erina');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t connect. Check your internet connection and try again.',
    );
  });

  it('stale: still shows the prices, with a visible and announced warning', async () => {
    fakeApi({
      location: () => json(prices({ stale: true, fetchedAt: '2026-10-22T21:00:00.000Z' })),
    });
    const { container } = renderApp('/?query=Erina');

    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(within(results()).getByText('These prices may be out of date.')).toBeInTheDocument();
    expect(announced()).toMatch(/These prices may be out of date\.$/);
    // Not an alert: the prices are still the best answer there is.
    expect(screen.queryByRole('alert')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('postcode: says "of postcode 2880", not "of 2880"', async () => {
    fakeApi({
      location: () =>
        json(prices({ origin: { latitude: -31.95, longitude: 141.46, label: '2880' } })),
    });
    renderApp('/?query=2880');
    expect(
      await screen.findByRole('heading', { name: '2 stations within 5 km of postcode 2880' }),
    ).toBeInTheDocument();
  });

  it('refresh: a newer snapshot for the same search, on coming back to the tab, is announced', async () => {
    let fetchedAt = FETCHED_AT;
    fakeApi({ location: () => json(prices({ fetchedAt })) });
    renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(announced()).toMatch(/^2 stations found\./);

    // Half an hour later the snapshot has moved on, and the tab gets focus again.
    fetchedAt = '2026-10-23T04:00:00.000Z';
    const later = Date.now() + 30 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(announced()).toMatch(/^Prices updated, as of .*3:00\spm\. 2 stations found\./);
    });
    focusManager.setFocused(undefined);
  });

  it('refresh: the first answer to a new search is not announced as an update', async () => {
    fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fuel' }), 'E10');
    await waitFor(() => {
      expect(announced()).toMatch(/^2 stations found\. Cheapest Ethanol 94/);
    });
  });
});
