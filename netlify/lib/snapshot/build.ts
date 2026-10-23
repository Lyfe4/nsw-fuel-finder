import { parseAddresses } from './address';
import { SNAPSHOT_VERSION, type Snapshot, type SnapshotStation } from './format';
import { isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';
import { parseUpstreamTimestamp } from '../upstream/time';

import type { StatewidePrices } from '../upstream/schemas';

/** Counts of what was left out, for the run log. */
export interface BuildStats {
  stations: number;
  prices: number;
  skippedPrices: { unknownFuel: number; notPositive: number; badTimestamp: number };
  skippedStations: { notNsw: number; noPrices: number };
}

/**
 * Turns the statewide /prices response into our snapshot: stations and
 * their current prices joined, NSW only, every fuel we offer.
 *
 * Left out, and counted: fuels we do not offer (EV, whose rows are almost all
 * 0), non-positive prices, unparseable timestamps, stations that FuelCheck
 * files under another state, and stations left with no price at all.
 */
export function buildSnapshot(
  upstream: StatewidePrices,
  fetchedAt: Date,
): { snapshot: Snapshot; stats: BuildStats } {
  const stats: BuildStats = {
    stations: 0,
    prices: 0,
    skippedPrices: { unknownFuel: 0, notPositive: 0, badTimestamp: 0 },
    skippedStations: { notNsw: 0, noPrices: 0 },
  };

  const pricesByStation = new Map<string, Partial<Record<FuelTypeCode, [number, string]>>>();
  for (const row of upstream.prices) {
    if (row.state !== undefined && row.state !== 'NSW') continue;
    if (!isFuelTypeCode(row.fueltype)) {
      stats.skippedPrices.unknownFuel++;
      continue;
    }
    if (!(row.price > 0)) {
      stats.skippedPrices.notPositive++;
      continue;
    }
    const updatedAt = parseUpstreamTimestamp(row.lastupdated);
    if (updatedAt === null) {
      stats.skippedPrices.badTimestamp++;
      continue;
    }
    const prices = pricesByStation.get(row.stationcode) ?? {};
    prices[row.fueltype] = [row.price, updatedAt];
    pricesByStation.set(row.stationcode, prices);
  }

  // `state` is "NSW" on ACT stations too; the address is what tells them apart.
  const nsw = upstream.stations.filter((station) => {
    const keep = station.state === undefined || station.state === 'NSW';
    if (!keep) stats.skippedStations.notNsw++;
    return keep;
  });
  const addresses = parseAddresses(nsw.map((station) => station.address));

  const stations: SnapshotStation[] = [];
  const seen = new Set<string>();
  nsw.forEach((station, i) => {
    const prices = pricesByStation.get(station.code);
    const address = addresses[i];
    if (seen.has(station.code) || !address) return;
    if (!prices || Object.keys(prices).length === 0) {
      stats.skippedStations.noPrices++;
      return;
    }
    seen.add(station.code);
    stats.prices += Object.keys(prices).length;
    stations.push({
      code: station.code,
      // Upstream has stray double spaces: "Shell Reddy  Express Erina".
      name: station.name.replace(/\s+/g, ' ').trim(),
      brand: station.brand.replace(/\s+/g, ' ').trim(),
      address: station.address.replace(/\s+/g, ' ').trim(),
      suburb: address.suburb,
      postcode: address.postcode,
      state: address.state ?? 'NSW',
      lat: station.location.latitude,
      lng: station.location.longitude,
      prices,
    });
  });
  stats.stations = stations.length;

  return {
    snapshot: {
      version: SNAPSHOT_VERSION,
      fetchedAt: fetchedAt.toISOString(),
      stations,
    },
    stats,
  };
}
