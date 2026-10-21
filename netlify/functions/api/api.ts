/**
 * The Netlify function behind /api/*. See router.ts for the routes and
 * upstream.ts for how API.NSW is called.
 *
 * The client is created once per function instance, at module scope, so its
 * cached OAuth token survives between requests while the instance is warm.
 */
import { randomUUID } from 'node:crypto';

import { createHandler } from './router';
import { createFuelApiClient } from './upstream';

const client = createFuelApiClient({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  randomUUID: () => randomUUID(),
  credentials: () => {
    const apiKey = process.env.FUEL_API_KEY?.trim();
    const apiSecret = process.env.FUEL_API_SECRET?.trim();
    return apiKey && apiSecret ? { apiKey, apiSecret } : null;
  },
});

export default createHandler(client);
