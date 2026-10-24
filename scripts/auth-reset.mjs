/**
 * The deliberate, human reset of the lockout guard (netlify/lib/upstream/client.ts).
 *
 *   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... pnpm auth:reset
 *
 * After API.NSW refuses our credentials once, or two token requests in a row
 * go unanswered, the scheduled job stops calling API.NSW until this is run.
 * API.NSW locks the account after three consecutive failed sign-ins, and the
 * job may already have made two, so FIRST find and fix the cause:
 *
 *   1. Read `/api/status` and `netlify logs --function snapshot`.
 *   2. Check the key and secret against the app on api.nsw.gov.au, and that
 *      the app is still subscribed to the Fuel API.
 *   3. Only then reset. The next scheduled run tries once.
 *
 * This shows the record, then deletes `auth/failure` from the PRODUCTION
 * store only if you type `reset`. It makes no API.NSW call. Use a personal
 * access token with a short expiry (User settings > Applications), and
 * revoke it afterwards.
 */
import { createInterface } from 'node:readline/promises';

const STORE = 'fuel-finder';
const KEY = 'auth/failure';

/**
 * Returns the exit code. Set through process.exitCode rather than
 * process.exit(), which crashes Node on Windows with readline just closed.
 */
async function main() {
  const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
  if (!siteID || !token) {
    console.error('auth:reset needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment.');
    return 1;
  }

  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: STORE, siteID, token });
  const record = await store.get(KEY, { type: 'json', consistency: 'strong' });

  if (record === null) {
    console.log('There is no auth/failure record: the guard is not stopping anything.');
    return 0;
  }

  console.log('The current auth/failure record:');
  console.log(JSON.stringify(record, null, 2));
  if (typeof record.lastAt === 'number') {
    console.log(`Last written ${new Date(record.lastAt).toISOString()}.`);
  }
  console.log('Deleting it lets the next scheduled run (every 30 minutes) try API.NSW once.');
  console.log('If the cause is not fixed, that try may be a failure API.NSW counts.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "reset" to delete it, anything else to leave it: ');
  rl.close();

  if (answer.trim() !== 'reset') {
    console.log('Left as it is.');
    return 0;
  }
  await store.delete(KEY);
  const after = await store.get(KEY, { type: 'json', consistency: 'strong' });
  console.log(after === null ? 'Deleted.' : 'Delete did not take: the record is still there.');
  return after === null ? 0 : 1;
}

process.exitCode = await main();
