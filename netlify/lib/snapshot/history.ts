import { z } from 'zod';

import { FUEL_TYPE_CODES, type FuelTypeCode } from '../../../shared/fuelTypes';
import { sydneyDay } from '../upstream/time';

import type { Snapshot } from './format';

/**
 * PRICE HISTORY, groundwork for the Phase 4 chart. API.NSW has no history
 * endpoint, so we keep our own from launch.
 *
 * One blob per Sydney calendar day, `history/v1/YYYY-MM-DD`:
 *
 *   { "version": 1, "day": "2026-10-21",
 *     "fuels": { "U91": { "972": [212.3, 219.9, 214.5], ... }, ... } }
 *
 * Each entry is [min, max, last] cents for that station and fuel over the
 * snapshots taken that day. Built from snapshots, so a price that changed and
 * changed back between two runs (30 minutes) is not seen.
 *
 * Size: ~10,000 station/fuel pairs at ~25 bytes is ~250 kB a day, ~90 MB a
 * year. Each run reads and rewrites today's blob.
 */
export const HISTORY_VERSION = 1;

const entry = z.tuple([z.number(), z.number(), z.number()]);
const fuelCodes = FUEL_TYPE_CODES as [FuelTypeCode, ...FuelTypeCode[]];

export const historyDaySchema = z.object({
  version: z.literal(HISTORY_VERSION),
  day: z.string(),
  fuels: z.partialRecord(z.enum(fuelCodes), z.record(z.string(), entry)),
});

export type HistoryDay = z.infer<typeof historyDaySchema>;

/** The snapshot's calendar day, by default in Sydney; Queensland's is Brisbane's. */
export function historyDayFor(snapshot: Snapshot, dayOf = sydneyDay): string {
  return dayOf(new Date(snapshot.fetchedAt));
}

/** Folds one snapshot into the day's record. `existing` is null on the day's first run. */
export function updateHistoryDay(
  existing: HistoryDay | null,
  snapshot: Snapshot,
  dayOf = sydneyDay,
): HistoryDay {
  const day = historyDayFor(snapshot, dayOf);
  const fuels: HistoryDay['fuels'] = existing?.day === day ? existing.fuels : {};

  for (const station of snapshot.stations) {
    for (const fuel of FUEL_TYPE_CODES) {
      const tuple = station.prices[fuel];
      if (!tuple) continue;
      const cents = tuple[0];
      const byStation = (fuels[fuel] ??= {});
      const previous = byStation[station.code];
      byStation[station.code] = previous
        ? [Math.min(previous[0], cents), Math.max(previous[1], cents), cents]
        : [cents, cents, cents];
    }
  }

  return { version: HISTORY_VERSION, day, fuels };
}
