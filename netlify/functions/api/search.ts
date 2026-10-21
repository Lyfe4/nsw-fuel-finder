import { haversineKm, roundTo, type LatLng } from '../../lib/geo';

import type { Place } from './places';
import type { StationPrice } from '../../../shared/api';
import type { FuelTypeCode } from '../../../shared/fuelTypes';
import type { SnapshotStation } from '../../lib/snapshot/format';

/**
 * Nearby positions are rounded to ~1 km before they reach us, so a station
 * 4.6 km from the user can be 5.3 km from the rounded point. Searching this
 * much further keeps it in; the client filters on its precise position.
 */
const ROUNDING_SLACK_KM = 0.8;

const collator = new Intl.Collator('en-AU', { sensitivity: 'base' });

export function compareStations(a: StationPrice, b: StationPrice): number {
  return (
    a.priceCents - b.priceCents || a.distanceKm - b.distanceKm || collator.compare(a.name, b.name)
  );
}

function toStationPrice(
  station: SnapshotStation,
  fuel: FuelTypeCode,
  origin: LatLng,
): StationPrice | null {
  const price = station.prices[fuel];
  if (!price) return null;
  const position = { latitude: station.lat, longitude: station.lng };
  return {
    stationCode: station.code,
    name: station.name,
    brand: station.brand,
    address: station.address,
    latitude: station.lat,
    longitude: station.lng,
    distanceKm: roundTo(haversineKm(origin, position), 2),
    priceCents: price[0],
    priceUpdatedAt: price[1],
  };
}

/** Stations selling `fuel` within `radiusKm` of a (rounded) position. */
export function searchNearby(
  stations: readonly SnapshotStation[],
  origin: LatLng,
  radiusKm: number,
  fuel: FuelTypeCode,
): StationPrice[] {
  const results: StationPrice[] = [];
  for (const station of stations) {
    const result = toStationPrice(station, fuel, origin);
    if (result && result.distanceKm <= radiusKm + ROUNDING_SLACK_KM) results.push(result);
  }
  return results.sort(compareStations);
}

/**
 * Stations selling `fuel` in a place, plus any within `radiusKm` of its
 * centre. The union matters for big rural places: a station in the postcode
 * but 30 km from its centre still belongs in "prices in 2880".
 */
export function searchPlace(
  stations: readonly SnapshotStation[],
  place: Place,
  radiusKm: number,
  fuel: FuelTypeCode,
): StationPrice[] {
  const results: StationPrice[] = [];
  for (const station of stations) {
    const result = toStationPrice(station, fuel, place);
    if (!result) continue;
    if (place.stationCodes.has(station.code) || result.distanceKm <= radiusKm) {
      results.push(result);
    }
  }
  return results.sort(compareStations);
}
