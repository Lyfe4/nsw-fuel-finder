import { buildSnapshot, type BuildStats } from './build';
import { recordCalls } from './calls';
import { historyDaySchema, historyDayFor, updateHistoryDay } from './history';
import { foldHistory, type FoldResult } from '../history/fold';
import { KEYS } from '../store';
import { createUpstreamClient, type UpstreamDeps } from '../upstream/client';
import { UpstreamError } from '../upstream/errors';

/**
 * If a response has fewer than this share of the previous snapshot's
 * stations, it is treated as a partial upstream response and NOT written:
 * a good snapshot from 30 minutes ago beats half the state missing.
 */
const MIN_STATION_RATIO = 0.5;

export interface RunSummary {
  ok: boolean;
  startedAt: string;
  fetchedAt?: string;
  calls: { token: number; prices: number };
  stats?: BuildStats;
  /** This run's share of folding yesterday into per-station history (see history/fold.ts). */
  history?: FoldResult | { error: string } | null;
  error?: { kind: string; message: string };
}

/**
 * One scheduled run: fetch statewide prices, write the snapshot, fold it into
 * today's history. Writes `meta/last-run` either way, so "why are prices
 * stale?" has an answer in Blobs and not only in the function log.
 */
export async function runSnapshot(deps: UpstreamDeps): Promise<RunSummary> {
  const calls = { token: 0, prices: 0 };
  const startedAt = new Date(deps.now()).toISOString();
  const client = createUpstreamClient({
    ...deps,
    onCall: (what) => {
      calls[what]++;
      deps.onCall?.(what);
    },
  });

  let summary: RunSummary;
  try {
    const upstream = await client.fetchStatewidePrices();
    const { snapshot, stats } = buildSnapshot(upstream, new Date(deps.now()));

    const previous = await deps.store.getMetadata(KEYS.snapshot, 'strong');
    const previousCount = typeof previous?.stationCount === 'number' ? previous.stationCount : 0;
    if (stats.stations < previousCount * MIN_STATION_RATIO) {
      throw new UpstreamError(
        'partial_response',
        `Only ${String(stats.stations)} stations (previous snapshot had ${String(previousCount)}). ` +
          'Keeping the previous snapshot.',
      );
    }

    await deps.store.setJSON(KEYS.snapshot, snapshot, {
      fetchedAt: snapshot.fetchedAt,
      stationCount: stats.stations,
    });

    const dayKey = KEYS.historyDay(historyDayFor(snapshot));
    const existing = historyDaySchema.safeParse(await deps.store.getJSON(dayKey, 'strong'));
    await deps.store.setJSON(
      dayKey,
      updateHistoryDay(existing.success ? existing.data : null, snapshot),
    );

    // After the snapshot is safely written, and never able to fail the run:
    // a missed slice is picked up by the next run.
    const history = await foldHistory(
      deps.store,
      historyDayFor(snapshot),
      snapshot.stations.map((station) => station.code),
    ).catch((error: unknown) => {
      console.error('Folding history failed', error);
      return { error: error instanceof Error ? error.message : String(error) };
    });

    summary = { ok: true, startedAt, fetchedAt: snapshot.fetchedAt, calls, stats, history };
  } catch (error) {
    const kind = error instanceof UpstreamError ? error.kind : 'internal';
    const message = error instanceof Error ? error.message : String(error);
    summary = { ok: false, startedAt, calls, error: { kind, message } };
  }

  await deps.store.setJSON(KEYS.lastRun, summary);
  // Counted whatever happened; a failed count never fails the run.
  await recordCalls(deps.store, new Date(deps.now()), calls).catch((error: unknown) => {
    console.error('Recording the call count failed', error);
  });
  return summary;
}

/**
 * Failures where trying again seconds later can work: a blip on either side.
 * A 5xx from the scheduled function makes Netlify retry it (seen once, 4 s
 * later), which spends another call; the rest return 200 with `ok: false`,
 * so they cost nothing extra and still show in /api/status.
 */
const RETRYABLE = new Set(['unavailable', 'timeout', 'bad_response', 'internal']);

export function worthRetrying(summary: RunSummary): boolean {
  return !summary.ok && RETRYABLE.has(summary.error?.kind ?? 'internal');
}
