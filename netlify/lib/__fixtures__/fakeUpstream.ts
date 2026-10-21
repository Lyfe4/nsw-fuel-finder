import { vi } from 'vitest';

import prices from './prices.json';
import token from './token.json';
import { memoryStore } from '../store';

import type { UpstreamDeps } from '../upstream/client';

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type Responder = () => Response;

export const TOKEN_PATH = '/oauth/client_credential/accesstoken';
export const PRICES_PATH = '/FuelPriceCheck/v2/fuel/prices';

/** 2026-10-21 03:21:27 UTC: when the recorded fixture was fetched. */
export const FIXTURE_FETCHED_AT = Date.UTC(2026, 9, 21, 3, 21, 27);

/**
 * A stand-in for API.NSW serving the recorded responses. Each path has a
 * queue of responders; the last one repeats. Calls are recorded.
 */
export function fakeUpstream(
  routes: { token?: Responder[]; prices?: Responder[] } = {},
  store = memoryStore().store,
) {
  const queues = {
    [TOKEN_PATH]: routes.token ?? [() => jsonResponse(token)],
    [PRICES_PATH]: routes.prices ?? [() => jsonResponse(prices)],
  };
  const calls: { path: string; headers: Record<string, string> }[] = [];

  const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ path: url.pathname, headers: Object.fromEntries(new Headers(init?.headers)) });
    const queue =
      url.pathname === TOKEN_PATH || url.pathname === PRICES_PATH ? queues[url.pathname] : [];
    const responder = queue.length > 1 ? queue.shift() : queue[0];
    if (!responder) return Promise.reject(new Error(`fakeUpstream: no route for ${url.pathname}`));
    try {
      return Promise.resolve(responder());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  let now = FIXTURE_FETCHED_AT;
  const deps: UpstreamDeps = {
    fetch: fetchImpl,
    now: () => now,
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
    credentials: () => ({ apiKey: 'test-api-key', apiSecret: 'test-api-secret' }),
    store,
  };

  return {
    deps,
    store,
    fetch: fetchImpl,
    advance: (ms: number) => {
      now += ms;
    },
    tokenCalls: () => calls.filter((call) => call.path === TOKEN_PATH),
    priceCalls: () => calls.filter((call) => call.path === PRICES_PATH),
  };
}
