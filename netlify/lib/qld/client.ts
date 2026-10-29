import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  qldBrandsResponseSchema,
  qldPricesResponseSchema,
  qldRegionsResponseSchema,
  qldSitesResponseSchema,
} from './schemas';
import { QLD_KEYS } from '../store';
import { statusError, UpstreamError } from '../upstream/errors';

import type { KeyValueStore } from '../store';

export const QLD_BASE_URL = 'https://fppdirectapi-prod.fuelpricesqld.com.au';

/** Australia, and Queensland within it, as the API numbers them. */
const COUNTRY = 'countryId=21';
const QUEENSLAND = `${COUNTRY}&geoRegionLevel=3&geoRegionId=1`;

/**
 * Per request. A scheduled function is stopped after 30 s, and a run that
 * refreshes the reference data makes four calls (0.1-0.4 s each, measured).
 */
const TIMEOUT_MS = 6_000;

/**
 * THE GUARD. No lockout is documented for this API, but the token is the
 * whole credential, and the service monitors access. So a 401 or 403 on any
 * call stops every automatic attempt with that token until a human runs
 * `pnpm auth:reset --source qld`. There is no token exchange, so a timeout
 * cannot hide a refusal: only an answer counts.
 *
 * Keyed on a hash of the token: a new token (after publisher approval, say)
 * starts afresh. A record that cannot be read is treated as stopping.
 */
export const qldAuthFailureSchema = z.object({
  version: z.literal(1),
  key: z.string(),
  rejected: z.literal(true),
  lastAt: z.number(),
  detail: z.string(),
});

export interface QldDeps {
  fetch: typeof fetch;
  now: () => number;
  /** The subscriber token, or null when it is not set. Never logged. */
  token: () => string | null;
  store: KeyValueStore;
  /** Called once per HTTP request, for the call count. */
  onCall?: (what: 'reference' | 'prices') => void;
}

/** A GUID, as the manual describes the token. */
const TOKEN_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESET_HINT = 'Run `pnpm auth:reset --source qld` once the cause is known.';

/** Not secret: a truncated hash, only used to tell one token from another. */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function createQldClient(deps: QldDeps) {
  let checked: string | null = null;

  function requireToken(): string {
    const token = deps.token()?.trim();
    if (!token || !TOKEN_SHAPE.test(token)) {
      throw new UpstreamError('not_configured', 'QLD_FPD_TOKEN is not set, or is not a GUID.');
    }
    return token;
  }

  /** Once per client: throws if a person has to reset the guard first. */
  async function assertNotStopped(key: string): Promise<void> {
    if (checked === key) return;
    const raw = await deps.store.getJSON(QLD_KEYS.authFailure, 'strong');
    if (raw !== null) {
      const parsed = qldAuthFailureSchema.safeParse(raw);
      if (!parsed.success) {
        throw new UpstreamError(
          'credentials_locked',
          `qld/auth/failure is in a shape this code does not know. ${RESET_HINT}`,
        );
      }
      if (parsed.data.key === key) {
        throw new UpstreamError('credentials_locked', `${parsed.data.detail}. ${RESET_HINT}`);
      }
    }
    checked = key;
  }

  async function get<T>(
    what: 'reference' | 'prices',
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const token = requireToken();
    const key = fingerprint(token);
    await assertNotStopped(key);

    deps.onCall?.(what);
    let response: Response;
    try {
      response = await deps.fetch(`${QLD_BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `FPDAPI SubscriberToken=${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Never the error's own text alone: it could one day carry the request.
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new UpstreamError('timeout', `${path}: no response in ${String(TIMEOUT_MS)} ms`);
      }
      throw new UpstreamError('unavailable', `${path}: no connection`, { cause: error });
    }

    if (response.status === 401 || response.status === 403) {
      const detail = `The QLD API refused the token on ${path} (HTTP ${String(response.status)})`;
      await deps.store
        .setJSON(QLD_KEYS.authFailure, {
          version: 1,
          key,
          rejected: true,
          lastAt: deps.now(),
          detail,
        } satisfies z.infer<typeof qldAuthFailureSchema>)
        .catch((error: unknown) => {
          console.error('Recording the refusal in qld/auth/failure failed', error);
        });
      throw new UpstreamError('credentials_rejected', detail);
    }
    if (!response.ok) throw statusError(response.status, path);

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      console.error(`Unexpected ${path} shape`, parsed.error.issues.slice(0, 5));
      throw new UpstreamError('bad_response', `${path}: unexpected body`);
    }
    return parsed.data;
  }

  return {
    /** Sites, brands and suburbs: once a day, as the manual asks. Three calls. */
    async fetchReference() {
      const sites = await get(
        'reference',
        `/Subscriber/GetFullSiteDetails?${QUEENSLAND}`,
        qldSitesResponseSchema,
      );
      const brands = await get(
        'reference',
        `/Subscriber/GetCountryBrands?${COUNTRY}`,
        qldBrandsResponseSchema,
      );
      const regions = await get(
        'reference',
        `/Subscriber/GetCountryGeographicRegions?${COUNTRY}`,
        qldRegionsResponseSchema,
      );
      return { sites: sites.S, brands, regions };
    },

    /** Every current Queensland price. One call; at most once a minute. */
    async fetchPrices() {
      const prices = await get(
        'prices',
        `/Price/GetSitesPrices?${QUEENSLAND}`,
        qldPricesResponseSchema,
      );
      return prices.SitePrices;
    },
  };
}
