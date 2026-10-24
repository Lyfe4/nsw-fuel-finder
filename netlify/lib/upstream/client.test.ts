// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpstreamClient } from './client';
import { UpstreamError } from './errors';
import { fakeUpstream, jsonResponse } from '../__fixtures__/fakeUpstream';
import token from '../__fixtures__/token.json';
import { KEYS, memoryStore } from '../store';

const HOUR = 60 * 60_000;
const refused = () =>
  jsonResponse({ ErrorCode: 'invalid_client', Error: 'Client credentials are invalid' }, 401);

async function failure(promise: Promise<unknown>): Promise<UpstreamError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  return error as UpstreamError;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the token, persisted in Blobs', () => {
  it('is requested with GET and Basic auth of key:secret', async () => {
    const upstream = fakeUpstream();
    await createUpstreamClient(upstream.deps).fetchStatewidePrices();

    expect(upstream.tokenCalls()[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('test-api-key:test-api-secret').toString('base64')}`,
    );
  });

  it('survives a cold start, so a later run costs one call, not two', async () => {
    const { store } = memoryStore();
    const first = fakeUpstream({}, store);
    await createUpstreamClient(first.deps).fetchStatewidePrices();

    // A new client and a new fetch: what a cold scheduled invocation is.
    const second = fakeUpstream({}, store);
    second.advance(30 * 60_000);
    await createUpstreamClient(second.deps).fetchStatewidePrices();

    expect(second.tokenCalls()).toHaveLength(0);
    expect(second.priceCalls()).toHaveLength(1);
  });

  it('is renewed within ten minutes of expiring', async () => {
    const upstream = fakeUpstream();
    const client = createUpstreamClient(upstream.deps);
    await client.fetchStatewidePrices();
    upstream.advance(43_199_000 - 9 * 60_000);
    await client.fetchStatewidePrices();

    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('is replaced once when a data call says a stored token is invalid', async () => {
    const upstream = fakeUpstream({
      prices: [
        () =>
          jsonResponse(
            {
              errorDetails: { code: 'TokenValidationError', message: 'Access token is not valid.' },
            },
            401,
          ),
        () => jsonResponse({ stations: [], prices: [] }),
      ],
    });
    await upstream.store.setJSON(KEYS.token, { token: 'revoked', expiresAt: Date.UTC(2027, 0) });
    await createUpstreamClient(upstream.deps).fetchStatewidePrices();

    expect(upstream.tokenCalls()).toHaveLength(1);
    expect(upstream.priceCalls()).toHaveLength(2);
  });
});

/*
 * API.NSW denies access after three consecutive failed identifications. Each
 * test here is a way we could have made that third attempt.
 */
describe('the lockout guard', () => {
  it('stops after a single rejection, so a later try cannot be the third failure', async () => {
    const upstream = fakeUpstream({ token: [refused] });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    upstream.advance(30 * 24 * HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    expect(upstream.tokenCalls()).toHaveLength(1);
  });

  it('is not reset by changing the secret, so fixing a typo cannot lock the account', async () => {
    const upstream = fakeUpstream({ token: [refused] });
    await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices());

    const retyped = createUpstreamClient({
      ...upstream.deps,
      credentials: () => ({ apiKey: 'test-api-key', apiSecret: 'corrected-secret' }),
    });
    upstream.advance(2 * HOUR);
    expect((await failure(retyped.fetchStatewidePrices())).kind).toBe('credentials_locked');
    expect(upstream.tokenCalls()).toHaveLength(1);
  });

  it('counts a token request that timed out, since API.NSW may have refused it', async () => {
    const upstream = fakeUpstream({
      token: [
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
        refused,
      ],
    });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('timeout');
    // Not again within the hour...
    upstream.advance(30 * 60_000);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');
    // ...then one more try, refused: two possible failures, and no third.
    upstream.advance(31 * 60_000);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    upstream.advance(30 * 24 * HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('stops after two token requests in a row with no answer', async () => {
    const upstream = fakeUpstream({
      token: [
        () => {
          throw new TypeError('fetch failed');
        },
      ],
    });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('unavailable');
    upstream.advance(61 * 60_000);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('unavailable');
    upstream.advance(30 * 24 * HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('still counts a rejection whose record could not be written', async () => {
    const { store } = memoryStore();
    const upstream = fakeUpstream({ token: [refused] }, store);
    const flaky = {
      ...store,
      setJSON: (key: string, value: unknown) => {
        // Blobs fails once the token request has gone out.
        if (key === KEYS.authFailure && upstream.tokenCalls().length > 0) {
          return Promise.reject(new Error('Blobs unavailable'));
        }
        return store.setJSON(key, value);
      },
    };
    await failure(createUpstreamClient({ ...upstream.deps, store: flaky }).fetchStatewidePrices());

    upstream.advance(5 * 60_000);
    expect((await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices())).kind).toBe(
      'credentials_locked',
    );
    expect(upstream.tokenCalls()).toHaveLength(1);
  });

  it('treats an unreadable failure record as locked, not as no failures', async () => {
    const upstream = fakeUpstream();
    await upstream.store.setJSON(KEYS.authFailure, { credentials: 'old-format', failures: 1 });

    expect((await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices())).kind).toBe(
      'credentials_locked',
    );
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('stops when the data call refuses a token fetched moments before', async () => {
    const upstream = fakeUpstream({ prices: [() => jsonResponse({}, 401)] });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    upstream.advance(30 * 24 * HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    // One token, one refused data call, and nothing after: not 3 calls every run.
    expect(upstream.tokenCalls()).toHaveLength(1);
    expect(upstream.priceCalls()).toHaveLength(1);
  });

  it('stops when the data call refuses a stored token and then a fresh one', async () => {
    const upstream = fakeUpstream({ prices: [() => jsonResponse({}, 401)] });
    await upstream.store.setJSON(KEYS.token, { token: 'old', expiresAt: Date.UTC(2027, 0) });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    upstream.advance(HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    expect(upstream.tokenCalls()).toHaveLength(1);
    expect(upstream.priceCalls()).toHaveLength(2);
  });

  it('does not count an outage as a rejection', async () => {
    const upstream = fakeUpstream({
      token: [() => jsonResponse({}, 503), () => jsonResponse({}, 503), () => jsonResponse(token)],
    });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('unavailable');
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('unavailable');
    await client.fetchStatewidePrices();

    expect(upstream.tokenCalls()).toHaveLength(3);
    expect(await upstream.store.getJSON(KEYS.authFailure, 'strong')).toBeNull();
  });

  it('holds across cold starts, because the count is in Blobs', async () => {
    const { store } = memoryStore();
    await failure(
      createUpstreamClient(fakeUpstream({ token: [refused] }, store).deps).fetchStatewidePrices(),
    );

    const second = fakeUpstream({ token: [refused] }, store);
    second.advance(5 * 60_000);
    expect((await failure(createUpstreamClient(second.deps).fetchStatewidePrices())).kind).toBe(
      'credentials_locked',
    );
    expect(second.tokenCalls()).toHaveLength(0);
  });

  it('starts a new count for a different API key', async () => {
    const upstream = fakeUpstream({ token: [refused] });
    await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices());

    const newApp = createUpstreamClient({
      ...upstream.deps,
      credentials: () => ({ apiKey: 'another-api-key', apiSecret: 'another-secret' }),
    });
    await failure(newApp.fetchStatewidePrices());
    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('is cleared by a success', async () => {
    const upstream = fakeUpstream({
      token: [
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
        () => jsonResponse({ access_token: 't', expires_in: '43199' }),
      ],
    });
    const client = createUpstreamClient(upstream.deps);
    await failure(client.fetchStatewidePrices());
    upstream.advance(61 * 60_000);
    await client.fetchStatewidePrices();

    expect(await upstream.store.getJSON(KEYS.authFailure, 'strong')).toBeNull();
  });

  it('does not call anything when credentials are missing', async () => {
    const upstream = fakeUpstream();
    const client = createUpstreamClient({ ...upstream.deps, credentials: () => null });

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('not_configured');
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});

describe('the prices request', () => {
  it('sends the headers the spec requires', async () => {
    const upstream = fakeUpstream();
    await createUpstreamClient(upstream.deps).fetchStatewidePrices();

    expect(upstream.priceCalls()[0]?.headers).toMatchObject({
      authorization: 'Bearer test-access-token',
      apikey: 'test-api-key',
      transactionid: '00000000-0000-4000-8000-000000000000',
      requesttimestamp: '21/10/2026 03:21:27 AM',
      'content-type': 'application/json; charset=utf-8',
    });
  });

  it.each([
    [500, 'unavailable'],
    [429, 'rate_limited'],
    [400, 'request_rejected'],
  ])('reports HTTP %d as %s', async (status, kind) => {
    const upstream = fakeUpstream({ prices: [() => jsonResponse({}, status)] });
    expect((await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices())).kind).toBe(
      kind,
    );
  });

  it('reports a timeout', async () => {
    const upstream = fakeUpstream({
      prices: [
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      ],
    });
    expect((await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices())).kind).toBe(
      'timeout',
    );
  });

  it('reports a body in an unexpected shape', async () => {
    const upstream = fakeUpstream({ prices: [() => jsonResponse({ stations: 'none' })] });
    expect((await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices())).kind).toBe(
      'bad_response',
    );
  });
});
