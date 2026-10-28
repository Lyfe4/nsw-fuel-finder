import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resetWarmedForTests } from '@/features/map/mapStyle';
import type { StationMapProps } from '@/features/map/StationMap';
import { renderApp, stationRow } from '@/features/search/testing';
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
          {/* MapLibre's canvas: where focus goes when the card takes it away. */}
          <canvas data-testid="map-canvas" tabIndex={-1} />
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
  const li = stationRow(name).closest('li');
  if (!li) throw new Error(`no list item for ${name}`);
  return li;
};
const open = (name: string) => stationRow(name).getAttribute('aria-expanded') === 'true';
const viewButton = (name: 'List' | 'Map') => screen.getByRole('button', { name });
const canvas = () => screen.getByTestId('map-canvas');
/** A tap on the map away from every station, as StationMap reports it. */
const tapNothing = () => {
  act(() => {
    map.props?.onClear();
  });
};

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

  it('a row opens its card in the list, selects it, and does not load the map', async () => {
    const { user, container } = setup();
    await list();
    await user.click(stationRow('Metro Gosford'));

    expect(open('Metro Gosford')).toBe(true);
    expect(stationRow('Metro Gosford')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&station=2');
    expect(
      within(item('Metro Gosford')).getByRole('button', { name: 'Close, Metro Gosford' }),
    ).toBeVisible();
    // Still the list: a phone reading a station does not download MapLibre.
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);

    // Map then shows it selected, with the card under the map.
    await user.click(viewButton('Map'));
    await screen.findByTestId('map');
    expect(map.props?.selected).toBe('2');
    expect(screen.getByRole('heading', { level: 3, name: 'Metro Gosford' })).toBeVisible();
    await expectNoAxeViolations(container);

    // And back: the row is still open.
    await user.click(viewButton('List'));
    expect(open('Metro Gosford')).toBe(true);
  });

  it('pressing an open row again closes it, focus staying on the row', async () => {
    const { user } = setup('/?query=Erina&station=2');
    await list();
    expect(open('Metro Gosford')).toBe(true);
    await user.click(stationRow('Metro Gosford'));
    expect(open('Metro Gosford')).toBe(false);
    expect(stationRow('Metro Gosford')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
  });

  it('opening one row closes the other', async () => {
    const { user } = setup('/?query=Erina&station=2');
    await list();
    await user.click(stationRow('Shell Wyoming'));
    expect(open('Shell Wyoming')).toBe(true);
    expect(open('Metro Gosford')).toBe(false);
  });

  it('Close, or Escape, in a row’s card closes it and returns focus to the row', async () => {
    const { user } = setup('/?query=Erina&station=2');
    await list();
    await user.click(screen.getByRole('button', { name: 'Close, Metro Gosford' }));
    expect(stationRow('Metro Gosford')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');

    await user.click(stationRow('Metro Gosford'));
    screen.getByRole('button', { name: 'Favourite, Metro Gosford' }).focus();
    await user.keyboard('{Escape}');
    expect(open('Metro Gosford')).toBe(false);
    expect(stationRow('Metro Gosford')).toHaveFocus();
  });

  it('closing the card moves focus to the Map switch, never to the page', async () => {
    const { user } = setup('/?query=Erina&view=map&station=3');
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Close, Shell Wyoming' }));
    expect(viewButton('Map')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map');
  });

  it('a tap on the map away from the stations closes the card and stays on the map', async () => {
    setup('/?query=Erina&view=map&station=3');
    await screen.findByTestId('map');
    // Focus in the card, which is about to go: it must land on the map, not the page.
    screen.getByRole('button', { name: 'Favourite, Shell Wyoming' }).focus();
    tapNothing();
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map');
    expect(screen.queryByRole('heading', { level: 3, name: 'Shell Wyoming' })).toBeNull();
    expect(canvas()).toHaveFocus();
  });

  it('Escape in the card is its Close: focus to the Map switch', async () => {
    const { user } = setup('/?query=Erina&view=map&station=3');
    await screen.findByTestId('map');
    screen.getByRole('button', { name: 'Favourite, Shell Wyoming' }).focus();
    await user.keyboard('{Escape}');
    expect(window.location.search).toBe('?fuel=U91&query=Erina&view=map');
    expect(viewButton('Map')).toHaveFocus();
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

  it('a row highlights its station on the map, opens its card in the list, and keeps focus', async () => {
    setScreen({ wide: true });
    const { user, container } = setup();
    await list();
    await user.click(stationRow('Shell Wyoming'));

    expect(stationRow('Shell Wyoming')).toHaveFocus();
    expect(open('Shell Wyoming')).toBe(true);
    expect(map.props).toMatchObject({ selected: '3', showRequest: 1 });
    // One card, in the list: none repeated under the map.
    expect(screen.getAllByRole('button', { name: 'Close, Shell Wyoming' })).toHaveLength(1);
    await expectNoAxeViolations(container);

    // Pressed again, it closes.
    await user.click(stationRow('Shell Wyoming'));
    expect(map.props?.selected).toBeNull();
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
      expect(open('Metro Gosford')).toBe(true);
    });
    expect(scrolled.mock.contexts.at(-1)).toBe(item('Metro Gosford'));
    expect(search).toHaveFocus();
    expect(within(item('Metro Gosford')).getByRole('link', { name: /^Directions/ })).toBeVisible();
  });

  it('closing the card returns focus to the station’s list button', async () => {
    setScreen({ wide: true });
    const { user } = setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Close, Ampol Erina' }));
    expect(stationRow('Ampol Erina')).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
  });

  it('a tap on the map away from the stations closes the card, leaving focus where it was', async () => {
    setScreen({ wide: true });
    setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    const search = screen.getByRole('combobox', { name: /suburb or postcode/i });
    search.focus();
    tapNothing();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    expect(screen.queryByRole('button', { name: 'Close, Ampol Erina' })).toBeNull();
    expect(open('Ampol Erina')).toBe(false);
    expect(search).toHaveFocus();
  });

  it('a tap on the map with focus in the card moves focus to the map', async () => {
    setScreen({ wide: true });
    setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    screen.getByRole('button', { name: 'Close, Ampol Erina' }).focus();
    tapNothing();
    expect(canvas()).toHaveFocus();
  });

  it('Escape on the map clears the selection and keeps focus on the map', async () => {
    setScreen({ wide: true });
    const { user, container } = setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    canvas().focus();
    await user.keyboard('{Escape}');
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    expect(canvas()).toHaveFocus();
    await expectNoAxeViolations(container);

    // With nothing selected, Escape does nothing.
    await user.keyboard('{Escape}');
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    expect(canvas()).toHaveFocus();
  });

  it('Escape in the card is its Close: focus to the station’s list button', async () => {
    setScreen({ wide: true });
    const { user } = setup('/?query=Erina&station=1');
    await screen.findByTestId('map');
    screen.getByRole('button', { name: 'Close, Ampol Erina' }).focus();
    await user.keyboard('{Escape}');
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    expect(stationRow('Ampol Erina')).toHaveFocus();
  });

  it('a shared link opens on its station; a new search clears it', async () => {
    setScreen({ wide: true });
    const { user } = setup('/?query=Erina&station=2');
    await list();
    expect(open('Metro Gosford')).toBe(true);

    const search = screen.getByRole('combobox', { name: /suburb or postcode/i });
    await user.clear(search);
    await user.type(search, 'Gosford{Enter}');
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=Gosford');
    });
  });
});

/**
 * A WebGL context naming its renderer, which is all the start probe reads
 * (mapStart.ts). Chrome says "WebKit WebGL" and gives the real name, if at
 * all, through its debug extension: `unmasked`, or no extension if omitted.
 */
function renderer(name: string, unmasked?: string) {
  const debug = { UNMASKED_RENDERER_WEBGL: 0x9246 };
  const gl = {
    RENDERER: 0x1f01,
    getParameter: (parameter: number) =>
      parameter === debug.UNMASKED_RENDERER_WEBGL ? unmasked : name,
    getExtension: (extension: string) =>
      extension === 'WEBGL_debug_renderer_info' && unmasked !== undefined ? debug : null,
  };
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

  it('not when a row is opened: reading a station never costs the software map’s freeze', async () => {
    renderer('Google SwiftShader');
    const { user } = setupWide();
    await list();
    await screen.findByRole('button', { name: 'Show the map' });
    await user.click(stationRow('Metro Gosford'));
    expect(open('Metro Gosford')).toBe(true);
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the map' })).toBeVisible();
    expect(stationRow('Metro Gosford')).toHaveFocus();
  });

  it('when asked in Chrome, whose debug extension names the software renderer', async () => {
    renderer('WebKit WebGL', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))');
    setupWide();
    await list();
    expect(await screen.findByRole('button', { name: 'Show the map' })).toBeVisible();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });

  // Round 11's table in docs/decisions.md: a hidden name counts as a GPU.
  it.each([
    ['Chrome without its debug extension', 'WebKit WebGL'],
    ['Firefox with fingerprinting protection', 'Mozilla'],
  ])('by itself where the renderer’s name is hidden: %s', async (_browser, name) => {
    renderer(name);
    setupWide();
    await list();
    expect(await screen.findByTestId('map')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show the map' })).not.toBeInTheDocument();
    expect(map.props?.focusOnStart).toBe(false);
  });

  it('as before where there is no WebGL at all, so the map can say so itself', async () => {
    setupWide();
    await list();
    expect(await screen.findByTestId('map')).toBeVisible();
  });
});
