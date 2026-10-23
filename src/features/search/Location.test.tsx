import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '@/lib/testing/axe';
import { apiError, fakeApi, json, prices, station } from '@/lib/testing/fakeApi';
import { fakeGeolocation } from '@/lib/testing/geolocation';

import { announced, placeInput, renderApp, results } from './testing';

describe('searching by location', () => {
  it('announces locating, then searches near a rounded position and shows real distances', async () => {
    const geo = fakeGeolocation();
    const api = fakeApi({
      nearby: () =>
        json(
          prices({
            origin: { latitude: -33.87, longitude: 151.21, label: null },
            // The API measured from the rounded point; the app re-measures.
            stations: [station({ latitude: -33.8598, longitude: 151.2093, distanceKm: 1.9 })],
          }),
        ),
    });
    const { user, container } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(announced()).toBe('Finding your location…');
    expect(screen.getByRole('button', { name: 'Finding your location…' })).toHaveFocus();

    geo.succeed(-33.868812, 151.209321);
    await screen.findByRole('list', { name: 'Stations, cheapest first' });

    // Only ~1 km precision ever leaves the device.
    expect(api.calls('nearby')).toEqual([
      { lat: '-33.87', lng: '151.21', fuel: 'U91', radius: '5' },
    ]);
    expect(window.location.search).toBe('?fuel=U91&lat=-33.87&lng=151.21');
    expect(within(results()).getByText(/1\.0 km away/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      '1 station within 5 km of you',
    );
    await expectNoAxeViolations(container);
  });

  it('denied: explains, and the way out puts focus in the suburb box', async () => {
    const geo = fakeGeolocation();
    const api = fakeApi();
    const { user, container } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    geo.fail(1);

    expect(screen.getByRole('alert')).toHaveTextContent(/Location is blocked for this site/);
    expect(api.calls('nearby')).toEqual([]);
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Search by suburb or postcode' }));
    expect(placeInput()).toHaveFocus();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('timeout: offers to try again', async () => {
    const geo = fakeGeolocation();
    fakeApi();
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    geo.fail(3);
    expect(screen.getByRole('alert')).toHaveTextContent(/took too long/);

    await user.click(screen.getByRole('button', { name: 'Try location again' }));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    expect(announced()).toBe('Finding your location…');
  });

  it('unavailable: suggests searching instead', async () => {
    const geo = fakeGeolocation();
    fakeApi();
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    geo.fail(2);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t work out where you are/);
  });

  it('unsupported: says so without asking', async () => {
    // jsdom has no navigator.geolocation, like a browser that cannot share one.
    fakeApi();
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/This browser can’t share your location/);
  });

  it('outside NSW: says what the app covers', async () => {
    const geo = fakeGeolocation();
    fakeApi({ nearby: () => apiError(400, 'bad_request', 'That location is outside NSW.') });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    geo.succeed(-37.81, 144.96);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That location is outside NSW. Fuel Finder covers NSW and the ACT.',
    );
  });

  it('a suburb search made while locating wins over the late position', async () => {
    const geo = fakeGeolocation();
    const api = fakeApi();
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.type(placeInput(), 'Erina{Enter}');
    geo.succeed(-33.87, 151.21);

    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=Erina');
    });
    expect(api.calls('nearby')).toEqual([]);
  });
});
