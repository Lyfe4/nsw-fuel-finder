import { LABEL_FONT } from './mapStyle';

import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';

/*
 * Our sources and layers on top of the basemap. Added on every `style.load`:
 * switching between the light and dark basemaps replaces the whole style,
 * ours included, so they are added again in the new theme's colours.
 *
 * THE RULE: every station's dot is always drawn, and nothing is drawn over
 * it but the search origin. Prices make way for dots, never the other way
 * round. So, from the bottom up: the selected station's marker, the prices,
 * the dots, the origin. A dense 25 km search in Sydney has dots a few pixels
 * apart; anything drawn above them (a bigger selected dot, a bold price)
 * hid the neighbours, which looked like stations vanishing on selection.
 */

export const SOURCE = { stations: 'stations', origin: 'origin' } as const;
export const LAYER = {
  selectedDot: 'selected-dot',
  labels: 'station-labels',
  selectedLabel: 'selected-label',
  dots: 'station-dots',
  originRing: 'origin-ring',
  originDot: 'origin-dot',
  dotSpace: 'station-dot-space',
} as const;

/** The dot's radius and outline, and the space a price must leave around it. */
const DOT_RADIUS = 6;
const DOT_OUTLINE = 1.5;
const DOT_SPACE_IMAGE = 'dot-space';

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

  /*
   * The selected station: a bigger dot with a heavy edge, in place of its
   * ordinary dot (StationMap filters that one out) and UNDER every other
   * dot, so a neighbour close enough to overlap it is drawn over its edge
   * rather than hidden by it. Its shape (a filled disc) still sets it apart
   * from the search origin (a hollow ring), whatever the colours.
   */
  map.addLayer({
    id: LAYER.selectedDot,
    type: 'circle',
    source: SOURCE.stations,
    filter: nothingSelected,
    paint: {
      'circle-radius': 10,
      'circle-color': bandColour,
      'circle-stroke-width': 3,
      'circle-stroke-color': colours.selected,
    },
  });
  /*
   * Prices beside the dots. MapLibre drops a label that would overlap
   * another or a dot (see LAYER.dotSpace), and symbol-sort-key decides which
   * one wins: the cheaper. So a dense 25 km search in Sydney shows every dot
   * and the cheapest prices, and zooming in reveals the rest. No clustering:
   * a cluster would hide exactly the prices people came for. The cheapest
   * say "Cheapest" in words, so the colour is never the only way to tell.
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
      'text-radial-offset': 0.8,
      'text-padding': 2,
      'symbol-sort-key': ['get', 'priority'],
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
  });
  /*
   * The selected price, always shown: placed before the other prices
   * (higher layers are placed first), so they make way for it. It takes the
   * first of eight places beside its dot that covers no other dot, and only
   * if there is none does it overlap them; even then the dots are drawn
   * over it.
   */
  map.addLayer({
    id: LAYER.selectedLabel,
    type: 'symbol',
    source: SOURCE.stations,
    filter: nothingSelected,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [LABEL_FONT],
      'text-size': 15,
      'text-variable-anchor': [
        'left',
        'right',
        'top',
        'bottom',
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ],
      // Clear of its own bigger marker.
      'text-radial-offset': 1,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': colours.text, 'text-halo-color': colours.halo, 'text-halo-width': 2 },
  });
  map.addLayer({
    id: LAYER.dots,
    type: 'circle',
    source: SOURCE.stations,
    paint: {
      'circle-radius': DOT_RADIUS,
      'circle-color': bandColour,
      'circle-stroke-width': DOT_OUTLINE,
      'circle-stroke-color': colours.outline,
    },
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
  /*
   * Circles take no part in MapLibre's label placement, so on their own the
   * prices would be placed straight over other stations' dots. This layer
   * puts an invisible, dot-sized icon on every station into the placement:
   * always placed (allow-overlap), and in the way of every price (no
   * ignore-placement). It is the top layer, so it is placed first. A price
   * is offset far enough from its own dot to clear it.
   */
  const side = 2 * (DOT_RADIUS + DOT_OUTLINE);
  if (!map.hasImage(DOT_SPACE_IMAGE)) {
    map.addImage(DOT_SPACE_IMAGE, {
      width: side,
      height: side,
      data: new Uint8Array(side * side * 4),
    });
  }
  map.addLayer({
    id: LAYER.dotSpace,
    type: 'symbol',
    source: SOURCE.stations,
    layout: {
      'icon-image': DOT_SPACE_IMAGE,
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
      'icon-padding': 0,
    },
  });
}
