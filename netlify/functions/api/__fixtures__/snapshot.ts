import { FIXTURE_FETCHED_AT } from '../../../lib/__fixtures__/fakeUpstream';
import prices from '../../../lib/__fixtures__/prices.json';
import { buildSnapshot } from '../../../lib/snapshot/build';
import { statewidePricesSchema } from '../../../lib/upstream/schemas';

/** A snapshot built from the recorded live response, as the scheduled job would. */
export const fixtureSnapshot = buildSnapshot(
  statewidePricesSchema.parse(prices),
  new Date(FIXTURE_FETCHED_AT),
).snapshot;

export { FIXTURE_FETCHED_AT };
