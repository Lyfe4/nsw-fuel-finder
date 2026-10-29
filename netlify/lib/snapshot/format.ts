import { z } from 'zod';

import { FUEL_TYPE_CODES, type FuelTypeCode } from '../../../shared/fuelTypes';

/**
 * The snapshot the scheduled job writes and the API reads, at
 * `snapshot/v1/latest`. A breaking change gets a new version AND a new key,
 * so an API deployed ahead of its first new-format snapshot finds nothing
 * (503) rather than misreading the old one.
 *
 * ~2,400 stations (FuelCheck lists ~3,300; EV-only ones are left out), ~875 kB
 * of JSON. Prices are [cents, updatedAt] tuples to
 * keep it compact.
 */
export const SNAPSHOT_VERSION = 1;

/** How often the job runs. Must match the cron in netlify/functions/snapshot. */
export const SNAPSHOT_INTERVAL_MINUTES = 30;

/**
 * Older than three missed runs, a snapshot is served flagged `stale: true`
 * rather than refused. See docs/decisions.md.
 */
export const STALE_AFTER_MS = 3 * SNAPSHOT_INTERVAL_MINUTES * 60_000;

/**
 * Queensland's job runs every 10 minutes: as a publisher, a price change
 * must be shown within 30 minutes (licence clause 2.3; docs/qld-plan.md).
 * Must match the cron in netlify/functions/snapshot-qld.
 */
export const QLD_SNAPSHOT_INTERVAL_MINUTES = 10;

/** Three missed runs, which is also the licence's 30 minutes. */
export const QLD_STALE_AFTER_MS = 3 * QLD_SNAPSHOT_INTERVAL_MINUTES * 60_000;

/**
 * Older than this, Queensland's snapshot is not served at all: its stations
 * are left out and `qld` is listed as unavailable (combinedSource.ts). A
 * publisher must show a price change within 30 minutes (clause 2.3), and an
 * answer can sit up to two minutes at the CDN and one in the browser, so 25
 * keeps what a visitor sees under 30. NSW has no such rule: its old
 * snapshot is still served, flagged stale (STALE_AFTER_MS).
 */
export const QLD_SERVE_MAX_MS = 25 * 60_000;

const priceTuple = z.tuple([z.number(), z.string()]);
const fuelCodes = FUEL_TYPE_CODES as [FuelTypeCode, ...FuelTypeCode[]];

export const snapshotStationSchema = z.object({
  code: z.string(),
  name: z.string(),
  brand: z.string(),
  address: z.string(),
  /** Parsed from the address; null where the address has no recognisable suburb. */
  suburb: z.string().nullable(),
  postcode: z.string().nullable(),
  /**
   * NSW's from the address (about 70 FuelCheck stations are in the ACT);
   * always QLD in Queensland's snapshot. Widened for QLD: the NSW job never
   * writes it, so an older reader of NSW's snapshot is unaffected.
   */
  state: z.enum(['NSW', 'ACT', 'QLD']),
  lat: z.number(),
  lng: z.number(),
  prices: z.partialRecord(z.enum(fuelCodes), priceTuple),
});

export const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  /** When the job fetched the data, ISO 8601 UTC. */
  fetchedAt: z.string(),
  stations: z.array(snapshotStationSchema),
});

export type SnapshotStation = z.infer<typeof snapshotStationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
