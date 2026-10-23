import { z } from 'zod';

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
  /** Set when the run record could not be read at all: not the same as "no runs". */
  lastRunError?: string;
  now: number;
}): StatusResponse {
  const { served, now } = input;
  const parsed = lastRunSchema.safeParse(input.lastRun);
  const lastRun = parsed.success ? parsed.data : null;
  const problems: string[] = [];

  if (input.lastRunError) {
    problems.push(`Could not read the last run record: ${input.lastRunError}`);
  } else if (!lastRun) {
    problems.push('No scheduled run has been recorded.');
  } else {
    if (!lastRun.ok) {
      const { kind = 'unknown', message = '' } = lastRun.error ?? {};
      problems.push(`The last scheduled run failed (${kind}): ${message}`);
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

  return {
    healthy: problems.length === 0,
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
