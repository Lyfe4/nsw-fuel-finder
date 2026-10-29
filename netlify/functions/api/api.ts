/**
 * The Netlify function at /api/* (see `config` below). It answers from the price snapshot in
 * Netlify Blobs and never calls API.NSW; netlify/functions/snapshot keeps the
 * snapshot fresh. See router.ts for the routes.
 *
 * The snapshot source lives at module scope (in the deps built here once), so
 * a warm instance keeps its parsed copy between requests. What the routes
 * read is in deps.ts.
 */
import { createApiDeps } from './deps';
import { createHandler } from './router';
import { blobStore } from '../../lib/store';

export default createHandler(createApiDeps(blobStore(), () => Date.now(), process.env));

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
