import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prices, station } from '@/lib/testing/fakeApi';

import { StationMap, type StationMapProps } from './StationMap';

/*
 * MapLibre needs WebGL, which jsdom does not have, so it is replaced by a
 * recorder: what the component asked the map to do is what is tested. How
 * it looks is checked in a real browser (scripts/smoke-check.mjs).
 */
type Handler = (event: { point: { x: number; y: number }; error?: unknown }) => void;

const { FakeMap, maps } = vi.hoisted(() => {
  const maps: InstanceType<typeof FakeMap>[] = [];
  class FakeMap {
    options: Record<string, unknown>;
    handlers = new Map<string, Handler>();
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    layers: { id: string; layout?: Record<string, unknown> }[] = [];
    images = new Set<string>();
    /** OpenFreeMap's own layers, a few of each kind, as the restyle sees them. */
    basemap = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'park', type: 'fill', 'source-layer': 'park' },
      { id: 'highway_motorway_casing', type: 'line', 'source-layer': 'transportation' },
      { id: 'highway_motorway_inner', type: 'line', 'source-layer': 'transportation' },
      { id: 'highway_minor', type: 'line', 'source-layer': 'transportation' },
      { id: 'building', type: 'fill', 'source-layer': 'building' },
      { id: 'poi_r1', type: 'symbol', 'source-layer': 'poi' },
      { id: 'place_city', type: 'symbol', 'source-layer': 'place' },
    ];
    paint = new Map<string, unknown>();
    hidden = new Set<string>();
    filters = new Map<string, unknown>();
    canvas: HTMLCanvasElement = document.createElement('canvas');
    zoom = 11;
    /** What queryRenderedFeatures finds, as the test arranges it. */
    rendered: { code: string; lng: number; lat: number }[] = [];
    easeTo = vi.fn();
    resize = vi.fn();
    fitBounds = vi.fn();
    remove = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    setStyle = vi.fn(() => {
      // A new style replaces every source, layer and image, ours included.
      this.sources.clear();
      this.layers = [];
      this.images.clear();
    });
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      // As MapLibre does: the canvas goes in the container, in the Tab order.
      this.canvas.tabIndex = 0;
      (options.container as HTMLElement).append(this.canvas);
      maps.push(this);
    }
    addControl() {
      return this;
    }
    on(type: string, handler: Handler) {
      this.handlers.set(type, handler);
      return this;
    }
    addSource(id: string) {
      this.sources.set(id, { setData: vi.fn(() => Promise.resolve()) });
    }
    addLayer(layer: { id: string }) {
      this.layers.push(layer);
    }
    hasImage(id: string) {
      return this.images.has(id);
    }
    addImage(id: string) {
      this.images.add(id);
    }
    removeImage(id: string) {
      this.images.delete(id);
    }
    getStyle() {
      return { layers: this.basemap };
    }
    setPaintProperty(id: string, property: string, value: unknown) {
      this.paint.set(`${id} ${property}`, value);
    }
    setLayoutProperty(id: string, property: string, value: unknown) {
      if (property === 'visibility' && value === 'none') this.hidden.add(id);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    setFilter(id: string, filter: unknown) {
      this.filters.set(id, filter);
    }
    getCanvas() {
      return this.canvas;
    }
    getContainer() {
      return this.canvas;
    }
    getZoom() {
      return this.zoom;
    }
    // Pixels are degrees x 1000, so a test can place a click near a station.
    project([lng, lat]: [number, number]) {
      return { x: lng * 1000, y: lat * 1000 };
    }
    queryRenderedFeatures() {
      return this.rendered.map(({ code, lng, lat }) => ({
        properties: { code },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      }));
    }
  }
  return { FakeMap, maps };
});

/** Fires a map event, as MapLibre would. */
function fire(map: InstanceType<typeof FakeMap>, type: string, point = { x: 0, y: 0 }) {
  act(() => {
    map.handlers.get(type)?.({ point });
  });
}

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  setWorkerUrl: vi.fn(),
}));

const STATIONS = [
  station({ stationCode: 'a', name: 'Cheap', priceCents: 210, latitude: -33.4, longitude: 151.3 }),
  station({ stationCode: 'b', name: 'Dear', priceCents: 250, latitude: -33.5, longitude: 151.4 }),
];

function setup(overrides: Partial<StationMapProps> = {}) {
  maps.length = 0;
  const onPick = vi.fn();
  const onClear = vi.fn();
  const props: StationMapProps = {
    stations: STATIONS,
    origin: prices().origin,
    selected: null,
    showRequest: 0,
    onPick,
    onClear,
    label: 'Map of 2 stations',
    reducedMotion: false,
    theme: 'light',
    ...overrides,
  };
  const view = render(<StationMap {...props} />);
  const map = maps.at(-1);
  if (!map) throw new Error('no map was created');
  const rerender = (next: Partial<StationMapProps>) => {
    Object.assign(props, next);
    view.rerender(<StationMap {...props} />);
  };
  return { map, onPick, onClear, rerender, unmount: view.unmount };
}

/** Runs the timers a tap on nothing waits on (CLEAR_DELAY), and more. */
function waitOut() {
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

describe('StationMap', () => {
  it('opens on OpenFreeMap, fitted to the results, with attribution shown uncollapsed', () => {
    const { map } = setup();
    expect(map.options).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: [
        [151.3, -33.5],
        [151.4, -33.4],
      ],
      attributionControl: { compact: false },
      locale: { 'Map.Title': 'Map of 2 stations' },
    });
  });

  it('draws the stations and the origin once the style has loaded', () => {
    const { map } = setup();
    fire(map, 'style.load');
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'selected-dot',
      'station-labels',
      'cheapest-label',
      'selected-label',
      'station-dots',
      'origin-ring',
      'origin-dot',
      'station-dot-space',
    ]);
    const data = map.sources.get('stations')?.setData.mock.lastCall?.[0] as {
      features: { properties: { code: string; band: string } }[];
    };
    expect(data.features.map((f) => [f.properties.code, f.properties.band])).toEqual([
      ['a', 'low'],
      ['b', 'mid'],
    ]);
  });

  it('redraws the basemap in the tokens’ colours, without what a fuel map does not need', () => {
    const { map } = setup();
    fire(map, 'style.load');
    // jsdom computes no custom properties, so every colour reads as '': what
    // is checked is that each layer was given the right kind of colour.
    expect([...map.paint.keys()]).toEqual(
      expect.arrayContaining([
        'background background-color',
        'water fill-color',
        'water fill-outline-color',
        'park fill-color',
        'highway_motorway_casing line-color',
        'highway_motorway_inner line-color',
        'highway_minor line-color',
        'place_city text-color',
        'place_city text-halo-color',
      ]),
    );
    expect([...map.hidden].sort()).toEqual(['building', 'poi_r1']);
    // Our price tags: plain, cheapest and selected.
    expect([...map.images]).toEqual(
      expect.arrayContaining(['tag', 'tag-cheapest', 'tag-selected']),
    );
  });

  it('a click near a dot picks that station, and does not pan to it', () => {
    const { map, onPick, rerender } = setup();
    fire(map, 'style.load');
    map.rendered = [
      { code: 'a', lng: 0.1, lat: 0.1 },
      { code: 'b', lng: 0.005, lat: 0.005 },
    ];
    fire(map, 'click', { x: 4, y: 4 });
    expect(onPick).toHaveBeenCalledWith('b');

    rerender({ selected: 'b' });
    expect(map.filters.get('selected-dot')).toEqual(['==', ['get', 'code'], 'b']);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('a click away from every dot picks nothing', () => {
    const { map, onPick } = setup();
    fire(map, 'style.load');
    fire(map, 'click');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('never draws a price or the selected marker over a station’s dot', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    const ids = map.layers.map((layer) => layer.id);
    const dots = ids.indexOf('station-dots');
    for (const below of ['selected-dot', 'station-labels', 'cheapest-label', 'selected-label']) {
      expect(ids.indexOf(below)).toBeLessThan(dots);
    }
    // Every dot is in the way of every price: the top layer, placed first,
    // always placed, and never ignored by the prices placed after it.
    const space = map.layers.at(-1);
    expect(space?.id).toBe('station-dot-space');
    expect(space?.layout).toMatchObject({
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
    });
    expect(map.images.has('dot-space')).toBe(true);

    // The selected station's marker replaces its own dot, under the others.
    rerender({ selected: 'a' });
    expect(map.filters.get('station-dots')).toEqual(['!=', ['get', 'code'], 'a']);
  });

  it('always shows the cheapest price, at any zoom, before the others and never dropped', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    const ids = map.layers.map((layer) => layer.id);
    // Higher layers are placed first: the cheapest before the ordinary prices,
    // after only the selected one.
    expect(ids.indexOf('cheapest-label')).toBeGreaterThan(ids.indexOf('station-labels'));
    expect(ids.indexOf('cheapest-label')).toBeLessThan(ids.indexOf('selected-label'));
    const cheapest = map.layers.find((layer) => layer.id === 'cheapest-label');
    // Never dropped: it may overlap as a last resort, after trying eight places.
    expect(cheapest?.layout).toMatchObject({
      'text-allow-overlap': true,
      'icon-image': 'tag-cheapest',
    });
    expect(cheapest?.layout?.['text-variable-anchor']).toHaveLength(8);
    // The ordinary prices leave it out; it shows only the cheapest (not if selected).
    rerender({ selected: 'b' });
    expect(map.filters.get('cheapest-label')).toEqual([
      'all',
      ['!', ['in', ['get', 'code'], ['literal', ['b']]]],
      ['get', 'cheapest'],
    ]);
    expect(map.filters.get('station-labels')).toEqual([
      'all',
      ['!', ['in', ['get', 'code'], ['literal', ['b']]]],
      ['!', ['get', 'cheapest']],
    ]);
  });

  describe('a tap on the map away from every dot', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears the selection, once it is clearly not a double-tap', () => {
      const { map, onClear } = setup({ selected: 'a' });
      fire(map, 'style.load');
      fire(map, 'mousedown');
      fire(map, 'click');
      expect(onClear).not.toHaveBeenCalled();
      waitOut();
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('does nothing when nothing is selected', () => {
      const { map, onClear } = setup();
      fire(map, 'style.load');
      fire(map, 'click');
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    /*
     * MapLibre fires no `click` for a drag (the press moved 3 px or more) and
     * the browser none after a touch that moved or used two fingers; these
     * are the events a drag and a pinch do produce.
     */
    it('a drag does not clear it', () => {
      const { map, onClear } = setup({ selected: 'a' });
      fire(map, 'style.load');
      for (const type of ['mousedown', 'movestart', 'move', 'moveend', 'mouseup']) {
        fire(map, type, { x: 40, y: 40 });
      }
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('a pinch does not clear it', () => {
      const { map, onClear } = setup({ selected: 'a' });
      fire(map, 'style.load');
      for (const type of ['touchstart', 'touchstart', 'movestart', 'move', 'moveend']) {
        fire(map, type);
      }
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('a double-click, which zooms, does not clear it', () => {
      const { map, onClear } = setup({ selected: 'a' });
      fire(map, 'style.load');
      for (const type of ['mousedown', 'click', 'mousedown', 'click', 'dblclick', 'movestart']) {
        fire(map, type);
      }
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('a double-tap on a phone, which zooms, does not clear it', () => {
      const { map, onClear } = setup({ selected: 'a' });
      fire(map, 'style.load');
      // The first tap is a click; the second is cancelled by MapLibre, which zooms.
      for (const type of ['touchstart', 'mousedown', 'click', 'touchstart', 'movestart']) {
        fire(map, type);
      }
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('does not undo a station chosen in the list meanwhile', () => {
      const { map, onClear, rerender } = setup({ selected: 'a' });
      fire(map, 'style.load');
      fire(map, 'click');
      rerender({ selected: 'b', showRequest: 1 });
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('is forgotten when the map goes away', () => {
      const { map, onClear, unmount } = setup({ selected: 'a' });
      fire(map, 'style.load');
      fire(map, 'click');
      unmount();
      waitOut();
      expect(onClear).not.toHaveBeenCalled();
    });
  });

  it('zooms with its own 44 px buttons, named, with tooltips, once the map has drawn', async () => {
    const user = userEvent.setup();
    const { map } = setup({ reducedMotion: true });
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    fire(map, 'style.load');
    fire(map, 'load');
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    expect(zoomIn).toHaveAttribute('title', 'Zoom in');
    expect(zoomIn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(zoomIn);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(map.zoomIn).toHaveBeenCalledWith({ animate: false });
    expect(map.zoomOut).toHaveBeenCalledWith({ animate: false });
  });

  it('one price tag by the selected station: a neighbour at the same price a street away gives its price up, not its dot', () => {
    const twin = station({
      stationCode: 'c',
      name: 'Twin',
      priceCents: 250,
      latitude: -33.5008,
      longitude: 151.4005,
    });
    const { map, rerender } = setup({ stations: [...STATIONS, twin] });
    fire(map, 'style.load');
    rerender({ selected: 'b' });
    expect(map.filters.get('station-labels')).toEqual([
      'all',
      ['!', ['in', ['get', 'code'], ['literal', ['b', 'c']]]],
      ['!', ['get', 'cheapest']],
    ]);
    expect(map.filters.get('station-dots')).toEqual(['!=', ['get', 'code'], 'b']);
  });

  it('a station selected from the list is highlighted and panned to, at street zoom', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    rerender({ selected: 'a', showRequest: 1 });
    expect(map.filters.get('selected-label')).toEqual(['==', ['get', 'code'], 'a']);
    expect(map.filters.get('station-labels')).toEqual([
      'all',
      ['!', ['in', ['get', 'code'], ['literal', ['a']]]],
      ['!', ['get', 'cheapest']],
    ]);
    // Its own ordinary dot goes (the marker replaces it); every other dot stays.
    expect(map.filters.get('station-dots')).toEqual(['!=', ['get', 'code'], 'a']);
    // The card has just changed the map's height: resize before working out the pan.
    expect(map.resize.mock.invocationCallOrder[0]).toBeLessThan(
      map.easeTo.mock.invocationCallOrder[0] ?? 0,
    );
    expect(map.easeTo).toHaveBeenCalledWith({
      center: [151.3, -33.4],
      zoom: 14,
      duration: 500,
      offset: [0, 0],
    });
  });

  it('showing the same station again pans back to it; a data refresh does not', () => {
    const { map, rerender } = setup({ selected: 'a', showRequest: 1 });
    fire(map, 'style.load');
    expect(map.easeTo).toHaveBeenCalledTimes(1);

    rerender({ stations: [...STATIONS] });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).not.toHaveBeenCalled();

    rerender({ showRequest: 2 });
    expect(map.easeTo).toHaveBeenCalledTimes(2);
  });

  it('centres a station in the part of the map that is on screen', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    // A wide screen at the top of the page: the map's lower half is below the window.
    vi.spyOn(map.canvas, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: window.innerHeight / 2, width: 600, height: window.innerHeight }),
    );
    rerender({ selected: 'a', showRequest: 1 });
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ offset: [0, -window.innerHeight / 4] }),
    );
  });

  it('jumps instead of gliding when the user prefers reduced motion', () => {
    const { map, rerender } = setup({ reducedMotion: true });
    fire(map, 'style.load');
    rerender({ selected: 'b', showRequest: 1 });
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });

  it('refits to a new search', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    rerender({ stations: [STATIONS[0] ?? station()] });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('keeps the canvas’s accessible name current, and removes the map on unmount', () => {
    const { map, rerender, unmount } = setup();
    rerender({ label: 'Map of 1 station' });
    expect(map.canvas).toHaveAttribute('aria-label', 'Map of 1 station');
    unmount();
    expect(map.remove).toHaveBeenCalled();
  });
  it('takes focus when it was started by "Show the map", and only then', () => {
    expect(setup({ focusOnStart: true }).map.canvas).toHaveFocus();
    cleanup();
    expect(setup().map.canvas).not.toHaveFocus();
  });

  it('leaves focus alone if the visitor moved it while the map downloaded', () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    setup({ focusOnStart: true });
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it('opens on the dark basemap when the page is dark', () => {
    const { map } = setup({ theme: 'dark' });
    expect(map.options.style).toBe('https://tiles.openfreemap.org/styles/dark');
  });

  it('swaps the basemap when the theme changes, then draws everything again', () => {
    const { map, rerender } = setup({ selected: 'a' });
    fire(map, 'style.load');

    rerender({ theme: 'dark' });
    // A diff would keep the basemap's layers and drop ours without a word.
    expect(map.setStyle).toHaveBeenCalledWith('https://tiles.openfreemap.org/styles/dark', {
      diff: false,
    });
    expect(map.layers).toEqual([]);

    // Until the new style has loaded there is nothing to draw on.
    rerender({ stations: [...STATIONS] });
    expect(map.sources.size).toBe(0);

    fire(map, 'style.load');
    expect(map.layers.map((layer) => layer.id)).toContain('station-dots');
    expect(map.sources.get('stations')?.setData).toHaveBeenCalled();
    expect(map.filters.get('selected-dot')).toEqual(['==', ['get', 'code'], 'a']);
    // Same search, same view: no refit and no pan.
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });

  it('does not reload the style when the theme has not changed', () => {
    const { map, rerender } = setup();
    fire(map, 'style.load');
    rerender({ label: 'Map of 2 stations, again' });
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('says it is loading until the first complete render, instead of a blank box', () => {
    const { map } = setup();
    expect(screen.getByText('Loading map…')).toBeInTheDocument();
    fire(map, 'style.load');
    expect(screen.getByText('Loading map…')).toBeInTheDocument();
    fire(map, 'load');
    expect(screen.queryByText('Loading map…')).not.toBeInTheDocument();
  });

  it('says so if the map fails before it loads, and stops saying so if it loads after all', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { map } = setup();
    fire(map, 'error');
    expect(screen.getByText('The map couldn’t load. Every station is in the list.')).toBeVisible();
    fire(map, 'load');
    expect(screen.queryByText(/The map couldn’t load/)).not.toBeInTheDocument();
    // A later tile error on a working map changes nothing.
    fire(map, 'error');
    expect(screen.queryByText(/The map couldn’t load/)).not.toBeInTheDocument();
  });
});
