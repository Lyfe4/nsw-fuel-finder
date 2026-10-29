import { createCombinedSource } from './combinedSource';
import { createPreviousDaySource } from './previousDay';
import { createSnapshotSource } from './snapshotSource';
import { createQldSwitch } from '../../lib/qld/killSwitch';
import { KEYS, QLD_KEYS, type KeyValueStore } from '../../lib/store';
import { brisbaneDay } from '../../lib/upstream/time';

import type { HandlerDeps } from './router';

/**
 * QLD_PUBLIC: the first of the three things that must all hold for the API
 * to serve Queensland, and on only when it is exactly "true". Anything else,
 * unset included, is off (docs/qld-plan.md: nothing from Queensland reaches
 * visitors until publisher approval is confirmed).
 *
 * THE GATE, per request (router.ts, `qldFor`):
 *
 * 1. QLD_PUBLIC is "true". A deploy keeps the value it was built with, so
 *    this alone cannot switch an older deploy off.
 * 2. The request reached the PUBLISHED production deploy
 *    (`context.deploy.published`, read per request). Deploy previews and the
 *    permalinks of older deploys stay reachable at their own addresses, read
 *    the same Blobs, and are never published, so they never serve it.
 * 3. The owner's kill switch in Blobs is on (lib/qld/killSwitch.ts). Every
 *    deploy reads it, so "off" is immediate everywhere, with no redeploy.
 *
 * And a Queensland snapshot older than 25 minutes is never served
 * (combinedSource.ts), whatever the gate says.
 */
export function isQldPublic(env: Record<string, string | undefined>): boolean {
  return env.QLD_PUBLIC === 'true';
}

/**
 * Everything the routes read, over one store. The function builds this once
 * per instance (api.ts), so the snapshot sources keep their parsed copies
 * between requests; tests build it over a memory store.
 *
 * WHAT IS READ FROM QUEENSLAND when the gate is shut: only `getQldStatus`,
 * which reads the QLD job's run record, call count, and the METADATA of its
 * snapshot and reference data (times and counts, never a price or a
 * station), and publishes none of them while it is shut. The kill switch is
 * read only once the first two conditions hold. A test
 * (qldExposure.test.ts) checks every route against a store that has
 * everything, every way the gate can be shut.
 */
export function createApiDeps(
  store: KeyValueStore,
  now: () => number,
  env: Record<string, string | undefined>,
): HandlerDeps {
  const source = createCombinedSource({
    nsw: createSnapshotSource({ store, now }),
    qld: createSnapshotSource({ store, now, key: QLD_KEYS.snapshot }),
    now,
  });
  const previousDay = createPreviousDaySource({ store, now });
  const qldPreviousDay = createPreviousDaySource({ store, now, dayKey: QLD_KEYS.historyDay });
  const qldSwitch = createQldSwitch({ store, now });
  return {
    getSnapshot: (withQld) => source.get(withQld),
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
    getQldDay: (day) => qldPreviousDay.get(day),
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
    qldEnv: isQldPublic(env),
    qldSwitch: () => qldSwitch.isOn(),
    now,
  };
}
