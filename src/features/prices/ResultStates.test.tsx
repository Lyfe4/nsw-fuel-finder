import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { announced, placeInput, renderApp, results } from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { apiError, fakeApi, json, prices } from '@/lib/testing/fakeApi';

describe('result states', () => {
  it('empty: says so, and offers the widest search without a new history entry', async () => {
    const api = fakeApi({
      location: (params) =>
        json(params.get('radius') === '25' ? prices() : prices({ stations: [] })),
    });
    const { user, container } = renderApp('/?query=Erina');

    expect(
      await within(results()).findByText(
        'No stations sell Unleaded 91 within 5 km of Erina NSW 2250.',
      ),
    ).toBeInTheDocument();
    expect(announced()).toBe('No stations found selling Unleaded 91.');
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Search within 25 km' }));
    // The button is gone once it works; focus went to the results heading, not <body>.
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(api.calls('location').at(-1)).toMatchObject({ radius: '25' });
    expect(window.location.search).toBe('?fuel=U91&query=Erina&radius=25');
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There is more than one Kingswood. Which did you mean?',
    );
    // The error is the alert's to announce; the status region stays quiet.
    expect(announced()).toBe('');
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
});
