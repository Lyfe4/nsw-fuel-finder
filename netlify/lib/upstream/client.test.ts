// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpstreamClient } from './client';
import { UpstreamError } from './errors';
import { fakeUpstream, jsonResponse } from '../__fixtures__/fakeUpstream';
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

  it('is replaced once when a data call says it is invalid', async () => {
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
    await createUpstreamClient(upstream.deps).fetchStatewidePrices();

    expect(upstream.tokenCalls()).toHaveLength(2);
    expect(upstream.priceCalls()).toHaveLength(2);
  });

  it('is not retried a second time if the fresh token is refused too', async () => {
    const upstream = fakeUpstream({ prices: [() => jsonResponse({}, 401)] });
    const error = await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices());

    expect(error.kind).toBe('request_rejected');
    expect(upstream.priceCalls()).toHaveLength(2);
  });
});

describe('the lockout guard', () => {
  it('never makes a third consecutive failed attempt', async () => {
    const upstream = fakeUpstream({ token: [refused] });
    const client = createUpstreamClient(upstream.deps);

    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    // Within the hour: not even asked.
    upstream.advance(30 * 60_000);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');
    // After the hour: one more try, which fails...
    upstream.advance(31 * 60_000);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_rejected');
    // ...and then never again with these credentials, however long we wait.
    upstream.advance(30 * 24 * HOUR);
    expect((await failure(client.fetchStatewidePrices())).kind).toBe('credentials_locked');

    expect(upstream.tokenCalls()).toHaveLength(2);
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

  it('is reset by changing the credentials', async () => {
    const upstream = fakeUpstream({ token: [refused] });
    await failure(createUpstreamClient(upstream.deps).fetchStatewidePrices());

    const fixed = createUpstreamClient({
      ...upstream.deps,
      credentials: () => ({ apiKey: 'test-api-key', apiSecret: 'corrected-secret' }),
    });
    await failure(fixed.fetchStatewidePrices());
    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('is cleared by a success', async () => {
    const upstream = fakeUpstream({
      token: [refused, () => jsonResponse({ access_token: 't', expires_in: '43199' })],
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
