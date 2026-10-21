import { buildSnapshot, type BuildStats } from './build';
import { historyDaySchema, historyDayFor, updateHistoryDay } from './history';
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

    const previous = await deps.store.getMetadata(KEYS.snapshot);
    const previousCount = typeof previous?.stationCount === 'number' ? previous.stationCount : 0;
    if (stats.stations < previousCount * MIN_STATION_RATIO) {
      throw new UpstreamError(
        'bad_response',
        `Only ${String(stats.stations)} stations (previous snapshot had ${String(previousCount)}). ` +
          'Keeping the previous snapshot.',
      );
    }

    await deps.store.setJSON(KEYS.snapshot, snapshot, {
      fetchedAt: snapshot.fetchedAt,
      stationCount: stats.stations,
    });

    const dayKey = KEYS.historyDay(historyDayFor(snapshot));
    const existing = historyDaySchema.safeParse(await deps.store.getJSON(dayKey));
    await deps.store.setJSON(
      dayKey,
      updateHistoryDay(existing.success ? existing.data : null, snapshot),
    );

    summary = { ok: true, startedAt, fetchedAt: snapshot.fetchedAt, calls, stats };
  } catch (error) {
    const kind = error instanceof UpstreamError ? error.kind : 'internal';
    const message = error instanceof Error ? error.message : String(error);
    summary = { ok: false, startedAt, calls, error: { kind, message } };
  }

  await deps.store.setJSON(KEYS.lastRun, summary);
  return summary;
}
