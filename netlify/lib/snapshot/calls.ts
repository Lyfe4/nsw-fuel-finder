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

/** Adds one run's calls to its month's record. */
export async function recordCalls(
  store: KeyValueStore,
  at: Date,
  calls: { token: number; prices: number },
): Promise<CallsRecord> {
  const month = sydneyMonth(at);
  const parsed = callsRecordSchema.safeParse(await store.getJSON(KEYS.calls(month), 'strong'));
  const previous = parsed.success && parsed.data.month === month ? parsed.data : null;
  const next: CallsRecord = {
    version: 1,
    month,
    token: (previous?.token ?? 0) + calls.token,
    prices: (previous?.prices ?? 0) + calls.prices,
    runs: (previous?.runs ?? 0) + 1,
  };
  await store.setJSON(KEYS.calls(month), next);
  return next;
}
