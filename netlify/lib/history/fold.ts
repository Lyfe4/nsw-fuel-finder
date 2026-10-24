import { z } from 'zod';

import {
  addDays,
  LIVE_DAYS_KEPT,
  LIVE_HISTORY_START,
  STATION_HISTORY_VERSION,
  stationHistorySchema,
  type StationHistory,
} from './stationHistory';
import { FUEL_TYPE_CODES } from '../../../shared/fuelTypes';
import { historyDaySchema, type HistoryDay } from '../snapshot/history';
import { KEYS, type KeyValueStore } from '../store';

/**
 * FOLDING OUR DAILY FILES INTO PER-STATION FILES, a slice at a time.
 *
 * Every run, after the snapshot is written, takes the next STATIONS_PER_RUN
 * stations (by code) and adds yesterday, and any other finished day it is
 * missing, to each one's `history/v2/live/{code}`. With ~2,400 stations and a
 * run every 30 minutes, every station has yesterday by about 6 am Sydney time;
 * the runs after that find nothing to do and cost one small read.
 *
 * Why slices: doing all 2,400 in one run is 4,800 Blobs operations inside a
 * scheduled function's 30-second limit, on the run that also fetches prices.
 * 200 is ~400 operations, 16 at a time: a few seconds. Progress is kept in
 * `history/v2/progress`, so a failed or skipped run just leaves the slice for
 * the next one.
 */
export const STATIONS_PER_RUN = 200;
const CONCURRENCY = 16;
/** A station that has fallen behind catches up at most this many days in one go. */
const MAX_CATCH_UP_DAYS = 14;

const foldProgressSchema = z.object({
  /** The day being folded in: yesterday, in Sydney. */
  target: z.string(),
  /** How many stations (in code order) have it. */
  done: z.number().int().min(0),
});
export type FoldProgress = z.infer<typeof foldProgressSchema>;

export interface FoldResult {
  target: string;
  stations: number;
  written: number;
  remaining: number;
}

async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(task));
  }
}

/** Every finished day from `from` to `through` for one station, as chart rows. */
function rowsFor(code: string, from: string, through: string, days: Map<string, HistoryDay>) {
  const added: StationHistory['fuels'] = {};
  for (let day = from; day <= through; day = addDays(day, 1)) {
    const record = days.get(day);
    if (!record) continue;
    for (const fuel of FUEL_TYPE_CODES) {
      const entry = record.fuels[fuel]?.[code];
      if (entry) (added[fuel] ??= []).push([day, entry[0], entry[1], entry[2]]);
    }
  }
  return added;
}

/**
 * One run's share of the fold. `today` is the Sydney day of this run's
 * snapshot; `codes` are the stations in it.
 */
export async function foldHistory(
  store: KeyValueStore,
  today: string,
  codes: readonly string[],
): Promise<FoldResult | null> {
  const target = addDays(today, -1);
  if (target < LIVE_HISTORY_START) return null;

  const sorted = [...codes].sort((a, b) => a.localeCompare(b));
  // Anything unreadable starts the day again: re-folding a station is harmless.
  const saved = foldProgressSchema.safeParse(await store.getJSON(KEYS.historyProgress, 'strong'));
  const done = saved.success && saved.data.target === target ? saved.data.done : 0;
  const slice = sorted.slice(done, done + STATIONS_PER_RUN);
  if (slice.length === 0) return { target, stations: 0, written: 0, remaining: 0 };

  // Each day's file is read at most once per run, and only if a station needs it.
  const days = new Map<string, HistoryDay>();
  const needed = new Set<string>();
  const earliest = addDays(target, -(MAX_CATCH_UP_DAYS - 1));
  const existing = new Map<string, StationHistory | null>();
  await mapLimit(slice, CONCURRENCY, async (code) => {
    const parsed = stationHistorySchema.safeParse(
      await store.getJSON(KEYS.historyLive(code), 'strong'),
    );
    const history = parsed.success ? parsed.data : null;
    existing.set(code, history);
    const start = history ? addDays(history.through, 1) : LIVE_HISTORY_START;
    for (let day = start < earliest ? earliest : start; day <= target; day = addDays(day, 1)) {
      needed.add(day);
    }
  });
  for (const day of [...needed].sort()) {
    const parsed = historyDaySchema.safeParse(await store.getJSON(KEYS.historyDay(day), 'strong'));
    if (parsed.success) days.set(day, parsed.data);
  }

  let written = 0;
  const keepFrom = addDays(target, -(LIVE_DAYS_KEPT - 1));
  await mapLimit(slice, CONCURRENCY, async (code) => {
    const history = existing.get(code) ?? null;
    const start = history ? addDays(history.through, 1) : LIVE_HISTORY_START;
    if (start > target) return;
    // Written even when empty (a station with no prices yet), so tomorrow it
    // needs one day's file, not the whole catch-up window.
    const added = rowsFor(code, start < earliest ? earliest : start, target, days);
    const fuels: StationHistory['fuels'] = {};
    for (const fuel of FUEL_TYPE_CODES) {
      const rows = [...(history?.fuels[fuel] ?? []), ...(added[fuel] ?? [])].filter(
        ([d]) => d >= keepFrom,
      );
      if (rows.length > 0) fuels[fuel] = rows;
    }
    const firstDays = Object.values(fuels).map((rows) => rows[0]?.[0] ?? target);
    const next: StationHistory = {
      version: STATION_HISTORY_VERSION,
      code,
      source: 'snapshots',
      from: firstDays.sort()[0] ?? target,
      through: target,
      fuels,
    };
    await store.setJSON(KEYS.historyLive(code), next);
    written += 1;
  });

  const progress: FoldProgress = { target, done: done + slice.length };
  await store.setJSON(KEYS.historyProgress, progress);
  return {
    target,
    stations: slice.length,
    written,
    remaining: sorted.length - progress.done,
  };
}
