import { z } from 'zod';

import {
  callsRecordSchema,
  MONTHLY_BUDGET,
  MONTHLY_QUOTA,
  sydneyMonth,
} from '../../lib/snapshot/calls';
import {
  SNAPSHOT_INTERVAL_MINUTES,
  STALE_AFTER_MS,
  type Snapshot,
} from '../../lib/snapshot/format';

import type { StatusResponse } from '../../../shared/api';

/**
 * GET /api/status: is the data pipeline healthy, end to end?
 *
 * Exists because of the 2026-10-23 stall, which nothing reported: the job
 * logged "snapshot ok" every 30 minutes while the API served a copy over an
 * hour old. This compares what the API is SERVING with what the last run
 * WROTE (read with strong consistency), so that failure - and a failing or
 * stopped job - shows up as a 503 a browser or a free uptime monitor can see.
 */

/** A run has written a newer snapshot than the API serves, for longer than this. */
const SERVING_LAG_MS = 5 * 60_000;

const lastRunSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
  fetchedAt: z.string().optional(),
  error: z.object({ kind: z.string(), message: z.string() }).optional(),
});

const minutes = (ms: number) => Math.round(ms / 60_000);

export function statusReport(input: {
  served: Snapshot | null;
  lastRun: unknown;
  /**
   * Set when the run record could not be read at all: not the same as "no
   * runs". Logged by the caller; never published, as it can carry internals.
   */
  lastRunError?: string;
  /** This month's `meta/calls/YYYY-MM` record, or null. */
  calls?: unknown;
  now: number;
}): StatusResponse {
  const { served, now } = input;
  const parsed = lastRunSchema.safeParse(input.lastRun);
  const lastRun = parsed.success ? parsed.data : null;
  const problems: string[] = [];

  if (input.lastRunError) {
    problems.push('Could not read the last run record.');
  } else if (!lastRun) {
    problems.push('No scheduled run has been recorded.');
  } else {
    // The kind only. The message stays in meta/last-run and the function log.
    if (!lastRun.ok) {
      problems.push(`The last scheduled run failed (${lastRun.error?.kind ?? 'unknown'}).`);
    }
    const sinceRun = now - Date.parse(lastRun.startedAt);
    if (sinceRun > STALE_AFTER_MS) {
      problems.push(
        `No scheduled run for ${String(minutes(sinceRun))} minutes (expected every ${String(SNAPSHOT_INTERVAL_MINUTES)}).`,
      );
    }
  }

  if (!served) {
    problems.push('The API has no snapshot to serve.');
  } else {
    const servedAt = Date.parse(served.fetchedAt);
    if (lastRun?.ok && lastRun.fetchedAt) {
      const writtenAt = Date.parse(lastRun.fetchedAt);
      if (writtenAt > servedAt && now - writtenAt > SERVING_LAG_MS) {
        problems.push(
          `The API is serving the snapshot from ${served.fetchedAt}, but a newer one was written ${String(minutes(now - writtenAt))} minutes ago (${lastRun.fetchedAt}).`,
        );
      }
    }
    if (now - servedAt > STALE_AFTER_MS) {
      problems.push(`The snapshot being served is ${String(minutes(now - servedAt))} minutes old.`);
    }
  }

  const month = sydneyMonth(new Date(now));
  const record = callsRecordSchema.safeParse(input.calls);
  const calls = record.success && record.data.month === month ? record.data : null;
  const callCount = calls ? calls.token + calls.prices : 0;
  if (callCount > MONTHLY_BUDGET) {
    problems.push(
      `${String(callCount)} API.NSW calls so far in ${month}, over the ${String(MONTHLY_BUDGET)} planned (the quota is ${String(MONTHLY_QUOTA)}).`,
    );
  }

  return {
    healthy: problems.length === 0,
    callsThisMonth: { month, calls: callCount, budget: MONTHLY_BUDGET },
    problems,
    checkedAt: new Date(now).toISOString(),
    served: served ? { fetchedAt: served.fetchedAt, stations: served.stations.length } : null,
    lastRun: lastRun
      ? {
          ok: lastRun.ok,
          startedAt: lastRun.startedAt,
          ...(lastRun.fetchedAt ? { fetchedAt: lastRun.fetchedAt } : {}),
          ...(lastRun.error ? { error: lastRun.error.kind } : {}),
        }
      : null,
  };
}
