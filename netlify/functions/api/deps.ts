import { createPreviousDaySource } from './previousDay';
import { createSnapshotSource } from './snapshotSource';
import { KEYS, QLD_KEYS, type KeyValueStore } from '../../lib/store';
import { brisbaneDay } from '../../lib/upstream/time';

import type { HandlerDeps } from './router';

/**
 * QLD_PUBLIC: Queensland is served only when it is exactly "true". Anything
 * else, unset included, is off (docs/qld-plan.md: nothing from Queensland
 * reaches visitors until publisher approval is confirmed).
 */
export function isQldPublic(env: Record<string, string | undefined>): boolean {
  return env.QLD_PUBLIC === 'true';
}

/**
 * Everything the routes read, over one store. The function builds this once
 * per instance (api.ts), so the snapshot sources keep their parsed copies
 * between requests; tests build it over a memory store.
 *
 * WHAT IS READ FROM QUEENSLAND, while QLD_PUBLIC is off: only `getQldStatus`,
 * which reads the QLD job's run record, call count, and the METADATA of its
 * snapshot and reference data (times and counts, never a price or a
 * station). Nothing else here names a `qld/` key or a `qld-` code; a test
 * (qldExposure.test.ts) checks every route against a store that has them.
 */
export function createApiDeps(
  store: KeyValueStore,
  now: () => number,
  env: Record<string, string | undefined>,
): HandlerDeps {
  const source = createSnapshotSource({ store, now });
  const previousDay = createPreviousDaySource({ store, now });
  return {
    getSnapshot: () => source.get(),
    getLastRun: () => store.getJSON(KEYS.lastRun, 'strong'),
    getCalls: (month) => store.getJSON(KEYS.calls(month), 'strong'),
    // Eventual: history changes once a day, and a minute's lag does not matter.
    getHistory: async (code) => {
      const [backfill, live] = await Promise.all([
        store.getJSON(KEYS.historyBackfill(code), 'eventual'),
        store.getJSON(KEYS.historyLive(code), 'eventual'),
      ]);
      return { backfill, live };
    },
    getDay: (day) => previousDay.get(day),
    // Strong, like NSW's run record: these say whether the QLD job is healthy.
    getQldStatus: async () => {
      const month = brisbaneDay(new Date(now())).slice(0, 7);
      const [lastRun, written, calls, reference] = await Promise.all([
        store.getJSON(QLD_KEYS.lastRun, 'strong'),
        store.getMetadata(QLD_KEYS.snapshot, 'strong'),
        store.getJSON(QLD_KEYS.calls(month), 'strong').catch(() => null),
        store.getMetadata(QLD_KEYS.reference, 'strong').catch(() => null),
      ]);
      return { lastRun, written, calls, reference };
    },
    qldPublic: isQldPublic(env),
    now,
  };
}
