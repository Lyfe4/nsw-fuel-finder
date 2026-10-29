import { z } from 'zod';

import { anyCallsRecordSchema, totalCalls } from '../../lib/snapshot/calls';
import { QLD_SNAPSHOT_INTERVAL_MINUTES, QLD_STALE_AFTER_MS } from '../../lib/snapshot/format';
import { brisbaneDay } from '../../lib/upstream/time';

import type { QldSourceStatus } from '../../../shared/api';

/**
 * Queensland's half of /api/status: the QLD job's own run record, the newest
 * snapshot it wrote, its call count and the age of its reference data.
 *
 * Until Queensland is served (the gate in deps.ts), these problems are
 * reported here, in general words, but do not make /api/status unhealthy,
 * so running the job dark cannot page the owner (docs/qld-plan.md,
 * "/api/status per source"), and nothing else about it is published.
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
  /*
   * Each problem twice: in full for the owner once Queensland is served, and
   * in general words (no counts, no times) while it is not, when /api/status
   * publishes nothing else about it.
   */
  const problems: { full: string; general: string }[] = [];
  const parsed = lastRunSchema.safeParse(input.lastRun);
  const lastRun = parsed.success ? parsed.data : null;

  if (input.lastRunError) {
    const text = 'Could not read the last run record.';
    problems.push({ full: text, general: text });
  } else if (!lastRun) {
    const text = 'No scheduled run has been recorded.';
    problems.push({ full: text, general: text });
  } else {
    if (!lastRun.ok) {
      problems.push({
        full: `The last scheduled run failed (${lastRun.error?.kind ?? 'unknown'}).`,
        general: 'The last scheduled run failed.',
      });
    }
    const sinceRun = now - Date.parse(lastRun.startedAt);
    if (sinceRun > QLD_STALE_AFTER_MS) {
      problems.push({
        full: `No scheduled run for ${String(minutes(sinceRun))} minutes (expected every ${String(QLD_SNAPSHOT_INTERVAL_MINUTES)}).`,
        general: 'The scheduled job has not run recently.',
      });
    }
  }

  const writtenMeta = writtenSchema.safeParse(input.written);
  const written = writtenMeta.success
    ? { fetchedAt: writtenMeta.data.fetchedAt, stations: writtenMeta.data.stationCount }
    : null;
  if (!written) {
    const text = 'No snapshot has been written.';
    problems.push({ full: text, general: text });
  } else if (now - Date.parse(written.fetchedAt) > QLD_STALE_AFTER_MS) {
    problems.push({
      full: `The newest snapshot is ${String(minutes(now - Date.parse(written.fetchedAt)))} minutes old.`,
      general: 'The newest snapshot is out of date.',
    });
  }

  const referenceMeta = fetchedAtSchema.safeParse(input.reference);
  const referenceFetchedAt = referenceMeta.success ? referenceMeta.data.fetchedAt : null;
  if (referenceFetchedAt && now - Date.parse(referenceFetchedAt) > REFERENCE_MAX_AGE_MS) {
    const hours = Math.round((now - Date.parse(referenceFetchedAt)) / 3_600_000);
    problems.push({
      full: `The site details are ${String(hours)} hours old (the licence allows 24).`,
      general: 'The site details are out of date.',
    });
  }

  const month = brisbaneDay(new Date(now)).slice(0, 7);
  const record = anyCallsRecordSchema.safeParse(input.calls);
  const calls = record.success && record.data.month === month ? totalCalls(record.data) : 0;
  if (calls > QLD_MONTHLY_ALERT) {
    problems.push({
      full: `${String(calls)} QLD API calls so far in ${month}, over the ${String(QLD_MONTHLY_ALERT)} expected at most.`,
      general: 'More API calls than expected this month.',
    });
  }

  const healthy = problems.length === 0;
  if (!isPublic) {
    return { healthy, public: false, problems: problems.map((problem) => problem.general) };
  }
  return {
    healthy,
    public: true,
    problems: problems.map((problem) => problem.full),
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
