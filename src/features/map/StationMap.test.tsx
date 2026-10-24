import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { prices, station } from '@/lib/testing/fakeApi';

import { StationMap, type StationMapProps } from './StationMap';

/*
 * MapLibre needs WebGL, which jsdom does not have, so it is replaced by a
 * recorder: what the component asked the map to do is what is tested. How
 * it looks is checked in a real browser (scripts/smoke-check.mjs).
 */
type Handler = (event: { point: { x: number; y: number } }) => void;

const { FakeMap, maps } = vi.hoisted(() => {
  const maps: InstanceType<typeof FakeMap>[] = [];
  class FakeMap {
    options: Record<string, unknown>;
    handlers = new Map<string, Handler>();
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    layers: { id: string }[] = [];
    filters = new Map<string, unknown>();
    canvas: HTMLCanvasElement = document.createElement('canvas');
    zoom = 11;
    /** What queryRenderedFeatures finds, as the test arranges it. */
    rendered: { code: string; lng: number; lat: number }[] = [];
    easeTo = vi.fn();
    resize = vi.fn();
    fitBounds = vi.fn();
    remove = vi.fn();
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };

    constructor(options: Record<string, unknown>) {
      this.options = options;
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
  NavigationControl: vi.fn(),
  setWorkerUrl: vi.fn(),
}));

const STATIONS = [
  station({ stationCode: 'a', name: 'Cheap', priceCents: 210, latitude: -33.4, longitude: 151.3 }),
  station({ stationCode: 'b', name: 'Dear', priceCents: 250, latitude: -33.5, longitude: 151.4 }),
];

function setup(overrides: Partial<StationMapProps> = {}) {
  maps.length = 0;
  const onPick = vi.fn();
  const props: StationMapProps = {
    stations: STATIONS,
    origin: prices().origin,
    selected: null,
    showRequest: 0,
    onPick,
    label: 'Map of 2 stations',
    reducedMotion: false,
    ...overrides,
  };
  const view = render(<StationMap {...props} />);
  const map = maps.at(-1);
  if (!map) throw new Error('no map was created');
  const rerender = (next: Partial<StationMapProps>) => {
    Object.assign(props, next);
    view.rerender(<StationMap {...props} />);
  };
  return { map, onPick, rerender, unmount: view.unmount };
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
    fire(map, 'load');
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'station-dots',
      'station-labels',
      'origin',
      'selected-dot',
      'selected-label',
    ]);
    const data = map.sources.get('stations')?.setData.mock.lastCall?.[0] as {
      features: { properties: { code: string; band: string } }[];
    };
    expect(data.features.map((f) => [f.properties.code, f.properties.band])).toEqual([
      ['a', 'low'],
      ['b', 'mid'],
    ]);
  });

  it('a click near a dot picks that station, and does not pan to it', () => {
    const { map, onPick, rerender } = setup();
    fire(map, 'load');
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
    fire(map, 'load');
    fire(map, 'click');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a station selected from the list is highlighted and panned to, at street zoom', () => {
    const { map, rerender } = setup();
    fire(map, 'load');
    rerender({ selected: 'a', showRequest: 1 });
    expect(map.filters.get('selected-label')).toEqual(['==', ['get', 'code'], 'a']);
    expect(map.filters.get('station-labels')).toEqual(['!=', ['get', 'code'], 'a']);
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
    fire(map, 'load');
    expect(map.easeTo).toHaveBeenCalledTimes(1);

    rerender({ stations: [...STATIONS] });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).not.toHaveBeenCalled();

    rerender({ showRequest: 2 });
    expect(map.easeTo).toHaveBeenCalledTimes(2);
  });

  it('centres a station in the part of the map that is on screen', () => {
    const { map, rerender } = setup();
    fire(map, 'load');
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
    fire(map, 'load');
    rerender({ selected: 'b', showRequest: 1 });
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });

  it('refits to a new search', () => {
    const { map, rerender } = setup();
    fire(map, 'load');
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
});
