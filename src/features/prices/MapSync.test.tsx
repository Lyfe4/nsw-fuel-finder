import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resetWarmedForTests } from '@/features/map/mapStyle';
import type { StationMapProps } from '@/features/map/StationMap';
import { renderApp } from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { fakeApi, json, prices, station } from '@/lib/testing/fakeApi';
import { setScreen } from '@/lib/testing/matchMedia';

/*
 * The whole app, with the map module swapped for a stand-in: a list of
 * "pick" buttons standing for the dots, and a record of the props it got.
 * `loads` counts how many times the module itself was imported, which is
 * what proves the map is lazy.
 */
const map = vi.hoisted(() => ({ loads: 0, props: null as StationMapProps | null }));

vi.mock('@/features/map/StationMap', () => {
  map.loads += 1;
  return {
    StationMap: (props: StationMapProps) => {
      map.props = props;
      return (
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
      );
    },
  };
});

const STATIONS = [
  station({ stationCode: '1', name: 'Ampol Erina', priceCents: 219.9 }),
  station({ stationCode: '2', name: 'Metro Gosford', priceCents: 224.9 }),
  station({ stationCode: '3', name: 'Shell Wyoming', priceCents: 231.9 }),
];

function setup(url = '/?query=Erina') {
  fakeApi({ location: () => json(prices({ stations: STATIONS })) });
  return renderApp(url);
}

const list = () => screen.findByRole('list', { name: 'Stations, cheapest first' });
const item = (name: string) => {
  const stations = screen.getByRole('list', { hidden: true, name: 'Stations, cheapest first' });
  const heading = within(stations).getByRole('heading', { level: 3, name, hidden: true });
  const li = heading.closest('li');
  if (!li) throw new Error(`no list item for ${name}`);
  return li;
};
const showOnMap = (name: string) => screen.getByRole('button', { name: `Show on map, ${name}` });
const viewButton = (name: 'List' | 'Map') => screen.getByRole('button', { name });

describe('list and map, on a phone', () => {
  it('shows the list first, and loads the map only when Map is chosen', async () => {
    const { user, container } = setup();
    await list();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(map.loads).toBe(0);
    expect(viewButton('List')).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations(container);

    await user.click(viewButton('Map'));
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(map.loads).toBe(1);
    expect(viewButton('Map')).toHaveAttribute('aria-pressed', 'true');
    // Pressing the switch keeps focus on it: it is still on screen.
    expect(viewButton('Map')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map');
    // The list stays mounted but hidden, keeping its scroll position.
    expect(
      screen.getByRole('list', { hidden: true, name: 'Stations, cheapest first' }),
    ).not.toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('"Show on map" switches to the map with focus on the station’s card', async () => {
    const { user } = setup();
    await list();
    await user.click(showOnMap('Metro Gosford'));

    const card = await screen.findByRole('heading', { level: 3, name: 'Metro Gosford' });
    expect(card).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map&station=2');
    expect(map.props?.selected).toBe('2');

    // "Show in list" goes back, with focus on the same station's button.
    await user.click(screen.getByRole('button', { name: 'Show in list' }));
    expect(showOnMap('Metro Gosford')).toHaveFocus();
    expect(item('Metro Gosford')).toHaveTextContent('Shown on map');
    expect(window.location.search).toBe('?fuel=U91&query=Erina&station=2');
  });

  it('closing the card moves focus to the Map switch, never to the page', async () => {
    const { user } = setup('/?query=Erina&view=map&station=3');
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Close, Shell Wyoming' }));
    expect(viewButton('Map')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map');
  });
});

describe('list and map, on a wide screen', () => {
  it('shows both, with no switch', async () => {
    setScreen({ wide: true });
    const { container } = setup();
    await list();
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Show results as' })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('"Show on map" highlights the station on the map and keeps focus on the button', async () => {
    setScreen({ wide: true });
    const { user } = setup();
    await list();
    await user.click(showOnMap('Shell Wyoming'));

    expect(showOnMap('Shell Wyoming')).toHaveFocus();
    expect(item('Shell Wyoming')).toHaveTextContent('Shown on map');
    expect(map.props).toMatchObject({ selected: '3', showRequest: 1 });

    // Asking again re-centres the map, even though the selection is the same.
    await user.click(showOnMap('Shell Wyoming'));
    expect(map.props?.showRequest).toBe(2);
  });

  it('picking a dot highlights and scrolls to the list item, without taking focus', async () => {
    setScreen({ wide: true });
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user } = setup();
    await list();
    const search = screen.getByRole('combobox', { name: /suburb or postcode/i });
    search.focus();

    // A pointer click; the stand-in is a button, so restore focus as a canvas click would leave it.
    await user.click(await screen.findByRole('button', { name: 'Dot for Metro Gosford' }));
    search.focus();

    await waitFor(() => {
      expect(item('Metro Gosford')).toHaveTextContent('Shown on map');
    });
    expect(scrolled.mock.contexts.at(-1)).toBe(item('Metro Gosford'));
    expect(search).toHaveFocus();
    expect(
      within(screen.getByTestId('map').parentElement?.parentElement ?? document.body).getByRole(
        'heading',
        { level: 3, name: 'Metro Gosford' },
      ),
    ).toBeInTheDocument();
  });

  it('closing the card returns focus to the station’s list button', async () => {
    setScreen({ wide: true });
    const { user } = setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Close, Ampol Erina' }));
    expect(showOnMap('Ampol Erina')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
  });

  it('a shared link opens on its station; a new search clears it', async () => {
    setScreen({ wide: true });
    const { user } = setup('/?query=Erina&station=2');
    await list();
    expect(item('Metro Gosford')).toHaveTextContent('Shown on map');

    const search = screen.getByRole('combobox', { name: /suburb or postcode/i });
    await user.clear(search);
    await user.type(search, 'Gosford{Enter}');
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=Gosford');
    });
  });
});

/** A WebGL context naming its renderer, which is all the start probe reads (mapStart.ts). */
function renderer(name: string) {
  const gl = { RENDERER: 0x1f01, getParameter: () => name, getExtension: () => null };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => gl) as never);
}

const openFreeMapFetches = (api: ReturnType<typeof fakeApi>) =>
  api.fetch.mock.calls.filter(([input]) =>
    (input instanceof Request ? input.url : input.toString()).includes('openfreemap'),
  ).length;

describe('when a wide screen’s map starts', () => {
  function setupWide(url = '/?query=Erina') {
    setScreen({ wide: true });
    resetWarmedForTests();
    const api = fakeApi({ location: () => json(prices({ stations: STATIONS })) });
    return { ...renderApp(url), api };
  }

  it('by itself once the list has rendered, where there is a GPU', async () => {
    renderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)');
    setupWide();
    await list();
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(map.props?.focusOnStart).toBe(false);
  });

  it('when asked, where WebGL is drawn in software, and then for the rest of the visit', async () => {
    renderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)');
    const { user, container, api } = setupWide();
    await list();
    const show = await screen.findByRole('button', { name: 'Show the map' });
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(screen.getByText(/without graphics acceleration/)).toBeVisible();
    // Not a byte from OpenFreeMap until the map is wanted.
    expect(openFreeMapFetches(api)).toBe(0);
    await expectNoAxeViolations(container);

    await user.click(show);
    expect(await screen.findByTestId('map')).toBeVisible();
    // The button went away: the map takes focus once it exists.
    expect(map.props?.focusOnStart).toBe(true);
    expect(openFreeMapFetches(api)).toBeGreaterThan(0);

    const search = screen.getByRole('combobox', { name: /suburb or postcode/i });
    await user.clear(search);
    await user.type(search, 'Gosford{Enter}');
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=Gosford');
    });
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show the map' })).not.toBeInTheDocument();
  });

  it('on "Show on map" too, which keeps focus on the list', async () => {
    renderer('Google SwiftShader');
    const { user } = setupWide();
    await list();
    await screen.findByRole('button', { name: 'Show the map' });
    await user.click(showOnMap('Metro Gosford'));
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(map.props).toMatchObject({ selected: '2', focusOnStart: false });
    expect(showOnMap('Metro Gosford')).toHaveFocus();
  });

  it('as before where there is no WebGL at all, so the map can say so itself', async () => {
    setupWide();
    await list();
    expect(await screen.findByTestId('map')).toBeVisible();
  });
});
