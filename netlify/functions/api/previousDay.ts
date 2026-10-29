import { historyDaySchema, type HistoryDay } from '../../lib/snapshot/history';
import { KEYS, type KeyValueStore } from '../../lib/store';

/** After a failed or missing read, how long before a warm instance asks again. */
const RETRY_MS = 5 * 60_000;

/**
 * One finished day's prices (history/v1/DAY), for "since yesterday" on each
 * station. A finished day never changes, so a warm instance reads it once
 * and keeps it until the day moves on: one ~260 kB read a day per instance.
 *
 * Eventual reads: the file was last written yesterday, long before anyone
 * asks for it as "yesterday". Strong reads would add nothing but latency.
 *
 * Never throws. Without yesterday the search still works; each station's
 * change is just unknown (null). A failed or missing read is retried after
 * RETRY_MS rather than on every request.
 */
export function createPreviousDaySource(deps: {
  store: KeyValueStore;
  now: () => number;
  /** NSW's day files by default; Queensland's are `QLD_KEYS.historyDay` (round 15). */
  dayKey?: (day: string) => string;
}) {
  const dayKey = deps.dayKey ?? KEYS.historyDay;
  let cached: { day: string; fuels: HistoryDay['fuels'] | null; readAt: number } | null = null;
  let pending: { day: string; promise: Promise<HistoryDay['fuels'] | null> } | null = null;

  async function read(day: string): Promise<HistoryDay['fuels'] | null> {
    try {
      const parsed = historyDaySchema.safeParse(await deps.store.getJSON(dayKey(day), 'eventual'));
      if (parsed.success && parsed.data.day === day) return parsed.data.fuels;
      if (!parsed.success) console.error(`${dayKey(day)} has an unexpected shape`);
      return null;
    } catch (error) {
      console.error(`Reading ${dayKey(day)} failed`, error);
      return null;
    }
  }

  return {
    get(day: string): Promise<HistoryDay['fuels'] | null> {
      if (cached?.day === day && (cached.fuels || deps.now() - cached.readAt < RETRY_MS)) {
        return Promise.resolve(cached.fuels);
      }
      // Concurrent requests on one instance share one read.
      if (pending?.day !== day) {
        const promise = read(day).then((fuels) => {
          cached = { day, fuels, readAt: deps.now() };
          if (pending?.promise === promise) pending = null;
          return fuels;
        });
        pending = { day, promise };
      }
      return pending.promise;
    },
  };
}
