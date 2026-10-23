import { createHash } from 'node:crypto';

import { z } from 'zod';

import { statusError, UpstreamError } from './errors';
import {
  statewidePricesSchema,
  tokenResponseSchema,
  upstreamErrorSchema,
  type StatewidePrices,
} from './schemas';
import { formatRequestTimestamp } from './time';
import { KEYS } from '../store';

import type { KeyValueStore } from '../store';

export const BASE_URL = 'https://api.onegov.nsw.gov.au';

/**
 * Per request. A scheduled function is stopped after 30 s, and one run can
 * need a token call, the 1.75 MB price download (0.7-1.1 s measured) and a
 * retry of it.
 */
const TOKEN_TIMEOUT_MS = 5_000;
const DATA_TIMEOUT_MS = 10_000;

/** Tokens last ~12 h. Refresh this long before expiry, never at the edge. */
const REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * THE LOCKOUT GUARD. API.NSW denies access after three consecutive failed
 * identifications. A scheduled job that retried bad credentials every 30
 * minutes would get there in an hour, so failures are counted per set of
 * credentials, in Blobs (each run is a cold start), and:
 *
 * - after the 1st rejection, the token endpoint is not called for an hour, in
 *   case it was a blip on their side;
 * - after the 2nd, it is not called again with those credentials at all.
 *
 * So this code never makes the third attempt. Changing FUEL_API_KEY or
 * FUEL_API_SECRET resets the count (it is keyed on a hash of them), as does
 * deleting the `auth/failure` blob.
 */
const RETRY_AFTER_FIRST_FAILURE_MS = 60 * 60_000;
const MAX_AUTOMATIC_FAILURES = 2;

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface UpstreamDeps {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. Injected so tests can move time. */
  now: () => number;
  randomUUID: () => string;
  credentials: () => Credentials | null;
  store: KeyValueStore;
  /** Called once per HTTP request to API.NSW, for the call budget. */
  onCall?: (what: 'token' | 'prices') => void;
}

const storedTokenSchema = z.object({ token: z.string(), expiresAt: z.number() });
const authFailureSchema = z.object({
  credentials: z.string(),
  failures: z.number(),
  lastFailedAt: z.number(),
});

/** Not secret: a truncated hash, only used to notice the credentials changed. */
function fingerprint({ apiKey, apiSecret }: Credentials): string {
  return createHash('sha256').update(`${apiKey}:${apiSecret}`).digest('hex').slice(0, 16);
}

export function createUpstreamClient(deps: UpstreamDeps) {
  function requireCredentials(): Credentials {
    const credentials = deps.credentials();
    if (!credentials) {
      throw new UpstreamError('not_configured', 'FUEL_API_KEY / FUEL_API_SECRET are not set.');
    }
    return credentials;
  }

  async function send(
    what: 'token' | 'prices',
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    deps.onCall?.(what);
    try {
      return await deps.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new UpstreamError('timeout', `${what}: no response in ${String(timeoutMs)} ms`);
      }
      throw new UpstreamError('unavailable', `${what}: ${String(error)}`, { cause: error });
    }
  }

  async function assertNotLocked(credentials: Credentials): Promise<void> {
    const parsed = authFailureSchema.safeParse(
      await deps.store.getJSON(KEYS.authFailure, 'strong'),
    );
    if (!parsed.success || parsed.data.credentials !== fingerprint(credentials)) return;
    const { failures, lastFailedAt } = parsed.data;
    if (failures >= MAX_AUTOMATIC_FAILURES) {
      throw new UpstreamError(
        'credentials_locked',
        `These credentials were rejected ${String(failures)} times in a row. Not trying again ` +
          'until FUEL_API_KEY/FUEL_API_SECRET change or the auth/failure blob is deleted.',
      );
    }
    if (deps.now() - lastFailedAt < RETRY_AFTER_FIRST_FAILURE_MS) {
      throw new UpstreamError(
        'credentials_locked',
        'These credentials were rejected less than an hour ago. Waiting before one more try.',
      );
    }
  }

  async function recordFailure(credentials: Credentials): Promise<void> {
    const parsed = authFailureSchema.safeParse(
      await deps.store.getJSON(KEYS.authFailure, 'strong'),
    );
    const same = parsed.success && parsed.data.credentials === fingerprint(credentials);
    await deps.store.setJSON(KEYS.authFailure, {
      credentials: fingerprint(credentials),
      failures: same ? parsed.data.failures + 1 : 1,
      lastFailedAt: deps.now(),
    });
  }

  async function fetchToken(credentials: Credentials): Promise<string> {
    await assertNotLocked(credentials);
    const basic = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
    const response = await send(
      'token',
      `${BASE_URL}/oauth/client_credential/accesstoken?grant_type=client_credentials`,
      { method: 'GET', headers: { Authorization: `Basic ${basic}` } },
      TOKEN_TIMEOUT_MS,
    );

    if (response.status === 401 || response.status === 403) {
      await recordFailure(credentials);
      throw new UpstreamError('credentials_rejected', `token: HTTP ${String(response.status)}`);
    }
    if (!response.ok) throw statusError(response.status, 'token');

    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new UpstreamError('bad_response', 'token: unexpected body');

    // Expiry from OUR clock plus the relative lifetime; the response's
    // `issued_at` is the issuer's clock, which we never compare with ours.
    const expiresAt = deps.now() + parsed.data.expires_in * 1000;
    await deps.store.setJSON(KEYS.token, { token: parsed.data.access_token, expiresAt });
    await deps.store.delete(KEYS.authFailure);
    return parsed.data.access_token;
  }

  async function getToken(credentials: Credentials): Promise<string> {
    // Each scheduled run is a cold start, so the token lives in Blobs rather
    // than in module scope. A run then costs one call, not two.
    const stored = storedTokenSchema.safeParse(await deps.store.getJSON(KEYS.token, 'strong'));
    if (stored.success && deps.now() < stored.data.expiresAt - REFRESH_MARGIN_MS) {
      return stored.data.token;
    }
    return fetchToken(credentials);
  }

  /** The statewide current prices: every NSW station, with location and address. */
  async function fetchStatewidePrices(): Promise<StatewidePrices> {
    const credentials = requireCredentials();
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(credentials);
      const response = await send(
        'prices',
        `${BASE_URL}/FuelPriceCheck/v2/fuel/prices?states=NSW`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: credentials.apiKey,
            transactionid: deps.randomUUID(),
            requesttimestamp: formatRequestTimestamp(new Date(deps.now())),
            'Content-Type': 'application/json; charset=utf-8',
            Accept: 'application/json',
          },
        },
        DATA_TIMEOUT_MS,
      );

      // A stored token can be revoked or expire early. Drop it and try once
      // more with a fresh one; a second 401 is reported, not retried.
      if (response.status === 401 && attempt === 0) {
        await deps.store.delete(KEYS.token);
        continue;
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = upstreamErrorSchema.safeParse(body);
        console.error(
          `API.NSW /prices returned HTTP ${String(response.status)}`,
          detail.success ? detail.data.errorDetails : 'no error body',
        );
        throw statusError(response.status, 'prices');
      }

      const parsed = statewidePricesSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        console.error('Unexpected /prices shape', parsed.error.issues.slice(0, 5));
        throw new UpstreamError('bad_response', 'prices: unexpected body');
      }
      return parsed.data;
    }
  }

  return { fetchStatewidePrices };
}
