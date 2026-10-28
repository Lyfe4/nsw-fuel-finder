import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';

/*
 * OpenFreeMap's basemap, redrawn in our colours: a monochrome print on paper
 * (docs/design-system.md, Map). Paper land, parks a shade off it, plain pale
 * water with a shore line, major roads in ink, the motorway as a double line,
 * minor roads and rail faint. Buildings, points of interest and house
 * numbers go: they are not what anyone opened a fuel map for.
 *
 * Done to the style OpenFreeMap serves, at every `style.load`, rather than by
 * hosting a style of our own: no file to keep in step with their tiles, and
 * no new request. Layers are told apart by the OpenMapTiles source layer they
 * draw (water, transportation, place...) and, for roads, by their id, which
 * says the road class in both OpenFreeMap styles ("highway_motorway_casing").
 */

export interface BasemapColours {
  land: string;
  water: string;
  shore: string;
  green: string;
  minor: string;
  ink: string;
  label: string;
  labelMuted: string;
}

/** Source layers the basemap does not need. */
const HIDDEN = new Set(['building', 'poi', 'housenumber', 'mountain_peak', 'aerodrome_label']);

const MAJOR_ROAD = /motorway|trunk|primary|secondary|tertiary|major/;
const MOTORWAY = /motorway|trunk/;

type Paint = [property: Parameters<MapLibreMap['setPaintProperty']>[1], value: string];

function paintFor(layer: LayerSpecification, colours: BasemapColours): Paint[] | 'hide' {
  const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
  if (sourceLayer && HIDDEN.has(sourceLayer)) return 'hide';
  const id = layer.id;

  switch (layer.type) {
    case 'background':
      return [['background-color', colours.land]];
    case 'fill':
      if (sourceLayer === 'water') {
        return [
          ['fill-color', colours.water],
          ['fill-outline-color', colours.shore],
        ];
      }
      if (sourceLayer === 'landcover' || sourceLayer === 'park') {
        return [['fill-color', colours.green]];
      }
      // Land use, aeroways and the rest: the paper, so they do not show.
      return [['fill-color', colours.land]];
    case 'line':
      if (sourceLayer === 'waterway') return [['line-color', colours.shore]];
      if (sourceLayer === 'transportation') {
        // Roads drawn as outlines: the casing in ink (major roads) or faint
        // (minor ones), the road itself in the paper's colour, so the motorway
        // and main roads read as double lines. The thin single-line versions
        // OpenFreeMap draws at low zoom ("subtle") have no casing: faint.
        if (id.includes('casing')) {
          return [['line-color', MAJOR_ROAD.test(id) ? colours.ink : colours.minor]];
        }
        if (id.includes('subtle')) return [['line-color', colours.minor]];
        if (MAJOR_ROAD.test(id) || MOTORWAY.test(id)) return [['line-color', colours.land]];
        return [['line-color', colours.minor]];
      }
      return [['line-color', colours.minor]];
    case 'symbol':
      return [
        ['text-color', sourceLayer === 'place' ? colours.label : colours.labelMuted],
        ['text-halo-color', colours.land],
      ];
    default:
      return [];
  }
}

export function restyleBasemap(map: MapLibreMap, colours: BasemapColours): void {
  for (const layer of map.getStyle().layers) {
    const paint = paintFor(layer, colours);
    if (paint === 'hide') {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
      continue;
    }
    for (const [property, value] of paint) {
      map.setPaintProperty(layer.id, property, value);
    }
  }
}
