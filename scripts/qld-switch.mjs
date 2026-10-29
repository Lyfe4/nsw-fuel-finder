/**
 * The owner's kill switch for serving Queensland (netlify/lib/qld/killSwitch.ts).
 *
 *   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... pnpm qld:switch          (show it)
 *   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... pnpm qld:switch off      (stop serving)
 *   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... pnpm qld:switch on       (serve)
 *
 * The API serves Queensland only when all three hold: QLD_PUBLIC is "true"
 * on the deploy, the request reached the published production deploy, and
 * this switch is on. Every deploy reads the switch, so "off" stops
 * Queensland everywhere within about two minutes (15 s in each warm API
 * instance, then the CDN's minute or two), old deploys included, with no
 * redeploy. Missing or unreadable reads as off.
 *
 * "on" only after publisher approval is confirmed in writing (docs/qld-plan.md,
 * phase 0). It writes `config/qld-enabled` to the PRODUCTION store, only after
 * you type the word asked for. It makes no QLD API call. Use a personal
 * access token with a short expiry (User settings > Applications), and
 * revoke it afterwards. The README's Maintenance section has the whole
 * on/off procedure.
 */
import { createInterface } from 'node:readline/promises';

const STORE = 'fuel-finder';
const KEY = 'config/qld-enabled';

/**
 * Returns the exit code. Set through process.exitCode rather than
 * process.exit(), which crashes Node on Windows with readline just closed.
 */
async function main() {
  const wanted = process.argv[2];
  if (wanted !== undefined && wanted !== 'on' && wanted !== 'off') {
    console.error('Usage: pnpm qld:switch [on|off]');
    return 1;
  }
  const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
  if (!siteID || !token) {
    console.error('qld:switch needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment.');
    return 1;
  }

  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: STORE, siteID, token });
  const record = await store.get(KEY, { type: 'json', consistency: 'strong' });
  const isOn = record !== null && record.version === 1 && record.enabled === true;

  console.log(
    record === null
      ? `There is no ${KEY} record: the switch is OFF.`
      : `The current ${KEY} record (the switch is ${isOn ? 'ON' : 'OFF'}):\n${JSON.stringify(record, null, 2)}`,
  );
  if (wanted === undefined) return 0;
  if ((wanted === 'on') === isOn) {
    console.log(`It is already ${wanted.toUpperCase()}. Nothing to do.`);
    return 0;
  }

  if (wanted === 'on') {
    console.log(
      'Switching ON serves Queensland prices on the published production deploy, if it was ' +
        'built with QLD_PUBLIC=true. Only do this with publisher approval confirmed in writing.',
    );
  } else {
    console.log(
      'Switching OFF takes Queensland out of every deploy within about two minutes. The QLD job ' +
        'keeps fetching; if the licence has ended, also remove QLD_FPD_TOKEN (README, Maintenance).',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Type "${wanted}" to switch it ${wanted}, anything else to leave it: `,
  );
  rl.close();

  if (answer.trim() !== wanted) {
    console.log('Left as it is.');
    return 0;
  }
  const enabled = wanted === 'on';
  await store.setJSON(KEY, { version: 1, enabled, changedAt: new Date().toISOString() });
  const after = await store.get(KEY, { type: 'json', consistency: 'strong' });
  const took = after !== null && after.enabled === enabled;
  console.log(
    took ? `Switched ${wanted.toUpperCase()}.` : 'The write did not take: check the record.',
  );
  return took ? 0 : 1;
}

process.exitCode = await main();
