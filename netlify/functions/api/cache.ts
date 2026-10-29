import { json } from './http';

/*
 * How long each /api answer may be kept, and what it is keyed on. Moved out
 * of router.ts in round 16; the reasons are in the comments below and in
 * docs/decisions.md (rounds 9 and 16).
 */

export const ROUTES = ['nearby', 'location', 'places', 'status', 'stations', 'history'] as const;
export type Route = (typeof ROUTES)[number];

/*
 * CACHING. Answers come from a snapshot that changes every 30 minutes and cost
 * no upstream calls, so the CDN is now about speed and function invocations,
 * not quota. A minute at the edge (plus a minute of stale-while-revalidate)
 * means a new snapshot is visible within about two minutes of being written,
 * and a burst of identical requests runs the function about once a minute.
 *
 * `Netlify-CDN-Cache-Control` is for Netlify's edge only and is stripped
 * before the response leaves it; `durable` shares one edge node's miss with
 * the rest. `Cache-Control` is the browser's, kept equally short.
 */
export const CACHE = {
  browser: 'public, max-age=60',
  cdn: 'public, durable, s-maxage=60, stale-while-revalidate=60',
} as const;

/**
 * Suggestions come from the bundled ABS list, which only changes with a
 * deploy - and a deploy purges Netlify's CDN - so they can be cached for a
 * day at the edge and an hour in the browser.
 */
export const SUGGESTION_CACHE = {
  browser: 'public, max-age=3600',
  cdn: 'public, durable, s-maxage=86400',
} as const;

/**
 * History changes once a day, when the scheduled job folds yesterday in, so
 * ten minutes at the edge costs nothing in freshness.
 */
export const HISTORY_CACHE = {
  browser: 'public, max-age=600',
  cdn: 'public, durable, s-maxage=600, stale-while-revalidate=600',
} as const;

/**
 * /api/status: 30 seconds at the edge (round 16). A monitor every 15
 * minutes loses nothing, and a flood of status requests, which ran the
 * function every time, now runs it about twice a minute. Never in the
 * browser: a person reloading it wants a fresh answer.
 */
export const STATUS_CACHE = {
  browser: 'no-store',
  cdn: 'public, durable, s-maxage=30',
} as const;

/**
 * A GET's 4xx: a minute at the edge, never in the browser (round 16). It
 * depends only on the query and the snapshot, so a repeated bad request is
 * answered by the CDN, not the function. A 5xx is never cached: a missing
 * snapshot must not be pinned.
 */
export const ERROR_CDN_CACHE = 'public, durable, s-maxage=60';

/*
 * CACHE KEYS. Netlify's CDN keys a function's response on every query
 * parameter by default (`Netlify-Vary: query`), so `?query=gos&x=1` would
 * miss the cache and run the function each time: a cheap way to spend the
 * team's monthly invocations. Each route names the parameters its answer
 * depends on; requests that differ only in anything else share an entry.
 * Parameter order is already ignored by the CDN. Names and values stay
 * case-sensitive, which is why the client sends them in one canonical form.
 */
export const VARY: Record<Route, string> = {
  nearby: 'query=fuel|lat|lng|radius',
  location: 'query=fuel|query|radius',
  places: 'query=query',
  stations: 'query=codes',
  history: 'query=fuel|station',
  // Status reads no parameter, but Netlify-Vary has to name one: it names
  // one the route never reads, so every query shares the one entry.
  status: 'query=status',
};

/** A 200 that the browser and the edge may keep, keyed on its route's parameters. */
export function cached(
  body: unknown,
  cache: { browser: string; cdn: string },
  route: Route,
): Response {
  const response = json(body, 200, cache.browser);
  response.headers.set('Netlify-CDN-Cache-Control', cache.cdn);
  response.headers.set('Netlify-Vary', VARY[route]);
  return response;
}
