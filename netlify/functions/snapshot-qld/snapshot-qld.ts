/**
 * Queensland's scheduled job: every 10 minutes, fetch every Queensland price
 * from the Fuel Prices Qld API into Netlify Blobs, under `qld/`. The only
 * code that calls that API. Separate from the NSW job (snapshot.ts) so that
 * neither's failure, retry or lockout can touch the other: see
 * netlify/lib/qld/run.ts and docs/qld-plan.md.
 *
 * Writing the data is not publishing it: the API serves Queensland only
 * when QLD_PUBLIC is on (docs/qld-plan.md, "What has to happen before QLD
 * prices go public").
 *
 * Locally: `netlify dev`, then `netlify functions:invoke snapshot-qld`. Each
 * run makes real calls with the real token.
 */
import { runQldSnapshot } from '../../lib/qld/run';
import { runsIn, type InvocationContext } from '../../lib/snapshot/context';
import { worthRetrying } from '../../lib/snapshot/run';
import { blobStore } from '../../lib/store';

export default async (_request: Request, context?: InvocationContext): Promise<Response> => {
  if (!runsIn(context)) {
    const message = `Not run: the QLD snapshot job runs in production only (this is a ${String(context?.deploy?.context)}).`;
    console.info(message);
    return new Response(JSON.stringify({ ok: false, skipped: message }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = await runQldSnapshot({
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    store: blobStore(),
    token: () => process.env.QLD_FPD_TOKEN ?? null,
  });

  // One line per run in the function log, success or not. Never the token.
  if (summary.ok) console.info('qld snapshot ok', JSON.stringify(summary));
  else console.error('qld snapshot failed', JSON.stringify(summary));

  // 502 asks Netlify to run it again; only for a failure a retry can fix.
  return new Response(JSON.stringify(summary), {
    status: worthRetrying(summary) ? 502 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/*
 * Must be a string literal: Netlify reads it from the source without running
 * it. Cron is UTC. A test checks it matches QLD_SNAPSHOT_INTERVAL_MINUTES.
 */
export const config = {
  schedule: '*/10 * * * *',
};
