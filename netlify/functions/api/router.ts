import { ApiError, errorResponse, json } from './http';
import { normalisePrices, normaliseReference } from './normalise';
import { parseLocationQuery, parseNearbyQuery } from './validate';

import type { FuelApiClient } from './upstream';

/*
 * CACHING. The free API.NSW plan is 2,500 calls a month, so the CDN is what
 * keeps this site inside quota, not a nicety.
 *
 * - `Cache-Control` is for the browser. Kept short, because a browser cache
 *   cannot be purged.
 * - `Netlify-CDN-Cache-Control` is for Netlify's edge only and is stripped
 *   before the response leaves it. `durable` puts the response in Netlify's
 *   shared cache, so one edge node's miss fills it for every other node,
 *   instead of each node spending its own upstream call.
 *
 * Reference data (fuel types, brands) changes a few times a year: a day at
 * the CDN. Prices: retailers report changes as they make them and a station
 * changes price a few times a day at most, so five minutes is fresh enough
 * to be useful and stale-while-revalidate keeps it fast at expiry.
 */
const CACHE = {
  reference: {
    browser: 'public, max-age=3600',
    cdn: 'public, durable, s-maxage=86400, stale-while-revalidate=86400',
  },
  prices: {
    browser: 'public, max-age=60',
    cdn: 'public, durable, s-maxage=300, stale-while-revalidate=300',
  },
} as const;

/** The only paths this function answers. Anything else is a 404. */
const ROUTES = ['reference', 'nearby', 'location'] as const;
type Route = (typeof ROUTES)[number];

// Reached through the /api/* rewrite or, in `netlify dev`, directly.
const PREFIX = /^\/(?:api|\.netlify\/functions\/api)\/([^/]+)\/?$/;

function matchRoute(pathname: string): Route | null {
  const name = PREFIX.exec(pathname)?.[1];
  return ROUTES.find((route) => route === name) ?? null;
}

function cached(body: unknown, cache: { browser: string; cdn: string }): Response {
  const response = json(body, 200, cache.browser);
  response.headers.set('Netlify-CDN-Cache-Control', cache.cdn);
  return response;
}

async function dispatch(route: Route, params: URLSearchParams, client: FuelApiClient) {
  switch (route) {
    case 'reference': {
      return cached(normaliseReference(await client.reference()), CACHE.reference);
    }
    case 'nearby': {
      const query = parseNearbyQuery(params);
      const upstream = await client.nearby(query);
      return cached(
        normalisePrices(upstream, query.fuelType, { includeDistance: true }),
        CACHE.prices,
      );
    }
    case 'location': {
      const query = parseLocationQuery(params);
      const upstream = await client.location(query);
      return cached(
        normalisePrices(upstream, query.fuelType, { includeDistance: false }),
        CACHE.prices,
      );
    }
  }
}

export function createHandler(client: FuelApiClient): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const route = matchRoute(url.pathname);
      if (!route) throw new ApiError('not_found', 'No such endpoint.');
      if (request.method !== 'GET') {
        throw new ApiError('method_not_allowed', 'Only GET is supported.');
      }
      return await dispatch(route, url.searchParams, client);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      console.error('Unhandled error in /api', error);
      return errorResponse(new ApiError('internal_error', 'Something went wrong.'));
    }
  };
}
