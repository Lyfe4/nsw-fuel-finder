import { ApiError } from './http';
import {
  pricesResponseSchema,
  referenceResponseSchema,
  tokenResponseSchema,
  upstreamErrorSchema,
  type UpstreamPricesResponse,
  type UpstreamReferenceResponse,
} from './schemas';
import { formatRequestTimestamp } from './time';

import type { LocationQuery, NearbyQuery } from './validate';
import type { z } from 'zod';

export const BASE_URL = 'https://api.onegov.nsw.gov.au';

/**
 * Per upstream request. A Netlify synchronous function is cut off at 10 s by
 * default, and one request can need a token call, a data call and one retry.
 */
const TIMEOUT_MS = 3_000;

/** Tokens last ~12 h. Refresh this long before expiry, never at the edge. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * After the token endpoint refuses our credentials, stop asking for a while.
 * API.NSW's terms deny access after three consecutive failed identifications,
 * and without this every visitor's request would be another failed attempt.
 */
const AUTH_FAILURE_BACKOFF_MS = 5 * 60_000;

/** /lovs requires `if-modified-since`; a date before FuelCheck existed returns everything. */
const ALL_REFERENCE_DATA_SINCE = new Date(Date.UTC(2010, 0, 1));

/**
 * The location endpoint requires a reference point even though a suburb
 * search has none. Sydney GPO is sent and the resulting distances are
 * discarded (see normalisePrices).
 */
const SYDNEY_GPO = { latitude: '-33.8679', longitude: '151.2073' };

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface FuelApiDeps {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. Injected so tests can move time. */
  now: () => number;
  randomUUID: () => string;
  /** Read per call, so a missing variable is a clean 500, not a crash at load. */
  credentials: () => Credentials | null;
}

export interface FuelApiClient {
  reference(): Promise<UpstreamReferenceResponse>;
  nearby(query: NearbyQuery): Promise<UpstreamPricesResponse>;
  location(query: LocationQuery): Promise<UpstreamPricesResponse>;
}

export function createFuelApiClient(deps: FuelApiDeps): FuelApiClient {
  // Module-scope state for the life of a warm function instance. Each
  // instance has its own; that costs one token call per cold start, which a
  // 12-hour token makes cheap.
  let cached: { token: string; expiresAt: number } | null = null;
  let pendingToken: Promise<string> | null = null;
  let authFailedAt: number | null = null;

  function requireCredentials(): Credentials {
    const credentials = deps.credentials();
    if (!credentials) {
      console.error('FUEL_API_KEY / FUEL_API_SECRET are not set.');
      throw new ApiError('not_configured', 'The fuel price service is not configured.');
    }
    return credentials;
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ApiError('upstream_timeout', 'The fuel price service took too long to respond.');
      }
      throw new ApiError('upstream_unavailable', 'The fuel price service could not be reached.', {
        cause: error,
      });
    }
  }

  async function readJson<S extends z.ZodType>(
    response: Response,
    schema: S,
  ): Promise<z.output<S>> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ApiError('upstream_error', 'The fuel price service sent an unreadable response.', {
        cause: error,
      });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // The shape changed upstream. Log enough to fix the schema, no more.
      console.error('Unexpected upstream response shape', parsed.error.issues.slice(0, 5));
      throw new ApiError('upstream_error', 'The fuel price service sent an unexpected response.');
    }
    return parsed.data;
  }

  async function fetchToken(): Promise<string> {
    const { apiKey, apiSecret } = requireCredentials();
    const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const response = await send(
      `${BASE_URL}/oauth/client_credential/accesstoken?grant_type=client_credentials`,
      { method: 'GET', headers: { Authorization: `Basic ${basic}` } },
    );

    if (response.status === 401 || response.status === 403) {
      authFailedAt = deps.now();
      console.error(`API.NSW refused our credentials (HTTP ${String(response.status)}).`);
      throw new ApiError('upstream_auth', 'The fuel price service rejected our credentials.');
    }
    if (!response.ok) throw statusError(response.status);

    const { access_token, expires_in } = await readJson(response, tokenResponseSchema);
    // Expiry from OUR clock at receipt plus the relative lifetime. The
    // response's `issued_at` is the issuer's clock, which we never compare
    // against ours.
    cached = { token: access_token, expiresAt: deps.now() + expires_in * 1000 };
    authFailedAt = null;
    return access_token;
  }

  function getToken(): Promise<string> {
    const now = deps.now();
    if (cached && now < cached.expiresAt - REFRESH_MARGIN_MS) return Promise.resolve(cached.token);
    if (authFailedAt !== null && now - authFailedAt < AUTH_FAILURE_BACKOFF_MS) {
      return Promise.reject(
        new ApiError('upstream_auth', 'The fuel price service rejected our credentials.'),
      );
    }
    // Concurrent requests on a cold instance share one token call.
    pendingToken ??= fetchToken().finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  async function call<S extends z.ZodType>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> },
    schema: S,
  ): Promise<z.output<S>> {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const { apiKey } = requireCredentials();
      const response = await send(`${BASE_URL}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: apiKey,
          transactionid: deps.randomUUID(),
          requesttimestamp: formatRequestTimestamp(new Date(deps.now())),
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });

      // A token can be revoked or expire early. Drop it and try once more
      // with a fresh one; a second 401 is a real credentials problem.
      if (response.status === 401 && attempt === 0) {
        cached = null;
        continue;
      }
      if (response.status === 401) {
        throw new ApiError('upstream_auth', 'The fuel price service rejected our credentials.');
      }
      if (!response.ok) {
        await logUpstreamError(path, response);
        throw statusError(response.status);
      }
      return readJson(response, schema);
    }
  }

  return {
    reference: () =>
      call(
        '/FuelCheckRefData/v2/fuel/lovs',
        {
          method: 'GET',
          headers: { 'if-modified-since': formatRequestTimestamp(ALL_REFERENCE_DATA_SINCE) },
        },
        referenceResponseSchema,
      ),

    // Every body field is a string, numbers and booleans included: that is
    // what the spec's schema and example both say.
    nearby: (query) =>
      call(
        '/FuelPriceCheck/v2/fuel/prices/nearby',
        {
          method: 'POST',
          body: {
            fueltype: query.fuelType,
            brand: [],
            namedlocation: '',
            latitude: String(query.latitude),
            longitude: String(query.longitude),
            radius: String(query.radiusKm),
            sortby: 'price',
            sortascending: 'true',
          },
        },
        pricesResponseSchema,
      ),

    location: (query) =>
      call(
        '/FuelPriceCheck/v2/fuel/prices/location',
        {
          method: 'POST',
          body: {
            fueltype: query.fuelType,
            brand: [],
            namedlocation: query.location,
            referencepoint: SYDNEY_GPO,
            sortby: 'price',
            sortascending: 'true',
          },
        },
        pricesResponseSchema,
      ),
  };
}

function statusError(status: number): ApiError {
  if (status === 429) {
    return new ApiError('upstream_rate_limited', 'The fuel price service is busy. Try again soon.');
  }
  if (status >= 500) {
    return new ApiError('upstream_unavailable', 'The fuel price service is unavailable.');
  }
  // Any other 4xx means upstream did not like a request we built. That is
  // our bug, not the caller's, so it is a 502 rather than a 400.
  return new ApiError('upstream_error', 'The fuel price service could not answer that request.');
}

async function logUpstreamError(path: string, response: Response): Promise<void> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = upstreamErrorSchema.safeParse(body);
  const detail = parsed.success ? parsed.data.errorDetails : 'no error body';
  console.error(`API.NSW ${path} returned HTTP ${String(response.status)}`, detail);
}
