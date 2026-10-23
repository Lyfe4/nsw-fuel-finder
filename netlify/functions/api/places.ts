import { ApiError } from './http';
import { centroid, cluster, haversineKm, type LatLng } from '../../lib/geo';
import {
  POSTCODES,
  SUGGESTION_LIMIT,
  suburbByLabel,
  suburbsNamed,
  suburbsStartingWith,
  type Suburb,
} from '../../lib/places/gazetteer';
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
 * 40 km has a wide margin on both sides. It is also how far from an ABS
 * suburb's centre a station with that suburb in its address may be and still
 * count as "in" it.
 */
const SAME_PLACE_KM = 40;

export interface Place extends LatLng {
  /** e.g. "Kingswood (Penrith) NSW 2747"; sent back as a query, it picks this place. */
  label: string;
  /** Stations that are in the place by address, whatever their distance from its centre. */
  stationCodes: ReadonlySet<string>;
}

/** Derived from one snapshot's stations; the ABS gazetteer is static. */
export interface PlaceIndex {
  stationsBySuburb: ReadonlyMap<string, readonly SnapshotStation[]>;
  /** Fallback for suburb names that appear in addresses but not in the ABS list. */
  stationPlacesBySuburb: ReadonlyMap<string, readonly Place[]>;
  /** A postcode is placed at its largest cluster of stations, where there is one. */
  stationPlacesByPostcode: ReadonlyMap<string, Place>;
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

function toPlace(group: readonly Located[], label: string): Place {
  return {
    ...centroid(group),
    label,
    stationCodes: new Set(group.map((item) => item.station.code)),
  };
}

function groupBy(stations: readonly SnapshotStation[], key: (s: SnapshotStation) => string | null) {
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

export function buildPlaceIndex(stations: readonly SnapshotStation[]): PlaceIndex {
  const bySuburbKey = groupBy(stations, (s) => (s.suburb ? placeKey(s.suburb) : null));

  const stationsBySuburb = new Map<string, SnapshotStation[]>();
  const stationPlacesBySuburb = new Map<string, Place[]>();
  for (const [key, group] of bySuburbKey) {
    stationsBySuburb.set(
      key,
      group.map((item) => item.station),
    );
    // Groups that share a whole label are one place with an outlier, not two
    // places: Emmdale Roadhouse is 149 km west of Cobar and its address is
    // "COBAR NSW 2835". The bigger group stands for the place.
    const byLabel = new Map<string, Place>();
    for (const part of cluster(group, SAME_PLACE_KM)) {
      const members = part.map((item) => item.station);
      const label = [
        mostCommon(members.map((m) => m.suburb)),
        mostCommon(members.map((m) => m.state)),
        mostCommon(members.map((m) => m.postcode)),
      ]
        .filter(Boolean)
        .join(' ');
      const place = toPlace(part, label);
      const existing = byLabel.get(label);
      if (!existing || place.stationCodes.size > existing.stationCodes.size) {
        byLabel.set(label, place);
      }
    }
    stationPlacesBySuburb.set(
      key,
      [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label)),
    );
  }

  // Postcodes in station addresses are sometimes wrong (one station 300 km
  // from the rest), so the largest cluster is where the postcode really is.
  const stationPlacesByPostcode = new Map<string, Place>();
  for (const [postcode, group] of groupBy(stations, (s) => s.postcode)) {
    const largest = cluster(group, SAME_PLACE_KM).sort((a, b) => b.length - a.length)[0];
    if (largest) stationPlacesByPostcode.set(postcode, toPlace(largest, postcode));
  }

  return { stationsBySuburb, stationPlacesBySuburb, stationPlacesByPostcode };
}

/** An ABS suburb, plus the stations whose address names it and that are near it. */
function fromSuburb(index: PlaceIndex, suburb: Suburb): Place {
  const named = index.stationsBySuburb.get(placeKey(suburb.name)) ?? [];
  const stationCodes = new Set(
    named
      .filter(
        (station) =>
          station.state === suburb.state &&
          haversineKm(suburb, { latitude: station.lat, longitude: station.lng }) <= SAME_PLACE_KM,
      )
      .map((station) => station.code),
  );
  return {
    latitude: suburb.latitude,
    longitude: suburb.longitude,
    label: suburb.label,
    stationCodes,
  };
}

function ambiguous(message: string, labels: readonly string[]): never {
  throw new ApiError('ambiguous_location', message, {
    candidates: labels.slice(0, SUGGESTION_LIMIT),
  });
}

/** "Kingswood (Penrith)" -> { name: "Kingswood", qualifier: "Penrith" } */
function splitQualifier(text: string): { name: string; qualifier: string | null } {
  const match = /^(.*?)\s*\((.*)\)$/.exec(text);
  return match
    ? { name: match[1] ?? text, qualifier: match[2] ?? null }
    : { name: text, qualifier: null };
}

/**
 * Turns a suburb or postcode into a place, or explains why it cannot:
 *
 * 1. an exact suggestion label ("Kingswood (Penrith) NSW 2747") is that place;
 * 2. a postcode is its station cluster, else the ABS postal area's centre;
 * 3. a suburb name, narrowed by any qualifier, state and postcode given, is
 *    an ABS suburb; several are `ambiguous_location` with the choices;
 * 4. a name that matches nothing exactly but starts one or more names
 *    ("Wagga") resolves when there is one, offers choices when several;
 * 5. a name only station addresses know ("Dubbo North") falls back to them.
 */
export function resolvePlace(index: PlaceIndex, query: LocationQuery): Place {
  if (query.kind === 'postcode') {
    const stations = index.stationPlacesByPostcode.get(query.postcode);
    if (stations) return stations;
    const area = POSTCODES.get(query.postcode);
    if (area) return { ...area, label: query.postcode, stationCodes: new Set() };
    throw new ApiError('location_not_found', `We don't know the postcode ${query.postcode}.`);
  }

  const exact = suburbByLabel(query.text);
  if (exact) return fromSuburb(index, exact);

  const { name, qualifier } = splitQualifier(query.suburb);
  const candidates = suburbsNamed(name).filter(
    (suburb) =>
      (!qualifier || placeKey(suburb.qualifier ?? '').startsWith(placeKey(qualifier))) &&
      (!query.state || suburb.state === query.state) &&
      (!query.postcode || suburb.postcode === query.postcode),
  );
  const [only, ...others] = candidates;
  if (only && others.length === 0) return fromSuburb(index, only);
  if (only) {
    ambiguous(
      `There is more than one ${name}.`,
      candidates.map((s) => s.label).sort((a, b) => a.localeCompare(b)),
    );
  }

  if (!qualifier && !query.state && !query.postcode) {
    const starting = suburbsStartingWith(name);
    const [first, ...rest] = starting;
    if (first && rest.length === 0) return fromSuburb(index, first);
    if (first)
      ambiguous(
        `Did you mean one of these?`,
        starting.map((s) => s.label),
      );
  }

  const fallback = (index.stationPlacesBySuburb.get(placeKey(name)) ?? []).filter(
    (place) => !query.postcode || place.label.endsWith(query.postcode),
  );
  const [place, ...more] = fallback;
  if (place && more.length === 0) return place;
  if (place)
    ambiguous(
      `There is more than one ${name}.`,
      fallback.map((p) => p.label),
    );

  throw new ApiError('location_not_found', `We couldn't find ${query.text} in NSW or the ACT.`);
}
