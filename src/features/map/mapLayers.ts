import { LABEL_FONT } from './mapStyle';

import type { BasemapColours } from './basemap';
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
const TAG = { plain: 'tag', cheapest: 'tag-cheapest', selected: 'tag-selected' } as const;

/** Map colours from the design tokens: the map draws on a canvas, out of CSS's reach. */
export function tokenColours(element: Element) {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const basemap: BasemapColours = {
    land: token('--color-map-land'),
    water: token('--color-map-water'),
    shore: token('--color-map-shore'),
    green: token('--color-map-green'),
    minor: token('--color-map-minor'),
    ink: token('--color-text'),
    label: token('--color-text'),
    labelMuted: token('--color-text-muted'),
  };
  return {
    low: token('--color-price-low'),
    mid: token('--color-price-mid'),
    high: token('--color-price-high'),
    outline: token('--color-marker-outline'),
    selected: token('--color-marker-selected'),
    origin: token('--color-map-origin'),
    text: token('--color-text'),
    paper: token('--color-surface'),
    accent: token('--color-accent'),
    onAccent: token('--color-on-accent'),
    basemap,
  };
}

/** "#1f55a8" (or "#15a") as RGBA bytes. */
function rgba(hex: string): [number, number, number, number] {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits;
  const value = Number.parseInt(full.slice(0, 6), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

/**
 * A price tag: a box with a border, as a stretchable image MapLibre fits
 * around each price (icon-text-fit). 12 px square: a border of `edge` px all
 * round, and only the middle stretches, so the border stays crisp at any size.
 */
function tagImage(fill: string, border: string, edge: number) {
  const side = 12;
  const data = new Uint8Array(side * side * 4);
  const inside = rgba(fill);
  const outside = rgba(border);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const onEdge = x < edge || y < edge || x >= side - edge || y >= side - edge;
      data.set(onEdge ? outside : inside, (y * side + x) * 4);
    }
  }
  return {
    image: { width: side, height: side, data },
    options: {
      stretchX: [[edge + 1, side - edge - 1]] as [number, number][],
      stretchY: [[edge + 1, side - edge - 1]] as [number, number][],
      content: [edge + 1, edge + 1, side - edge - 1, side - edge - 1] as [
        number,
        number,
        number,
        number,
      ],
    },
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
  const isCheapest: ExpressionSpecification = ['get', 'cheapest'];

  /*
   * The docket's price tags: paper with an ink edge; the cheapest inverted,
   * in the accent; the selected one with a heavier edge. Images go with the
   * style, so they are added again with it (and in the new theme's colours).
   */
  for (const [name, fill, border, edge] of [
    [TAG.plain, colours.paper, colours.text, 1],
    [TAG.cheapest, colours.accent, colours.accent, 1],
    [TAG.selected, colours.paper, colours.text, 2],
  ] as const) {
    if (map.hasImage(name)) map.removeImage(name);
    const { image, options } = tagImage(fill, border, edge);
    map.addImage(name, image, options);
  }
  /*
   * The tag follows its price: with variable anchors MapLibre does not move
   * an icon's collision box with the text, so the tag would collide with its
   * own dot and the price would be dropped. The text alone takes part in
   * placement; the tag, fitted to it, can only be where the text is.
   */
  const tagFit = {
    'icon-text-fit': 'both' as const,
    'icon-text-fit-padding': [2, 5, 1, 5] as [number, number, number, number],
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  };

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
      'text-radial-offset': 1,
      'text-padding': 2,
      'symbol-sort-key': ['get', 'priority'],
      'icon-image': ['case', isCheapest, TAG.cheapest, TAG.plain],
      ...tagFit,
    },
    paint: { 'text-color': ['case', isCheapest, colours.onAccent, colours.text] },
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
      'text-radial-offset': 1.3,
      'text-allow-overlap': true,
      'icon-image': ['case', isCheapest, TAG.cheapest, TAG.selected],
      ...tagFit,
    },
    paint: { 'text-color': ['case', isCheapest, colours.onAccent, colours.text] },
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
