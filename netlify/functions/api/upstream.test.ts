// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import errorBody from './__fixtures__/error.json';
import { fakeUpstream, jsonResponse, PATHS } from './__fixtures__/fakeUpstream';
import lovs from './__fixtures__/lovs.json';
import nearby from './__fixtures__/nearby.json';
import { ApiError } from './http';

import type { NearbyQuery } from './validate';

const query: NearbyQuery = { latitude: -33.43, longitude: 151.3, radiusKm: 5, fuelType: 'P95' };
const HOUR = 60 * 60_000;

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  // Upstream failures are logged on purpose; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the OAuth token', () => {
  it('is requested with GET and Basic auth of key:secret', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(nearby)] });
    await upstream.client().nearby(query);

    const [tokenCall] = upstream.tokenCalls();
    expect(tokenCall?.method).toBe('GET');
    expect(tokenCall?.url).toContain('grant_type=client_credentials');
    expect(tokenCall?.headers.authorization).toBe(
      `Basic ${Buffer.from('test-api-key:test-api-secret').toString('base64')}`,
    );
  });

  it('is reused across requests while it is valid', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(nearby)] });
    const client = upstream.client();
    await client.nearby(query);
    upstream.advance(11 * HOUR);
    await client.nearby(query);

    expect(upstream.tokenCalls()).toHaveLength(1);
    expect(upstream.dataCalls()).toHaveLength(2);
  });

  it('is refreshed shortly before it expires', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(nearby)] });
    const client = upstream.client();
    await client.nearby(query);
    // expires_in is 43199 s; inside the five-minute margin it must be renewed.
    upstream.advance(43_199_000 - 4 * 60_000);
    await client.nearby(query);

    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('is fetched once when a cold instance gets concurrent requests', async () => {
    const upstream = fakeUpstream({
      [PATHS.nearby]: [() => jsonResponse(nearby)],
      [PATHS.reference]: [() => jsonResponse(lovs)],
    });
    const client = upstream.client();
    await Promise.all([client.nearby(query), client.nearby(query), client.reference()]);

    expect(upstream.tokenCalls()).toHaveLength(1);
  });

  it('is dropped and fetched again when a data call says it is invalid', async () => {
    const upstream = fakeUpstream({
      [PATHS.nearby]: [
        () =>
          jsonResponse(
            {
              errorDetails: { code: 'TokenValidationError', message: 'Access token is not valid.' },
            },
            401,
          ),
        () => jsonResponse(nearby),
      ],
    });
    const result = await upstream.client().nearby(query);

    expect(result.stations.length).toBeGreaterThan(0);
    expect(upstream.tokenCalls()).toHaveLength(2);
    expect(upstream.dataCalls()).toHaveLength(2);
  });

  it('gives up after one retry if the fresh token is refused too', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(errorBody, 401)] });
    const error = await rejection(upstream.client().nearby(query));

    expect(error.code).toBe('upstream_auth');
    expect(upstream.dataCalls()).toHaveLength(2);
  });
});

describe('bad credentials', () => {
  const refused = () =>
    jsonResponse({ ErrorCode: 'invalid_client', Error: 'Client credentials are invalid' }, 401);

  it('are reported as upstream_auth', async () => {
    const upstream = fakeUpstream({ [PATHS.token]: [refused] });
    expect((await rejection(upstream.client().nearby(query))).code).toBe('upstream_auth');
  });

  it('are not retried for five minutes, so visitors cannot lock the account', async () => {
    const upstream = fakeUpstream({
      [PATHS.token]: [refused],
      [PATHS.nearby]: [() => jsonResponse(nearby)],
    });
    const client = upstream.client();
    await rejection(client.nearby(query));
    await rejection(client.nearby(query));
    await rejection(client.reference());
    expect(upstream.tokenCalls()).toHaveLength(1);

    upstream.advance(5 * 60_000);
    await rejection(client.nearby(query));
    expect(upstream.tokenCalls()).toHaveLength(2);
  });

  it('that are missing fail cleanly without calling upstream', async () => {
    const upstream = fakeUpstream();
    const error = await rejection(upstream.client({ credentials: () => null }).nearby(query));

    expect(error.code).toBe('not_configured');
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});

describe('data requests', () => {
  it('send the headers the spec requires', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(nearby)] });
    await upstream.client().nearby(query);

    expect(upstream.dataCalls()[0]?.headers).toMatchObject({
      authorization: 'Bearer test-access-token',
      apikey: 'test-api-key',
      transactionid: '00000000-0000-4000-8000-000000000000',
      // The fake clock is 2026-10-21 02:00:00 UTC.
      requesttimestamp: '21/10/2026 02:00:00 AM',
      'content-type': 'application/json; charset=utf-8',
    });
  });

  it('send every nearby body field as a string, as the spec does', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(nearby)] });
    await upstream.client().nearby(query);

    const call = upstream.dataCalls()[0];
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({
      fueltype: 'P95',
      brand: [],
      namedlocation: '',
      latitude: '-33.43',
      longitude: '151.3',
      radius: '5',
      sortby: 'price',
      sortascending: 'true',
    });
  });

  it('send a location search with the suburb and a reference point', async () => {
    const upstream = fakeUpstream({ [PATHS.location]: [() => jsonResponse(nearby)] });
    await upstream.client().location({ location: 'Woy Woy', fuelType: 'E10' });

    expect(upstream.dataCalls()[0]?.body).toMatchObject({
      fueltype: 'E10',
      namedlocation: 'Woy Woy',
      referencepoint: { latitude: '-33.8679', longitude: '151.2073' },
    });
  });

  it('ask /lovs for everything with an old if-modified-since', async () => {
    const upstream = fakeUpstream({ [PATHS.reference]: [() => jsonResponse(lovs)] });
    await upstream.client().reference();

    expect(upstream.dataCalls()[0]?.headers['if-modified-since']).toBe('01/01/2010 12:00:00 AM');
  });
});

describe('upstream failures', () => {
  it.each([
    [500, 'upstream_unavailable'],
    [503, 'upstream_unavailable'],
    [429, 'upstream_rate_limited'],
    [400, 'upstream_error'],
    [404, 'upstream_error'],
  ])('HTTP %d becomes %s', async (status, code) => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse(errorBody, status)] });
    expect((await rejection(upstream.client().nearby(query))).code).toBe(code);
  });

  it('a timeout becomes upstream_timeout', async () => {
    const upstream = fakeUpstream({
      [PATHS.nearby]: [
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      ],
    });
    expect((await rejection(upstream.client().nearby(query))).code).toBe('upstream_timeout');
  });

  it('a network failure becomes upstream_unavailable', async () => {
    const upstream = fakeUpstream({
      [PATHS.nearby]: [
        () => {
          throw new TypeError('fetch failed');
        },
      ],
    });
    expect((await rejection(upstream.client().nearby(query))).code).toBe('upstream_unavailable');
  });

  it('a response that is not JSON becomes upstream_error', async () => {
    const upstream = fakeUpstream({
      [PATHS.nearby]: [() => new Response('<html>Gateway</html>', { status: 200 })],
    });
    expect((await rejection(upstream.client().nearby(query))).code).toBe('upstream_error');
  });

  it('a response in an unexpected shape becomes upstream_error', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse({ stations: 'none' })] });
    expect((await rejection(upstream.client().nearby(query))).code).toBe('upstream_error');
  });
});
