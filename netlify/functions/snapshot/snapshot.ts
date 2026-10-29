/**
 * The scheduled job: every 30 minutes, fetch statewide prices from API.NSW
 * into Netlify Blobs. The only code that calls API.NSW. See
 * netlify/lib/snapshot/run.ts for what a run does and docs/decisions.md for
 * why every 30 minutes.
 *
 * Netlify does not expose scheduled functions at a public URL in production.
 * Locally: `netlify dev`, then `netlify functions:invoke snapshot`.
 */
import { randomUUID } from 'node:crypto';

import { runsIn, type InvocationContext } from '../../lib/snapshot/context';
import { runSnapshot, worthRetrying } from '../../lib/snapshot/run';
import { blobStore } from '../../lib/store';

export { runsIn };

export default async (_request: Request, context?: InvocationContext): Promise<Response> => {
  if (!runsIn(context)) {
    const message = `Not run: the snapshot job runs in production only (this is a ${String(context?.deploy?.context)}).`;
    console.info(message);
    return new Response(JSON.stringify({ ok: false, skipped: message }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = await runSnapshot({
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    randomUUID: () => randomUUID(),
    store: blobStore(),
    credentials: () => {
      const apiKey = process.env.FUEL_API_KEY?.trim();
      const apiSecret = process.env.FUEL_API_SECRET?.trim();
      return apiKey && apiSecret ? { apiKey, apiSecret } : null;
    },
  });

  // One line per run in the function log, success or not.
  if (summary.ok) console.info('snapshot ok', JSON.stringify(summary));
  else console.error('snapshot failed', JSON.stringify(summary));

  // 502 asks Netlify to run it again; only for a failure a retry can fix.
  return new Response(JSON.stringify(summary), {
    status: worthRetrying(summary) ? 502 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/*
 * Must be a string literal: Netlify reads it from the source without running
 * it. Cron is UTC. A test checks it matches SNAPSHOT_INTERVAL_MINUTES.
 */
export const config = {
  schedule: '*/30 * * * *',
};
