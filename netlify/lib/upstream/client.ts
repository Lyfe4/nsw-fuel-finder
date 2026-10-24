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
 * identifications, so this code never risks a second one on its own:
 *
 * - A REJECTION (the token endpoint says 401/403, or the data call refuses a
 *   token we fetched moments before) stops every automatic attempt with that
 *   API key until a human runs `pnpm auth:reset`.
 * - An UNKNOWN OUTCOME (a token request that timed out, never connected, or
 *   whose result we could not record) may have been a rejection we never
 *   saw. One waits an hour before a single further try; two in a row stop,
 *   as a rejection does.
 *
 * So the worst case is two failures API.NSW counts, leaving a margin of one
 * for a local run, which keeps its own record (docs/api-notes.md).
 *
 * The record is written BEFORE each token request, as an unknown outcome,
 * and corrected once the answer is in. A crash, a timeout or a Blobs write
 * that fails after the request therefore still leaves it counted. A record
 * that cannot be read is treated as locked, not as "no failures".
 *
 * Keyed on the API key alone: API.NSW counts failures against the app, so a
 * corrected secret is not a fresh start. A different key (a new app) is.
 */
const RETRY_AFTER_UNKNOWN_MS = 60 * 60_000;
const MAX_UNKNOWN_OUTCOMES = 2;

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

/** `auth/failure`. Shown as-is by `pnpm auth:reset` (scripts/auth-reset.mjs). */
export const authFailureSchema = z.object({
  version: z.literal(2),
  /** A hash of the API key, so a different key starts afresh. */
  key: z.string(),
  /** API.NSW said no: never again automatically. */
  rejected: z.boolean(),
  /** Token requests in a row whose outcome we never learned. */
  unknown: z.number().int().min(0),
  lastAt: z.number(),
  /** What happened last, in words, for whoever resets it. */
  detail: z.string(),
});
type AuthFailure = z.infer<typeof authFailureSchema>;

/** Not secret: a truncated hash, only used to tell one API key from another. */
function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

const RESET_HINT = 'Run `pnpm auth:reset` once the cause is known.';

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

  /** This key's record, or null if it has none. Throws when it must not try. */
  async function assertNotLocked(key: string): Promise<AuthFailure | null> {
    const raw = await deps.store.getJSON(KEYS.authFailure, 'strong');
    if (raw === null) return null;
    const parsed = authFailureSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError(
        'credentials_locked',
        `auth/failure is in a shape this code does not know. ${RESET_HINT}`,
      );
    }
    const record = parsed.data;
    if (record.key !== key) return null;
    if (record.rejected) {
      throw new UpstreamError('credentials_locked', `${record.detail}. ${RESET_HINT}`);
    }
    if (record.unknown >= MAX_UNKNOWN_OUTCOMES) {
      throw new UpstreamError(
        'credentials_locked',
        `${String(record.unknown)} token requests in a row got no answer (${record.detail}). ${RESET_HINT}`,
      );
    }
    if (record.unknown > 0 && deps.now() - record.lastAt < RETRY_AFTER_UNKNOWN_MS) {
      throw new UpstreamError(
        'credentials_locked',
        'The last token request got no answer less than an hour ago. Waiting before one more try.',
      );
    }
    return record;
  }

  function writeRecord(key: string, fields: Pick<AuthFailure, 'rejected' | 'unknown' | 'detail'>) {
    const record: AuthFailure = { version: 2, key, lastAt: deps.now(), ...fields };
    return deps.store.setJSON(KEYS.authFailure, record);
  }

  /** API.NSW refused these credentials: stop until a human resets it. */
  async function reject(key: string, detail: string): Promise<never> {
    await writeRecord(key, { rejected: true, unknown: 0, detail }).catch((error: unknown) => {
      // The record written before the request still stands, as an unknown.
      console.error('Recording the rejection in auth/failure failed', error);
    });
    throw new UpstreamError('credentials_rejected', detail);
  }

  async function fetchToken(credentials: Credentials): Promise<string> {
    const key = fingerprint(credentials.apiKey);
    const previous = await assertNotLocked(key);
    const unknownBefore = previous?.unknown ?? 0;
    // Counted before asking: if we never hear back, it stays counted.
    await writeRecord(key, {
      rejected: false,
      unknown: unknownBefore + 1,
      detail: 'token: request sent, outcome not recorded',
    });

    const basic = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
    const response = await send(
      'token',
      `${BASE_URL}/oauth/client_credential/accesstoken?grant_type=client_credentials`,
      { method: 'GET', headers: { Authorization: `Basic ${basic}` } },
      TOKEN_TIMEOUT_MS,
    );

    if (response.status === 401 || response.status === 403) {
      return reject(
        key,
        `The token endpoint refused the credentials (HTTP ${String(response.status)})`,
      );
    }
    if (!response.ok) {
      // An answer, and not about the credentials: back to how it was.
      if (unknownBefore === 0) await deps.store.delete(KEYS.authFailure);
      else
        await writeRecord(key, {
          rejected: false,
          unknown: unknownBefore,
          detail: 'token: no answer',
        });
      throw statusError(response.status, 'token');
    }

    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new UpstreamError('bad_response', 'token: unexpected body');

    // Expiry from OUR clock plus the relative lifetime; the response's
    // `issued_at` is the issuer's clock, which we never compare with ours.
    const expiresAt = deps.now() + parsed.data.expires_in * 1000;
    await deps.store.setJSON(KEYS.token, { token: parsed.data.access_token, expiresAt });
    await deps.store.delete(KEYS.authFailure);
    return parsed.data.access_token;
  }

  /** A token, and whether it was fetched in this run (rather than stored). */
  async function getToken(credentials: Credentials): Promise<{ token: string; fresh: boolean }> {
    // Each scheduled run is a cold start, so the token lives in Blobs rather
    // than in module scope. A run then costs one call, not two.
    const stored = storedTokenSchema.safeParse(await deps.store.getJSON(KEYS.token, 'strong'));
    if (stored.success && deps.now() < stored.data.expiresAt - REFRESH_MARGIN_MS) {
      return { token: stored.data.token, fresh: false };
    }
    return { token: await fetchToken(credentials), fresh: true };
  }

  /** The statewide current prices: every NSW station, with location and address. */
  async function fetchStatewidePrices(): Promise<StatewidePrices> {
    const credentials = requireCredentials();
    for (;;) {
      const { token, fresh } = await getToken(credentials);
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

      if (response.status === 401) {
        await deps.store.delete(KEYS.token);
        // A stored token can be revoked or expire early: try once with a
        // fresh one. A token fetched moments ago being refused means the key
        // itself is not accepted (an app unsubscribed from the Fuel API, say),
        // and retrying would cost three calls every run, for ever.
        if (!fresh) continue;
        return reject(
          fingerprint(credentials.apiKey),
          'The prices endpoint refused a token fetched moments before (HTTP 401)',
        );
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
