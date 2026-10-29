import { z } from 'zod';

import { KEYS, type KeyValueStore } from '../store';
import { sydneyDay } from '../upstream/time';

/**
 * API.NSW CALLS THIS MONTH, counted by us. The quota (2,500 a month) is only
 * visible on the API.NSW dashboard; this is what /api/status reports, so a
 * leak (a retry loop, a schedule change) is seen within days.
 *
 * `meta/calls/YYYY-MM`, by Sydney month. Written by the scheduled job after
 * every run, successful or not. Runs never overlap (a retry starts after the
 * failed run has returned), so a read-modify-write is safe.
 */
export const MONTHLY_QUOTA = 2_500;
/** What the schedule is planned to fit in, with headroom (docs/api-notes.md, "Call budget"). */
export const MONTHLY_BUDGET = 2_000;

export const callsRecordSchema = z.object({
  version: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  token: z.number().int().min(0),
  prices: z.number().int().min(0),
  runs: z.number().int().min(0),
});
export type CallsRecord = z.infer<typeof callsRecordSchema>;

export function sydneyMonth(at: Date): string {
  return sydneyDay(at).slice(0, 7);
}

/**
 * Any source's record: the month, the runs, and a count per kind of call
 * (`token` and `prices` for API.NSW, `reference` and `prices` for Queensland).
 */
export const anyCallsRecordSchema = z
  .object({
    version: z.literal(1),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    runs: z.number().int().min(0),
  })
  .catchall(z.number().int().min(0));

/** Every call in a record, whatever its kinds. */
export function totalCalls(record: z.infer<typeof anyCallsRecordSchema>): number {
  return Object.entries(record)
    .filter(([field]) => field !== 'version' && field !== 'month' && field !== 'runs')
    .reduce((sum, [, count]) => sum + (typeof count === 'number' ? count : 0), 0);
}

/**
 * Adds one run's calls to the record at `key` for `month`. Runs of one source
 * never overlap (a retry starts after the failed run has returned), and each
 * source has its own key, so a read-modify-write is safe.
 */
export async function addCalls(
  store: KeyValueStore,
  key: string,
  month: string,
  calls: Record<string, number>,
): Promise<Record<string, number | string>> {
  const parsed = anyCallsRecordSchema.safeParse(await store.getJSON(key, 'strong'));
  const previous: Record<string, unknown> =
    parsed.success && parsed.data.month === month ? parsed.data : {};
  const next: Record<string, number | string> = {
    version: 1,
    month,
    runs: (typeof previous.runs === 'number' ? previous.runs : 0) + 1,
  };
  for (const [what, count] of Object.entries(calls)) {
    const before = previous[what];
    next[what] = (typeof before === 'number' ? before : 0) + count;
  }
  await store.setJSON(key, next);
  return next;
}

/** Adds one NSW run's calls to its Sydney month's record. */
export async function recordCalls(
  store: KeyValueStore,
  at: Date,
  calls: { token: number; prices: number },
): Promise<CallsRecord> {
  const month = sydneyMonth(at);
  return callsRecordSchema.parse(await addCalls(store, KEYS.calls(month), month, calls));
}
