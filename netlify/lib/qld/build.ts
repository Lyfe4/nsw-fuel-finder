import { z } from 'zod';

import { PLAUSIBLE_CENTS, QLD_BRAND_ALIASES, QLD_FUELS, QLD_UNAVAILABLE } from './mapping';
import { qldPriceSchema, qldSiteSchema, type QldBrands, type QldRegions } from './schemas';
import { SNAPSHOT_VERSION, type Snapshot, type SnapshotStation } from '../snapshot/format';

import type { FuelTypeCode } from '../../../shared/fuelTypes';

/** Our station codes for Queensland: prefixed, so they can never equal a NSW code. */
export const QLD_CODE_PREFIX = 'qld-';

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * THE REFERENCE DATA, `qld/reference/v1`: what a station needs besides its
 * prices, cut down from the three reference calls (about 1.5 MB raw) to
 * what we use. Refreshed once a day: the licence asks for "other published
 * data" to be no more than 24 hours old.
 */
export const QLD_REFERENCE_VERSION = 1;

const referenceSiteSchema = z.object({
  name: z.string(),
  /** The street line; empty when the API has none. */
  street: z.string(),
  suburb: z.string().nullable(),
  postcode: z.string(),
  brand: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const qldReferenceSchema = z.object({
  version: z.literal(QLD_REFERENCE_VERSION),
  fetchedAt: z.string(),
  /** By the API's site ID. */
  sites: z.record(z.string(), referenceSiteSchema),
});

export type QldReference = z.infer<typeof qldReferenceSchema>;

export interface ReferenceStats {
  sites: number;
  skippedSites: number;
  unknownSuburbs: number;
}

export function buildReference(
  raw: { sites: unknown[]; brands: QldBrands; regions: QldRegions },
  fetchedAt: Date,
): { reference: QldReference; stats: ReferenceStats } {
  const brands = new Map(raw.brands.Brands.map((brand) => [brand.BrandId, tidy(brand.Name)]));
  const suburbs = new Map(
    raw.regions.GeographicRegions.filter((region) => region.GeoRegionLevel === 1).map((region) => [
      region.GeoRegionId,
      tidy(region.Name),
    ]),
  );
  const stats: ReferenceStats = { sites: 0, skippedSites: 0, unknownSuburbs: 0 };
  const sites: QldReference['sites'] = {};
  for (const row of raw.sites) {
    const parsed = qldSiteSchema.safeParse(row);
    if (!parsed.success) {
      stats.skippedSites++;
      continue;
    }
    const site = parsed.data;
    const suburb = suburbs.get(site.G1) ?? null;
    if (suburb === null) stats.unknownSuburbs++;
    const brand = brands.get(site.B) ?? '';
    sites[String(site.S)] = {
      name: tidy(site.N),
      street: tidy(site.A ?? ''),
      suburb,
      postcode: tidy(site.P),
      brand: QLD_BRAND_ALIASES[brand] ?? brand,
      lat: site.Lat,
      lng: site.Lng,
    };
    stats.sites++;
  }
  return {
    reference: { version: QLD_REFERENCE_VERSION, fetchedAt: fetchedAt.toISOString(), sites },
    stats,
  };
}

const UTC_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * `TransactionDateUtc` to ISO 8601 UTC, or null if it is not a real date.
 *
 * It is UTC but carries no offset ("2026-09-19T21:09:50.913"), and
 * `Date.parse` reads a date-time with no offset as LOCAL time. Netlify runs
 * in UTC, so that would only break on a laptop, which is why nothing here
 * goes through `Date.parse` without a zone. An offset, if one ever appears,
 * is honoured.
 */
export function parseQldTimestamp(value: string): string | null {
  const match = UTC_STAMP.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls 31/02 over into March; a round trip catches that.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day ||
    instant.getUTCHours() !== hour ||
    instant.getUTCMinutes() !== minute ||
    instant.getUTCSeconds() !== second
  ) {
    return null;
  }
  if (zone && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const offsetMinutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6));
    instant.setTime(instant.getTime() - sign * offsetMinutes * 60_000);
  }
  return instant.toISOString().replace('.000Z', 'Z');
}

/** Counts of what was left out, for the run log. */
export interface QldBuildStats {
  stations: number;
  prices: number;
  skippedPrices: {
    badRow: number;
    unknownFuel: number;
    unavailable: number;
    implausible: number;
    badTimestamp: number;
    unknownSite: number;
  };
  /** Stamped later than the run: clamped to the run's time (the server's clock runs ahead). */
  futureClamped: number;
  skippedStations: { noPrices: number };
  reference: { fetchedAt: string; refreshed: boolean; error?: string };
}

/**
 * Turns the reference data and one GetSitesPrices response into a snapshot in
 * the same shape as NSW's, so the API can merge the two.
 */
export function buildQldSnapshot(
  reference: QldReference,
  prices: unknown[],
  fetchedAt: Date,
  referenceStatus: QldBuildStats['reference'],
): { snapshot: Snapshot; stats: QldBuildStats } {
  const stats: QldBuildStats = {
    stations: 0,
    prices: 0,
    skippedPrices: {
      badRow: 0,
      unknownFuel: 0,
      unavailable: 0,
      implausible: 0,
      badTimestamp: 0,
      unknownSite: 0,
    },
    futureClamped: 0,
    skippedStations: { noPrices: 0 },
    reference: referenceStatus,
  };
  const now = fetchedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const pricesBySite = new Map<string, Partial<Record<FuelTypeCode, [number, string]>>>();
  for (const raw of prices) {
    const parsed = qldPriceSchema.safeParse(raw);
    if (!parsed.success) {
      stats.skippedPrices.badRow++;
      continue;
    }
    const row = parsed.data;
    const fuel = QLD_FUELS[row.FuelId];
    if (!fuel) {
      stats.skippedPrices.unknownFuel++;
      continue;
    }
    if (row.Price === QLD_UNAVAILABLE) {
      stats.skippedPrices.unavailable++;
      continue;
    }
    // Tenths of a cent to cents, kept to one decimal: 2399 is 239.9.
    const cents = Math.round(row.Price) / 10;
    if (!(cents >= PLAUSIBLE_CENTS.min && cents <= PLAUSIBLE_CENTS.max)) {
      stats.skippedPrices.implausible++;
      continue;
    }
    let updatedAt = parseQldTimestamp(row.TransactionDateUtc);
    if (updatedAt === null) {
      stats.skippedPrices.badTimestamp++;
      continue;
    }
    if (updatedAt > now) {
      stats.futureClamped++;
      updatedAt = now;
    }
    const id = String(row.SiteId);
    if (!(id in reference.sites)) {
      stats.skippedPrices.unknownSite++;
      continue;
    }
    const byFuel = pricesBySite.get(id) ?? {};
    byFuel[fuel] = [cents, updatedAt];
    pricesBySite.set(id, byFuel);
  }

  const stations: SnapshotStation[] = [];
  for (const [id, site] of Object.entries(reference.sites)) {
    const byFuel = pricesBySite.get(id);
    if (!byFuel) {
      stats.skippedStations.noPrices++;
      continue;
    }
    const place = [site.suburb, 'QLD', site.postcode].filter(Boolean).join(' ');
    stations.push({
      code: `${QLD_CODE_PREFIX}${id}`,
      name: site.name,
      brand: site.brand,
      address: site.street ? `${site.street}, ${place}` : place,
      suburb: site.suburb,
      postcode: site.postcode || null,
      state: 'QLD',
      lat: site.lat,
      lng: site.lng,
      prices: byFuel,
    });
    stats.prices += Object.keys(byFuel).length;
  }
  stats.stations = stations.length;

  return {
    snapshot: { version: SNAPSHOT_VERSION, fetchedAt: fetchedAt.toISOString(), stations },
    stats,
  };
}
