import { LABEL_FONT } from './mapStyle';

import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';

/*
 * Our sources and layers on top of the basemap. Added on every `style.load`:
 * switching between the light and dark basemaps replaces the whole style,
 * ours included, so they are added again in the new theme's colours.
 */

export const SOURCE = { stations: 'stations', origin: 'origin' } as const;
export const LAYER = {
  originRing: 'origin-ring',
  originDot: 'origin-dot',
  dots: 'station-dots',
  labels: 'station-labels',
  selectedDot: 'selected-dot',
  selectedLabel: 'selected-label',
} as const;

/** Marker colours from the design tokens: the map draws on a canvas, out of CSS's reach. */
export function tokenColours(element: Element) {
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

export type MarkerColours = ReturnType<typeof tokenColours>;

export function addLayers(map: MapLibreMap, colours: MarkerColours): void {
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
  const nothingSelected: ExpressionSpecification = ['==', ['get', 'code'], ''];

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
   * exactly the prices people came for. The cheapest say "Cheapest" in words,
   * so the colour is never the only way to tell.
   */
  map.addLayer({
    id: LAYER.labels,
    type: 'symbol',
    source: SOURCE.stations,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [LABEL_FONT],
      'text-size': 12,
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 0.7,
      'text-padding': 2,
      'symbol-sort-key': ['get', 'priority'],
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
  });
  /*
   * The search origin: a ring around a dot, above the stations, so it is
   * never buried in a dense area. Its shape, not its colour, sets it apart
   * from a station (a filled dot) and the selected station (a bigger filled
   * dot with a heavy edge).
   */
  map.addLayer({
    id: LAYER.originRing,
    type: 'circle',
    source: SOURCE.origin,
    paint: {
      'circle-radius': 10,
      'circle-opacity': 0,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': colours.origin,
    },
  });
  map.addLayer({
    id: LAYER.originDot,
    type: 'circle',
    source: SOURCE.origin,
    paint: {
      'circle-radius': 3.5,
      'circle-color': colours.origin,
    },
  });
  map.addLayer({
    id: LAYER.selectedDot,
    type: 'circle',
    source: SOURCE.stations,
    filter: nothingSelected,
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
    filter: nothingSelected,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [LABEL_FONT],
      'text-size': 15,
      'text-anchor': 'left',
      'text-offset': [1, 0],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 2 },
  });
}
