import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { Theme } from '@/features/theme/theme';

import { boundsOf, toFeatures } from './mapData';
import { addLayers, LAYER, SOURCE, tokenColours } from './mapLayers';
import { MAPLIBRE_WORKER_URL, mapStyleUrl } from './mapStyle';
import styles from './StationMap.module.css';

import type { PricesResponse, StationPrice } from '../../../shared/api';

/*
 * This module is only ever loaded through LazyStationMap: MapLibre is ~430 kB
 * gzipped (library and worker), more than the rest of the app together, and
 * someone who never opens the map should never download it.
 */

// See mapStyle.ts: Vite emits the worker somewhere MapLibre would not look.
setWorkerUrl(MAPLIBRE_WORKER_URL);

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
/**
 * A tap on the map away from every station clears the selection, but not at
 * once: the first tap of a double-tap (or click of a double-click) is a click
 * too, and that gesture is a zoom. So clearing waits this long, and the next
 * press, a double-click or any camera move cancels it. A drag or a pinch is
 * never a click in the first place (MapLibre fires `click` only for a press
 * released within 3 px of where it started; browsers fire none after a
 * touch moves or uses two fingers).
 */
const CLEAR_DELAY = 300;

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
  /** A tap or click on the map away from every station, while one is selected. */
  onClear: () => void;
  /** The canvas's accessible name. */
  label: string;
  reducedMotion: boolean;
  /** Light or dark basemap, to match the page. */
  theme: Theme;
  /**
   * The visitor pressed "Show the map", which went away: focus the map once
   * it exists, unless focus has meanwhile moved somewhere else.
   */
  focusOnStart?: boolean;
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

type Loading = 'loading' | 'loaded' | 'failed';

/**
 * The results on a map. Pointer and touch only for the stations themselves:
 * keyboard and screen reader users get the same stations, in price order,
 * from the list, whose "Show on map" buttons drive this map. The canvas
 * itself is one Tab stop (arrow keys pan, + and - zoom), with zoom buttons.
 * A tap away from every station clears the selection; so does Escape, in
 * StationsPanel.
 */
export function StationMap({
  stations,
  origin,
  selected,
  showRequest,
  onPick,
  onClear,
  label,
  reducedMotion,
  theme,
  focusOnStart = false,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /**
   * Bumped each time our layers are (re)added. Zero until the first style
   * has loaded. A theme change replaces the style, and with it our layers,
   * so `layersReady` is false from then until the new style has loaded.
   */
  const [styleGeneration, setStyleGeneration] = useState(0);
  const layersReady = useRef(false);
  const [loading, setLoading] = useState<Loading>('loading');
  /** A station picked on the map itself: already in view, so selecting it must not pan. */
  const pickedHere = useRef<string | null>(null);

  const pick = useEffectEvent((code: string) => {
    // Picking the station that is already selected changes nothing, so there
    // will be no selection change to swallow.
    if (code === selected) return;
    pickedHere.current = code;
    onPick(code);
  });
  const selectedNow = useEffectEvent(() => selected);
  const clear = useEffectEvent((code: string) => {
    // Only if the tapped-away station is still the selected one: a station
    // chosen in the list meanwhile is not undone.
    if (code === selected) onClear();
  });
  const initialView = useEffectEvent(() => ({
    bounds: boundsOf(stations, origin),
    label,
    theme,
    focus: focusOnStart,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = initialView();
    // Throws without WebGL; MapErrorBoundary catches it and says so.
    const map = new MapLibreMap({
      container,
      style: mapStyleUrl(initial.theme),
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
    // The placeholder that held focus has just been replaced, leaving it on
    // <body>. The map only exists from this effect on, so the move cannot be
    // in a layout effect; it is safe here because it only ever takes focus
    // from nowhere. Anywhere else, the visitor has moved on: leave it.
    const active = document.activeElement;
    if (initial.focus && (active === null || active === document.body)) {
      // eslint-disable-next-line no-restricted-syntax
      map.getCanvas().focus({ preventScroll: true });
    }
    // Fired for the first style and again after every theme change.
    map.on('style.load', () => {
      addLayers(map, tokenColours(container));
      layersReady.current = true;
      setStyleGeneration((n) => n + 1);
    });
    // The first complete render: style, tiles and fonts. Until then the
    // placeholder covers a canvas that would otherwise sit blank.
    map.on('load', () => {
      setLoading('loaded');
    });
    // Before the first render, an error is most likely the style or the
    // tiles failing to download. If the map does load after all, 'load'
    // replaces this message.
    map.on('error', (event: { error?: unknown }) => {
      console.warn('Map error', event.error);
      setLoading((state) => (state === 'loaded' ? state : 'failed'));
    });
    let pendingClear: ReturnType<typeof setTimeout> | undefined;
    const cancelClear = () => {
      clearTimeout(pendingClear);
    };
    map.on('click', (event) => {
      cancelClear();
      const code = stationAt(map, event);
      if (code) {
        pick(code);
        return;
      }
      const shown = selectedNow();
      if (shown !== null) {
        pendingClear = setTimeout(() => {
          clear(shown);
        }, CLEAR_DELAY);
      }
    });
    // A second press (touchstart on a phone, mousedown with a mouse), a
    // double-click or the map starting to move: that tap was part of a zoom
    // or a pan, not a tap on nothing.
    for (const type of ['mousedown', 'touchstart', 'dblclick', 'movestart'] as const) {
      map.on(type, cancelClear);
    }
    map.on('mousemove', (event) => {
      map.getCanvas().style.cursor = stationAt(map, event) ? 'pointer' : '';
    });
    mapRef.current = map;
    return () => {
      cancelClear();
      mapRef.current = null;
      layersReady.current = false;
      map.remove();
    };
  }, []);

  useEffect(() => {
    mapRef.current?.getCanvas().setAttribute('aria-label', label);
  }, [label]);

  /*
   * The page changed theme: swap the basemap. `diff: false` because a diff
   * between the two styles would quietly drop our own layers and fire no
   * `style.load` to add them back.
   */
  const shownTheme = useRef(theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownTheme.current === theme) return;
    shownTheme.current = theme;
    layersReady.current = false;
    map.setStyle(mapStyleUrl(theme), { diff: false });
  }, [theme]);

  // New data: redraw. A new search (a different origin or station count, not
  // the minutely refresh of the same one): fit it.
  const fitKey = `${String(origin.latitude)},${String(origin.longitude)},${String(stations.length)}`;
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady.current) return;
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
  }, [styleGeneration, stations, origin, fitKey, reducedMotion]);

  // Selection: highlight, and pan to it unless it was picked right here.
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady.current) return;
    const filter: ExpressionSpecification = ['==', ['get', 'code'], selected ?? ''];
    map.setFilter(LAYER.selectedDot, filter);
    map.setFilter(LAYER.selectedLabel, filter);
    // Its ordinary label would repeat the price beside the bold one, and its
    // ordinary dot would draw a second ring inside its marker.
    const others: ExpressionSpecification = ['!=', ['get', 'code'], selected ?? ''];
    map.setFilter(LAYER.labels, others);
    map.setFilter(LAYER.dots, others);

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
  }, [styleGeneration, selected, showRequest, stations, reducedMotion]);

  return (
    <div className={styles.frame}>
      <div ref={containerRef} className={styles.map} />
      {loading !== 'loaded' && (
        <p className={styles.loading}>
          {loading === 'loading'
            ? 'Loading map…'
            : 'The map couldn’t load. Every station is in the list.'}
        </p>
      )}
    </div>
  );
}
