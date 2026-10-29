// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createQldClient, qldAuthFailureSchema } from './client';
import { fakeQld, QLD_TEST_TOKEN } from '../__fixtures__/fakeQld';
import { jsonResponse } from '../__fixtures__/fakeUpstream';
import { memoryStore, QLD_KEYS } from '../store';
import { UpstreamError } from '../upstream/errors';

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const refused = (status: number) => () => new Response('', { status });

async function failure(promise: Promise<unknown>): Promise<UpstreamError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof UpstreamError))
    throw new Error(`expected an UpstreamError, got ${String(error)}`);
  return error;
}

describe('the QLD client', () => {
  it('sends the token in the documented header, to Queensland', async () => {
    const fake = fakeQld();
    await createQldClient(fake.deps).fetchPrices();
    const [call] = fake.callsTo('prices');
    expect(call?.headers.authorization).toBe(`FPDAPI SubscriberToken=${QLD_TEST_TOKEN}`);
    expect(call?.search).toBe('?countryId=21&geoRegionLevel=3&geoRegionId=1');
  });

  it('makes three reference calls, counted as such', async () => {
    const fake = fakeQld();
    const onCall = vi.fn();
    const reference = await createQldClient({ ...fake.deps, onCall }).fetchReference();
    expect(reference.sites).toHaveLength(5);
    expect(onCall.mock.calls).toEqual([['reference'], ['reference'], ['reference']]);
  });

  it.each([null, '', 'not-a-guid'])('calls nothing without a usable token (%j)', async (token) => {
    const fake = fakeQld({}, undefined, token);
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe('not_configured');
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])('stops for good after a %i, until a person resets it', async (status) => {
    const { store } = memoryStore();
    const fake = fakeQld({ prices: [refused(status)] }, store);
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe(
      'credentials_rejected',
    );
    expect(
      qldAuthFailureSchema.parse(await store.getJSON(QLD_KEYS.authFailure, 'strong')),
    ).toMatchObject({ rejected: true });

    const later = fakeQld({}, store);
    expect((await failure(createQldClient(later.deps).fetchPrices())).kind).toBe(
      'credentials_locked',
    );
    expect(later.fetch).not.toHaveBeenCalled();
  });

  it('lets a new token try', async () => {
    const { store } = memoryStore();
    await failure(createQldClient(fakeQld({ prices: [refused(401)] }, store).deps).fetchPrices());
    const replaced = fakeQld({}, store, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    await createQldClient(replaced.deps).fetchPrices();
    expect(replaced.callsTo('prices')).toHaveLength(1);
  });

  it('treats a guard record it cannot read as stopping', async () => {
    const { store } = memoryStore({ [QLD_KEYS.authFailure]: { something: 'else' } });
    const fake = fakeQld({}, store);
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe(
      'credentials_locked',
    );
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [500, 'unavailable'],
    [429, 'rate_limited'],
    [400, 'request_rejected'],
  ])('maps HTTP %i to %s, without stopping', async (status, kind) => {
    const { store } = memoryStore();
    const fake = fakeQld({ prices: [refused(status)] }, store);
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe(kind);
    expect(await store.getJSON(QLD_KEYS.authFailure, 'strong')).toBeNull();
  });

  it('calls an unexpected body a bad response', async () => {
    const fake = fakeQld({ prices: [() => jsonResponse({ Prices: [] })] });
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe('bad_response');
  });

  it('calls a request that never answers a timeout', async () => {
    const fake = fakeQld({
      prices: [
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      ],
    });
    expect((await failure(createQldClient(fake.deps).fetchPrices())).kind).toBe('timeout');
  });

  it('never puts the token in an error, a log line or the guard record', async () => {
    const { store } = memoryStore();
    const outcomes = [
      refused(401),
      refused(500),
      () => jsonResponse({ nope: true }),
      () => {
        throw new Error(`connection reset while sending ${QLD_TEST_TOKEN}`);
      },
    ];
    const seen: string[] = [];
    for (const outcome of outcomes) {
      await store.delete(QLD_KEYS.authFailure);
      const error = await failure(
        createQldClient(fakeQld({ prices: [outcome] }, store).deps).fetchPrices(),
      );
      seen.push(error.message, JSON.stringify(await store.getJSON(QLD_KEYS.authFailure, 'strong')));
    }
    seen.push(JSON.stringify(errors.mock.calls));
    for (const text of seen) expect(text).not.toContain(QLD_TEST_TOKEN);
  });
});
