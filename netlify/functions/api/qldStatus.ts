import { z } from 'zod';

import { anyCallsRecordSchema, totalCalls } from '../../lib/snapshot/calls';
import { QLD_SNAPSHOT_INTERVAL_MINUTES, QLD_STALE_AFTER_MS } from '../../lib/snapshot/format';
import { brisbaneDay } from '../../lib/upstream/time';

import type { QldSourceStatus } from '../../../shared/api';

/**
 * Queensland's half of /api/status: the QLD job's own run record, the newest
 * snapshot it wrote, its call count and the age of its reference data.
 *
 * Until QLD_PUBLIC is on, these problems are reported here but do not make
 * /api/status unhealthy, so building and running the job dark cannot page
 * the owner (docs/qld-plan.md, "/api/status per source").
 */

/**
 * No quota is published. The schedule needs about 4,560 calls a month; this
 * is about 30% over that, which only a loop or a retry storm reaches.
 */
export const QLD_MONTHLY_ALERT = 6_000;

/** The licence's 24 hours for site details, plus a margin for a failed refresh. */
const REFERENCE_MAX_AGE_MS = 26 * 60 * 60_000;

const lastRunSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
  fetchedAt: z.string().optional(),
  error: z.object({ kind: z.string() }).optional(),
});

const fetchedAtSchema = z.object({ fetchedAt: z.string() }).loose();
const writtenSchema = z.object({ fetchedAt: z.string(), stationCount: z.number() }).loose();

export interface QldStatusInput {
  lastRun: unknown;
  /** Set when the run record could not be read: not the same as "no runs". */
  lastRunError?: string;
  /** The metadata of `qld/snapshot/v1/latest`, or null. */
  written: unknown;
  /** This Brisbane month's `qld/meta/calls/YYYY-MM`, or null. */
  calls: unknown;
  /** The metadata of `qld/reference/v1`, or null. */
  reference: unknown;
}

const minutes = (ms: number) => Math.round(ms / 60_000);

export function qldStatusReport(
  input: QldStatusInput,
  now: number,
  isPublic: boolean,
): QldSourceStatus {
  const problems: string[] = [];
  const parsed = lastRunSchema.safeParse(input.lastRun);
  const lastRun = parsed.success ? parsed.data : null;

  if (input.lastRunError) {
    problems.push('Could not read the last run record.');
  } else if (!lastRun) {
    problems.push('No scheduled run has been recorded.');
  } else {
    if (!lastRun.ok) {
      problems.push(`The last scheduled run failed (${lastRun.error?.kind ?? 'unknown'}).`);
    }
    const sinceRun = now - Date.parse(lastRun.startedAt);
    if (sinceRun > QLD_STALE_AFTER_MS) {
      problems.push(
        `No scheduled run for ${String(minutes(sinceRun))} minutes (expected every ${String(QLD_SNAPSHOT_INTERVAL_MINUTES)}).`,
      );
    }
  }

  const writtenMeta = writtenSchema.safeParse(input.written);
  const written = writtenMeta.success
    ? { fetchedAt: writtenMeta.data.fetchedAt, stations: writtenMeta.data.stationCount }
    : null;
  if (!written) {
    problems.push('No snapshot has been written.');
  } else if (now - Date.parse(written.fetchedAt) > QLD_STALE_AFTER_MS) {
    problems.push(
      `The newest snapshot is ${String(minutes(now - Date.parse(written.fetchedAt)))} minutes old.`,
    );
  }

  const referenceMeta = fetchedAtSchema.safeParse(input.reference);
  const referenceFetchedAt = referenceMeta.success ? referenceMeta.data.fetchedAt : null;
  if (referenceFetchedAt && now - Date.parse(referenceFetchedAt) > REFERENCE_MAX_AGE_MS) {
    const hours = Math.round((now - Date.parse(referenceFetchedAt)) / 3_600_000);
    problems.push(`The site details are ${String(hours)} hours old (the licence allows 24).`);
  }

  const month = brisbaneDay(new Date(now)).slice(0, 7);
  const record = anyCallsRecordSchema.safeParse(input.calls);
  const calls = record.success && record.data.month === month ? totalCalls(record.data) : 0;
  if (calls > QLD_MONTHLY_ALERT) {
    problems.push(
      `${String(calls)} QLD API calls so far in ${month}, over the ${String(QLD_MONTHLY_ALERT)} expected at most.`,
    );
  }

  return {
    healthy: problems.length === 0,
    public: isPublic,
    problems,
    lastRun: lastRun
      ? {
          ok: lastRun.ok,
          startedAt: lastRun.startedAt,
          ...(lastRun.fetchedAt ? { fetchedAt: lastRun.fetchedAt } : {}),
          ...(lastRun.error ? { error: lastRun.error.kind } : {}),
        }
      : null,
    written,
    referenceFetchedAt,
    callsThisMonth: { month, calls, budget: QLD_MONTHLY_ALERT },
  };
}
