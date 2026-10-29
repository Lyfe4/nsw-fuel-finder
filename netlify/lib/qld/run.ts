import { z } from 'zod';

import { buildQldSnapshot, buildReference, qldReferenceSchema, type QldBuildStats } from './build';
import { createQldClient, type QldDeps } from './client';
import { runSource, type RunSummary } from '../snapshot/run';
import { QLD_KEYS } from '../store';
import { UpstreamError } from '../upstream/errors';
import { brisbaneDay } from '../upstream/time';

/**
 * Refresh the reference data once it is this old. Under 24 hours, so a run
 * every 10 minutes keeps every site's name, brand and address within the
 * licence's 24 hours (clause 2.3): about 3 calls a day.
 */
export const REFERENCE_REFRESH_MS = 23 * 60 * 60_000;

/**
 * The first Brisbane day Queensland's daily history can exist for. The fold
 * looks for nothing before it; a day after it with no file (the job not yet
 * running in production) is simply skipped.
 */
export const QLD_HISTORY_START = '2026-10-30';

export interface QldCalls {
  reference: number;
  prices: number;
}
export type QldRunSummary = RunSummary<QldBuildStats, QldCalls>;

/** After a failed refresh of the reference data, how long before the next try. */
export const REFERENCE_RETRY_MS = 60 * 60_000;

/** A refreshed reference with fewer than this share of the stored sites is refused. */
const MIN_SITE_RATIO = 0.5;

const referenceAttemptSchema = z.object({
  version: z.literal(1),
  at: z.number(),
  kind: z.string(),
});

/** These stop the run even when an older copy of the reference data could be used. */
const STOPPING = new Set(['not_configured', 'credentials_rejected', 'credentials_locked']);

/**
 * One scheduled Queensland run: refresh the reference data if it is due,
 * fetch every price, write `qld/snapshot/v1/latest` and Queensland's own
 * history and records. Shares nothing it writes with the NSW job.
 */
export async function runQldSnapshot(deps: QldDeps): Promise<QldRunSummary> {
  const calls: QldCalls = { reference: 0, prices: 0 };
  const client = createQldClient({
    ...deps,
    onCall: (what) => {
      calls[what]++;
      deps.onCall?.(what);
    },
  });

  async function reference() {
    const stored = qldReferenceSchema.safeParse(
      await deps.store.getJSON(QLD_KEYS.reference, 'strong'),
    );
    const current = stored.success ? stored.data : null;
    if (current && deps.now() - Date.parse(current.fetchedAt) < REFERENCE_REFRESH_MS) {
      return { reference: current, status: { fetchedAt: current.fetchedAt, refreshed: false } };
    }
    const keep = (kind: string) => {
      if (!current) {
        throw new UpstreamError(
          'backing_off',
          'reference: the last refresh failed under an hour ago, and there is no stored copy',
        );
      }
      return {
        reference: current,
        status: { fetchedAt: current.fetchedAt, refreshed: false, error: kind },
      };
    };

    // A refresh that failed under an hour ago is not tried again yet (round
    // 16): the manual asks for reference data once a day, and a refresh that
    // kept failing used to cost three calls every run.
    const attempt = referenceAttemptSchema.safeParse(
      await deps.store.getJSON(QLD_KEYS.referenceAttempt, 'strong'),
    );
    if (attempt.success && deps.now() - attempt.data.at < REFERENCE_RETRY_MS) {
      return keep('backing_off');
    }

    try {
      const { reference: fresh, stats } = buildReference(
        await client.fetchReference(),
        new Date(deps.now()),
      );
      if (stats.sites === 0) throw new UpstreamError('bad_response', 'reference: no sites');
      // A thin answer would be kept for a day and leave most stations out of
      // every snapshot, which the partial guard would then refuse.
      const storedSites = current ? Object.keys(current.sites).length : 0;
      if (stats.sites < storedSites * MIN_SITE_RATIO) {
        throw new UpstreamError(
          'partial_response',
          `reference: only ${String(stats.sites)} sites (the stored copy has ${String(storedSites)})`,
        );
      }
      await deps.store.setJSON(QLD_KEYS.reference, fresh, {
        fetchedAt: fresh.fetchedAt,
        siteCount: stats.sites,
      });
      return { reference: fresh, status: { fetchedAt: fresh.fetchedAt, refreshed: true } };
    } catch (error) {
      // The token itself is the problem: stop, as any call would.
      const kind = error instanceof UpstreamError ? error.kind : 'internal';
      if (STOPPING.has(kind)) throw error;
      // Otherwise wait an hour before the next try. An older copy still serves
      // the run; without one, this run fails and the next ones wait.
      await deps.store
        .setJSON(QLD_KEYS.referenceAttempt, { version: 1, at: deps.now(), kind })
        .catch((writeError: unknown) => {
          console.error('Recording the failed reference refresh failed', writeError);
        });
      if (!current) throw error;
      console.error('Refreshing the QLD reference data failed; using the stored copy', error);
      return keep(kind);
    }
  }

  return runSource(
    {
      keys: { ...QLD_KEYS, start: QLD_HISTORY_START },
      dayOf: brisbaneDay,
      calls,
      fetch: async () => {
        const { reference: data, status } = await reference();
        const prices = await client.fetchPrices();
        return buildQldSnapshot(data, prices, new Date(deps.now()), status);
      },
    },
    deps,
  );
}
