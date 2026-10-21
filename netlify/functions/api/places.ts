import { ApiError } from './http';
import { centroid, cluster, type LatLng } from '../../lib/geo';
import { placeKey } from '../../lib/snapshot/address';

import type { LocationQuery } from './validate';
import type { SnapshotStation } from '../../lib/snapshot/format';

/**
 * Stations with the same suburb name are one place if each is within this
 * distance of another (single-linkage). Measured on the 2,397 fuel stations
 * in live data (2026-10-21):
 *
 * - the widest real single place needs 19.2 km to stay whole (White Cliffs;
 *   next is Deniliquin at 7.5);
 * - the closest stations sharing a suburb name but in different places are
 *   148.7 km apart (Cobar, see below), then Griffith NSW/ACT at 303 and
 *   Weston NSW/ACT at 355.
 *
 * 40 km has a wide margin on both sides.
 */
const SAME_PLACE_KM = 40;

export interface Place extends LatLng {
  /** e.g. "Kingswood NSW 2747", usable as a query to pick this place. */
  label: string;
  stationCodes: ReadonlySet<string>;
  postcodes: ReadonlySet<string>;
}

export interface PlaceIndex {
  bySuburb: ReadonlyMap<string, readonly Place[]>;
  byPostcode: ReadonlyMap<string, Place>;
}

interface Located extends LatLng {
  station: SnapshotStation;
}

function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function toPlace(group: readonly Located[], label: (stations: SnapshotStation[]) => string): Place {
  const stations = group.map((item) => item.station);
  return {
    ...centroid(group),
    label: label(stations),
    stationCodes: new Set(stations.map((station) => station.code)),
    postcodes: new Set(stations.flatMap((station) => (station.postcode ? [station.postcode] : []))),
  };
}

function groupBy(
  stations: readonly SnapshotStation[],
  key: (station: SnapshotStation) => string | null,
) {
  const groups = new Map<string, Located[]>();
  for (const station of stations) {
    const k = key(station);
    if (!k) continue;
    const item = { latitude: station.lat, longitude: station.lng, station };
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Built once per snapshot, from the stations' own addresses and positions. */
export function buildPlaceIndex(stations: readonly SnapshotStation[]): PlaceIndex {
  const bySuburb = new Map<string, Place[]>();
  for (const [key, group] of groupBy(stations, (s) => (s.suburb ? placeKey(s.suburb) : null))) {
    const places = cluster(group, SAME_PLACE_KM).map((part) =>
      toPlace(part, (members) =>
        [
          mostCommon(members.map((m) => m.suburb)),
          mostCommon(members.map((m) => m.state)),
          mostCommon(members.map((m) => m.postcode)),
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
    // Groups that share a whole label are one place with an outlier, not two
    // places: Emmdale Roadhouse is 149 km west of Cobar on the Barrier
    // Highway and its address is "COBAR NSW 2835". Asking "which Cobar NSW
    // 2835?" would be unanswerable, so the bigger group stands for the place.
    const byLabel = new Map<string, Place>();
    for (const place of places) {
      const existing = byLabel.get(place.label);
      if (!existing || place.stationCodes.size > existing.stationCodes.size) {
        byLabel.set(place.label, place);
      }
    }
    bySuburb.set(
      key,
      [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label)),
    );
  }

  // A postcode is located by its largest cluster of stations. Postcodes in the
  // data are sometimes wrong (one station 300 km from the rest), and the
  // largest cluster is where the postcode actually is.
  const byPostcode = new Map<string, Place>();
  for (const [postcode, group] of groupBy(stations, (s) => s.postcode)) {
    const parts = cluster(group, SAME_PLACE_KM).sort((a, b) => b.length - a.length);
    const largest = parts[0];
    if (largest)
      byPostcode.set(
        postcode,
        toPlace(largest, () => postcode),
      );
  }

  return { bySuburb, byPostcode };
}

/**
 * Turns a suburb or postcode into a place, or explains why it cannot.
 * A place is only known if FuelCheck lists a station there; a suburb with no
 * station is "not found" and the message suggests a neighbour or a postcode.
 */
export function resolvePlace(index: PlaceIndex, query: LocationQuery): Place {
  if (query.kind === 'postcode') {
    const place = index.byPostcode.get(query.postcode);
    if (!place) {
      throw new ApiError(
        'location_not_found',
        `No stations are listed in postcode ${query.postcode}. Try a nearby postcode or suburb.`,
      );
    }
    return place;
  }

  const all = index.bySuburb.get(placeKey(query.suburb)) ?? [];
  const places = query.postcode
    ? all.filter((place) => query.postcode !== null && place.postcodes.has(query.postcode))
    : all;
  const [first, ...rest] = places;
  if (!first) {
    throw new ApiError(
      'location_not_found',
      `No stations are listed in ${query.suburb}. Try a nearby suburb or a postcode.`,
    );
  }
  if (rest.length > 0) {
    throw new ApiError('ambiguous_location', `There is more than one ${query.suburb}.`, {
      candidates: places.map((place) => place.label),
    });
  }
  return first;
}
