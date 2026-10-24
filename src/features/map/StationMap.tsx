import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { boundsOf, toFeatures } from './mapData';
import styles from './StationMap.module.css';

import type { PricesResponse, StationPrice } from '../../../shared/api';

/*
 * This module is only ever loaded through LazyStationMap: MapLibre is ~430 kB
 * gzipped (library and worker), more than the rest of the app together, and
 * someone who never opens the map should never download it.
 */

/*
 * MapLibre finds its worker next to its own file, which is not where Vite
 * puts it. `?url` makes Vite emit the (self-contained) worker as a hashed
 * asset and hands us its address.
 */
setWorkerUrl(workerUrl);

/**
 * OpenFreeMap: no key, no account, no request limit, OpenStreetMap data, and a
 * dark style for Phase 3. Attribution comes from the style and is shown
 * uncollapsed in the map corner. See docs/decisions.md, "Map tiles".
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Fitting results never zooms in further than this (a single station would otherwise fill the screen). */
const MAX_FIT_ZOOM = 14;
/** Showing a station zooms in at least this far, so its street is readable. */
const SHOW_ZOOM = 14;
/**
 * A tap within this many pixels of a dot picks it: a 24 px target or more
 * around a 12 px dot (WCAG 2.5.8).
 */
const PICK_RADIUS = 12;
const FIT_PADDING = 48;

const SOURCE = { stations: 'stations', origin: 'origin' } as const;
const LAYER = {
  origin: 'origin',
  dots: 'station-dots',
  labels: 'station-labels',
  selectedDot: 'selected-dot',
  selectedLabel: 'selected-label',
} as const;

export interface StationMapProps {
  stations: StationPrice[];
  origin: PricesResponse['origin'];
  /** The selected station's code. */
  selected: string | null;
  /**
   * Bumped each time the list asks to show the selected station, so showing
   * the same station again pans back to it after the user has moved away.
   */
  showRequest: number;
  onPick: (code: string) => void;
  /** The canvas's accessible name. */
  label: string;
  reducedMotion: boolean;
}

/** Marker colours from the design tokens: the map draws on a canvas, out of CSS's reach. */
function tokenColours(element: Element) {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    low: token('--color-price-low'),
    mid: token('--color-price-mid'),
    high: token('--color-price-high'),
    outline: token('--color-marker-outline'),
    selected: token('--color-marker-selected'),
    origin: token('--color-map-origin'),
    text: token('--color-text'),
    halo: token('--color-surface'),
  };
}

function addLayers(map: MapLibreMap, colours: ReturnType<typeof tokenColours>): void {
  const empty = { type: 'FeatureCollection' as const, features: [] };
  map.addSource(SOURCE.origin, { type: 'geojson', data: empty });
  map.addSource(SOURCE.stations, { type: 'geojson', data: empty });

  const bandColour: ExpressionSpecification = [
    'match',
    ['get', 'band'],
    'low',
    colours.low,
    'mid',
    colours.mid,
    colours.high,
  ];
  const isSelected = (code: string | null): ExpressionSpecification => [
    '==',
    ['get', 'code'],
    code ?? '',
  ];

  map.addLayer({
    id: LAYER.dots,
    type: 'circle',
    source: SOURCE.stations,
    paint: {
      'circle-radius': 6,
      'circle-color': bandColour,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': colours.outline,
    },
  });
  /*
   * Prices beside the dots. MapLibre drops a label that would overlap
   * another, and symbol-sort-key decides which one wins: the cheaper. So a
   * dense 25 km search in Sydney shows every dot and the cheapest prices,
   * and zooming in reveals the rest. No clustering: a cluster would hide
   * exactly the prices people came for.
   */
  map.addLayer({
    id: LAYER.labels,
    type: 'symbol',
    source: SOURCE.stations,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 0.7,
      'text-padding': 2,
      'symbol-sort-key': ['get', 'priority'],
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
  });
  // The search origin: a hollow ring above the dots, so it is never buried in
  // a dense area and never reads as a station.
  map.addLayer({
    id: LAYER.origin,
    type: 'circle',
    source: SOURCE.origin,
    paint: {
      'circle-radius': 9,
      'circle-opacity': 0,
      'circle-stroke-width': 3,
      'circle-stroke-color': colours.origin,
    },
  });
  map.addLayer({
    id: LAYER.selectedDot,
    type: 'circle',
    source: SOURCE.stations,
    filter: isSelected(null),
    paint: {
      'circle-radius': 9,
      'circle-color': bandColour,
      'circle-stroke-width': 3,
      'circle-stroke-color': colours.selected,
    },
  });
  // Placed before the other labels (higher layers are placed first), so the
  // selected price is always shown and the others make way for it.
  map.addLayer({
    id: LAYER.selectedLabel,
    type: 'symbol',
    source: SOURCE.stations,
    filter: isSelected(null),
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 15,
      'text-anchor': 'left',
      'text-offset': [1, 0],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 2 },
  });
}

/**
 * Where the centre of the visible part of the map is, relative to its true
 * centre, so a station is shown where it can be seen. On a wide screen at the
 * top of the page the map starts half way down the window, and its true
 * centre is at the bottom edge. An `offset`, not `padding`: MapLibre keeps
 * padding for every later camera move, offset applies to this one only.
 */
function visibleCentreOffset(container: HTMLElement): [number, number] {
  const rect = container.getBoundingClientRect();
  const limit = rect.height / 4;
  const hiddenTop = Math.max(0, -rect.top);
  const hiddenBottom = Math.max(0, rect.bottom - window.innerHeight);
  const y = Math.max(-limit, Math.min(limit, (hiddenTop - hiddenBottom) / 2));
  return [0, y];
}

/** The station dot nearest to a click, within PICK_RADIUS. */
function stationAt(map: MapLibreMap, event: MapMouseEvent): string | null {
  const { x, y } = event.point;
  const features = map.queryRenderedFeatures(
    [
      [x - PICK_RADIUS, y - PICK_RADIUS],
      [x + PICK_RADIUS, y + PICK_RADIUS],
    ],
    { layers: [LAYER.dots] },
  );
  let best: { code: string; distance: number } | null = null;
  for (const feature of features) {
    const code: unknown = feature.properties.code;
    if (feature.geometry.type !== 'Point' || typeof code !== 'string') continue;
    const [lng = 0, lat = 0] = feature.geometry.coordinates;
    const point = map.project([lng, lat]);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance) best = { code, distance };
  }
  return best?.code ?? null;
}

/**
 * The results on a map. Pointer and touch only for the stations themselves:
 * keyboard and screen reader users get the same stations, in price order,
 * from the list, whose "Show on map" buttons drive this map. The canvas
 * itself is one Tab stop (arrow keys pan, + and - zoom), with zoom buttons.
 */
export function StationMap({
  stations,
  origin,
  selected,
  showRequest,
  onPick,
  label,
  reducedMotion,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  /** A station picked on the map itself: already in view, so selecting it must not pan. */
  const pickedHere = useRef<string | null>(null);

  const pick = useEffectEvent((code: string) => {
    // Picking the station that is already selected changes nothing, so there
    // will be no selection change to swallow.
    if (code === selected) return;
    pickedHere.current = code;
    onPick(code);
  });
  const initialView = useEffectEvent(() => ({ bounds: boundsOf(stations, origin), label }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = initialView();
    // Throws without WebGL; MapErrorBoundary catches it and says so.
    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      bounds: initial.bounds,
      fitBoundsOptions: { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM },
      attributionControl: { compact: false },
      locale: { 'Map.Title': initial.label },
      // A fuel map has no use for tilting or turning; both only disorient.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      addLayers(map, tokenColours(container));
      setReady(true);
    });
    map.on('click', (event) => {
      const code = stationAt(map, event);
      if (code) pick(code);
    });
    map.on('mousemove', (event) => {
      map.getCanvas().style.cursor = stationAt(map, event) ? 'pointer' : '';
    });
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    mapRef.current?.getCanvas().setAttribute('aria-label', label);
  }, [label]);

  // New data: redraw. A new search (a different origin or station count, not
  // the minutely refresh of the same one): fit it.
  const fitKey = `${String(origin.latitude)},${String(origin.longitude)},${String(stations.length)}`;
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void map.getSource<GeoJSONSource>(SOURCE.stations)?.setData(toFeatures(stations));
    void map.getSource<GeoJSONSource>(SOURCE.origin)?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [origin.longitude, origin.latitude] },
    });
    if (lastFit.current !== null && lastFit.current !== fitKey) {
      map.fitBounds(boundsOf(stations, origin), {
        padding: FIT_PADDING,
        maxZoom: MAX_FIT_ZOOM,
        duration: reducedMotion ? 0 : 600,
      });
    }
    lastFit.current = fitKey;
  }, [ready, stations, origin, fitKey, reducedMotion]);

  // Selection: highlight, and pan to it unless it was picked right here.
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const filter: ExpressionSpecification = ['==', ['get', 'code'], selected ?? ''];
    map.setFilter(LAYER.selectedDot, filter);
    map.setFilter(LAYER.selectedLabel, filter);
    // Its ordinary label would repeat the price beside the bold one.
    map.setFilter(LAYER.labels, ['!=', ['get', 'code'], selected ?? '']);

    const key = `${selected ?? ''}:${String(showRequest)}`;
    if (key === lastShown.current) return;
    lastShown.current = key;
    if (selected !== null && selected === pickedHere.current) {
      pickedHere.current = null;
      return;
    }
    const station = stations.find((s) => s.stationCode === selected);
    if (!station) return;
    // The card under the map appears in the same render as the selection,
    // so the container has just changed height. MapLibre's ResizeObserver
    // would only catch up after this pan has been worked out for the old
    // size, leaving the station off centre; resize now instead.
    map.resize();
    map.easeTo({
      center: [station.longitude, station.latitude],
      zoom: Math.max(map.getZoom(), SHOW_ZOOM),
      duration: reducedMotion ? 0 : 500,
      offset: visibleCentreOffset(map.getContainer()),
    });
  }, [ready, selected, showRequest, stations, reducedMotion]);

  return <div ref={containerRef} className={styles.map} />;
}
