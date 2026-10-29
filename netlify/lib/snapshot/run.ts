import { buildSnapshot, type BuildStats } from './build';
import { addCalls } from './calls';
import { historyDaySchema, historyDayFor, updateHistoryDay } from './history';
import { foldHistory, type FoldKeys, type FoldResult } from '../history/fold';
import { LIVE_HISTORY_START } from '../history/stationHistory';
import { KEYS, type KeyValueStore } from '../store';
import { createUpstreamClient, type UpstreamDeps } from '../upstream/client';
import { UpstreamError } from '../upstream/errors';
import { sydneyDay } from '../upstream/time';

import type { Snapshot } from './format';

/**
 * If a response has fewer than this share of the previous snapshot's
 * stations, it is treated as a partial upstream response and NOT written:
 * a good snapshot from 30 minutes ago beats half the state missing.
 */
const MIN_STATION_RATIO = 0.5;

export interface RunSummary<Stats = BuildStats, Calls = { token: number; prices: number }> {
  ok: boolean;
  startedAt: string;
  fetchedAt?: string;
  calls: Calls;
  stats?: Stats;
  /** This run's share of folding yesterday into per-station history (see history/fold.ts). */
  history?: FoldResult | { error: string } | null;
  error?: { kind: string; message: string };
}

/**
 * One data source's scheduled run, as `runSource` needs it. Each source has
 * its own keys, so one source's failure, retry or lockout never touches
 * another's (docs/qld-plan.md, "Fit with the architecture").
 */
export interface SnapshotSource<Stats extends { stations: number }, Calls extends object> {
  keys: FoldKeys & {
    snapshot: string;
    lastRun: string;
    calls: (month: string) => string;
  };
  /** The source's calendar day at an instant: its history days and call months. */
  dayOf: (instant: Date) => string;
  /** This run's call counts, which `fetch` adds to as it calls upstream. */
  calls: Calls;
  /** Calls upstream and builds the snapshot. Throws an UpstreamError on failure. */
  fetch: () => Promise<{ snapshot: Snapshot; stats: Stats }>;
}

/**
 * One scheduled run of one source: fetch, write the snapshot, fold it into
 * today's history. Writes the source's last-run record either way, so "why
 * are prices stale?" has an answer in Blobs and not only in the function log.
 */
export async function runSource<Stats extends { stations: number }, Calls extends object>(
  source: SnapshotSource<Stats, Calls>,
  deps: { store: KeyValueStore; now: () => number },
): Promise<RunSummary<Stats, Calls>> {
  const { keys, calls } = source;
  const startedAt = new Date(deps.now()).toISOString();

  let summary: RunSummary<Stats, Calls>;
  try {
    const { snapshot, stats } = await source.fetch();

    const previous = await deps.store.getMetadata(keys.snapshot, 'strong');
    const previousCount = typeof previous?.stationCount === 'number' ? previous.stationCount : 0;
    if (stats.stations < previousCount * MIN_STATION_RATIO) {
      throw new UpstreamError(
        'partial_response',
        `Only ${String(stats.stations)} stations (previous snapshot had ${String(previousCount)}). ` +
          'Keeping the previous snapshot.',
      );
    }

    await deps.store.setJSON(keys.snapshot, snapshot, {
      fetchedAt: snapshot.fetchedAt,
      stationCount: stats.stations,
    });

    const today = historyDayFor(snapshot, source.dayOf);
    const dayKey = keys.historyDay(today);
    const existing = historyDaySchema.safeParse(await deps.store.getJSON(dayKey, 'strong'));
    await deps.store.setJSON(
      dayKey,
      updateHistoryDay(existing.success ? existing.data : null, snapshot, source.dayOf),
    );

    // After the snapshot is safely written, and never able to fail the run:
    // a missed slice is picked up by the next run.
    const history = await foldHistory(
      deps.store,
      today,
      snapshot.stations.map((station) => station.code),
      keys,
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

  await deps.store.setJSON(keys.lastRun, summary);
  // Counted whatever happened; a failed count never fails the run.
  const month = source.dayOf(new Date(deps.now())).slice(0, 7);
  await addCalls(deps.store, keys.calls(month), month, calls as Record<string, number>).catch(
    (error: unknown) => {
      console.error('Recording the call count failed', error);
    },
  );
  return summary;
}

/**
 * NSW's run: fetch statewide prices from API.NSW, with its keys as they have
 * always been.
 */
export async function runSnapshot(deps: UpstreamDeps): Promise<RunSummary> {
  const calls = { token: 0, prices: 0 };
  const client = createUpstreamClient({
    ...deps,
    onCall: (what) => {
      calls[what]++;
      deps.onCall?.(what);
    },
  });
  return runSource(
    {
      keys: {
        snapshot: KEYS.snapshot,
        lastRun: KEYS.lastRun,
        calls: KEYS.calls,
        historyDay: KEYS.historyDay,
        historyProgress: KEYS.historyProgress,
        start: LIVE_HISTORY_START,
      },
      dayOf: sydneyDay,
      calls,
      fetch: async () => buildSnapshot(await client.fetchStatewidePrices(), new Date(deps.now())),
    },
    deps,
  );
}

/**
 * Failures where trying again seconds later can work: a blip on either side.
 * A 5xx from the scheduled function makes Netlify retry it (seen once, 4 s
 * later), which spends another call; the rest return 200 with `ok: false`,
 * so they cost nothing extra and still show in /api/status.
 */
const RETRYABLE = new Set(['unavailable', 'timeout', 'bad_response', 'internal']);

export function worthRetrying(summary: { ok: boolean; error?: { kind: string } }): boolean {
  return !summary.ok && RETRYABLE.has(summary.error?.kind ?? 'internal');
}
