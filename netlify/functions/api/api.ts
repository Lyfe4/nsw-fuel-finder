/**
 * The Netlify function at /api/* (see `config` below). It answers from the price snapshot in
 * Netlify Blobs and never calls API.NSW; netlify/functions/snapshot keeps the
 * snapshot fresh. See router.ts for the routes.
 *
 * The snapshot source lives at module scope, so a warm instance keeps its
 * parsed copy between requests.
 */
import { createPreviousDaySource } from './previousDay';
import { createHandler } from './router';
import { createSnapshotSource } from './snapshotSource';
import { blobStore, KEYS } from '../../lib/store';

const now = () => Date.now();
const store = blobStore();
const source = createSnapshotSource({ store, now });
const previousDay = createPreviousDaySource({ store, now });

export default createHandler({
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
  now,
});

/*
 * ROUTING AND RATE LIMIT, read by Netlify from the source (keep them literals).
 *
 * `path` makes /api/* this function's only address: with a custom path it is
 * no longer served at /.netlify/functions/api, so nothing can reach it
 * around the limit below. (It replaces the /api/* rewrite netlify.toml had.)
 *
 * The limit: 120 requests a minute per IP address, counted at Netlify's edge
 * before the function runs, then 429. Generous on purpose: Australian mobile
 * carriers put many customers behind one address (CGNAT), and one person's
 * search is a handful of requests (suggestions while typing, then prices).
 * It does not stop a determined attacker with many addresses; it stops one
 * machine spending the team's monthly invocations in an afternoon. Legacy
 * Free allows two code-based rules per site; this is the only one.
 */
export const config = {
  path: '/api/*',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
