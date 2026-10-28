import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StationMapProps } from '@/features/map/StationMap';
import { renderApp, stationRow } from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { FETCHED_AT, fakeApi, json, prices, station } from '@/lib/testing/fakeApi';
import { setScreen } from '@/lib/testing/matchMedia';

/* The map module is swapped for dots-as-buttons, as in MapSync.test.tsx. */
vi.mock('@/features/map/StationMap', () => ({
  StationMap: (props: StationMapProps) => (
    <div data-testid="map">
      {props.stations.map((s) => (
        <button
          key={s.stationCode}
          type="button"
          onClick={() => {
            props.onPick(s.stationCode);
          }}
        >
          Dot for {s.name}
        </button>
      ))}
    </div>
  ),
}));

/** 45 stations, cheapest first, 200.0 to 222.0 cents. */
const MANY = Array.from({ length: 45 }, (_, i) =>
  station({
    stationCode: String(i + 1),
    name: `Station ${String(i + 1)}`,
    priceCents: 200 + i / 2,
  }),
);

const list = () => screen.findByRole('list', { name: 'Stations, cheapest first' });
const listed = () =>
  within(screen.getByRole('list', { name: 'Stations, cheapest first' })).getAllByRole('listitem');

describe('a long list', () => {
  it('lists 20 at first, and says how many of how many', async () => {
    fakeApi({ location: () => json(prices({ stations: MANY })) });
    const { container } = renderApp('/?query=2150&radius=25');

    await list();
    expect(listed()).toHaveLength(20);
    expect(screen.getByText('Showing 20 of 45 stations')).toHaveAttribute('role', 'status');
    expect(within(screen.getByRole('region')).getAllByRole('status')[0]).toHaveTextContent(
      '45 stations found. Listing the cheapest 20.',
    );
    // One Tab stop per listed station, not per result: the row itself.
    expect(screen.getAllByRole('button', { expanded: false, name: /cents a litre/ })).toHaveLength(
      20,
    );
    await expectNoAxeViolations(container);
  });

  it('shows 20 more at a time, moving focus to the first new station', async () => {
    fakeApi({ location: () => json(prices({ stations: MANY })) });
    const { user } = renderApp('/?query=2150&radius=25');
    await list();

    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(listed()).toHaveLength(40);
    expect(stationRow('Station 21')).toHaveFocus();
    expect(screen.getByText('Showing 40 of 45 stations')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(listed()).toHaveLength(45);
    expect(stationRow('Station 41')).toHaveFocus();
    expect(screen.getByText('Showing all 45 stations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).not.toBeInTheDocument();
  });

  it('starts from the first batch again for a new search, but not for a refresh', async () => {
    fakeApi({ location: () => json(prices({ stations: MANY })) });
    const { user } = renderApp('/?query=2150&radius=25');
    await list();
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(listed()).toHaveLength(40);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Fuel' }), 'E10');
    await waitFor(() => {
      expect(listed()).toHaveLength(20);
    });
  });

  it('a short list has no "Show more" and no count line', async () => {
    fakeApi();
    renderApp('/?query=Erina');
    await list();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  it('lists a station picked on the map, beyond the first batch, and keeps it listed after Close', async () => {
    setScreen({ wide: true });
    fakeApi({ location: () => json(prices({ stations: MANY })) });
    const { user } = renderApp('/?query=2150&radius=25');
    await list();

    await user.click(await screen.findByRole('button', { name: 'Dot for Station 33' }));
    expect(listed()).toHaveLength(33);

    await user.click(screen.getByRole('button', { name: 'Close, Station 33' }));
    expect(listed()).toHaveLength(33);
    expect(stationRow('Station 33')).toHaveFocus();
    expect(stationRow('Station 33')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('what each station says', () => {
  it('marks the cheapest in words, ties included', async () => {
    fakeApi({
      location: () =>
        json(
          prices({
            stations: [
              station({ stationCode: '1', name: 'First', priceCents: 199.9 }),
              station({ stationCode: '2', name: 'Second', priceCents: 199.9 }),
              station({ stationCode: '3', name: 'Third', priceCents: 205.9 }),
            ],
          }),
        ),
    });
    renderApp('/?query=Erina');
    await list();
    // On screen the word, and in the row's name too.
    expect(stationRow('First')).toHaveAccessibleName(/^First 199\.9 cents a litre, cheapest,/);
    expect(stationRow('Second')).toHaveAccessibleName(/^Second 199\.9 cents a litre, cheapest,/);
    expect(stationRow('Third')).toHaveAccessibleName(/^Third 205\.9 cents a litre, \d/);
    const [first, , third] = listed();
    expect(within(first ?? document.body).getByText('Cheapest')).toBeVisible();
    expect(within(third ?? document.body).queryByText('Cheapest')).not.toBeInTheDocument();
  });

  it('does not call anything cheapest when every price is the same', async () => {
    fakeApi({
      location: () =>
        json(prices({ stations: [station({ stationCode: '1' }), station({ stationCode: '2' })] })),
    });
    renderApp('/?query=Erina');
    await list();
    expect(screen.queryByText('Cheapest')).not.toBeInTheDocument();
  });

  it('calls out a price that has not changed for a fortnight', async () => {
    const days = (n: number) => new Date(Date.parse(FETCHED_AT) - n * 86_400_000).toISOString();
    fakeApi({
      location: () =>
        json(
          prices({
            stations: [
              station({ stationCode: '1', name: 'Fresh', priceUpdatedAt: days(13) }),
              station({ stationCode: '2', name: 'Stale', priceUpdatedAt: days(32) }),
            ],
          }),
        ),
    });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(FETCHED_AT) });
    try {
      renderApp('/?query=Erina');
      await list();
      expect(stationRow('Fresh')).toHaveAccessibleName(/, updated 13 days ago$/);
      // In words, in bold, on screen and in the row's name.
      expect(stationRow('Stale')).toHaveAccessibleName(/, Old price, updated 32 days ago$/);
      const [, stale] = listed();
      expect(within(stale ?? document.body).getByText(/^Old price,/).tagName).toBe('STRONG');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('accessibility in both themes', () => {
  it.each(['light', 'dark'])(
    'the list, map, key and selected card have no axe violations (%s)',
    async (theme) => {
      window.localStorage.setItem('fuel-finder:theme:v1', theme);
      setScreen({ wide: true });
      fakeApi({ location: () => json(prices({ stations: MANY })) });
      const { user, container } = renderApp('/?query=2150&radius=25');
      await list();
      await user.click(await screen.findByRole('button', { name: 'Dot for Station 3' }));
      expect(document.documentElement.dataset.theme).toBe(theme);
      await expectNoAxeViolations(container);
    },
  );
});
