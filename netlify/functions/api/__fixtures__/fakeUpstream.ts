import { vi } from 'vitest';

import { BASE_URL, createFuelApiClient, type FuelApiDeps } from '../upstream';
import token from './token.json';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const TOKEN_PATH = '/oauth/client_credential/accesstoken';

/**
 * A stand-in for API.NSW. Each path gets a queue of responders; the last one
 * repeats. The token endpoint answers with the token fixture unless told
 * otherwise. Every call is recorded for assertions.
 */
export function fakeUpstream(routes: Record<string, Responder[]> = {}) {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, Responder[]>(Object.entries(routes));
  if (!queues.has(TOKEN_PATH)) queues.set(TOKEN_PATH, [() => jsonResponse(token)]);

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { url: url.toString(), method: init?.method ?? 'GET', headers, body };
    calls.push(call);

    const queue = queues.get(url.pathname);
    const responder = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (!responder) throw new Error(`fakeUpstream: no route for ${url.pathname}`);
    return responder(call);
  });

  let now = Date.UTC(2026, 9, 21, 2, 0, 0);
  const deps: FuelApiDeps = {
    fetch: fetchImpl,
    now: () => now,
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
    credentials: () => ({ apiKey: 'test-api-key', apiSecret: 'test-api-secret' }),
  };

  return {
    calls,
    deps,
    fetch: fetchImpl,
    advance: (ms: number) => {
      now += ms;
    },
    client: (overrides: Partial<FuelApiDeps> = {}) =>
      createFuelApiClient({ ...deps, ...overrides }),
    dataCalls: () => calls.filter((call) => !call.url.startsWith(`${BASE_URL}${TOKEN_PATH}`)),
    tokenCalls: () => calls.filter((call) => call.url.startsWith(`${BASE_URL}${TOKEN_PATH}`)),
  };
}

export const PATHS = {
  token: TOKEN_PATH,
  reference: '/FuelCheckRefData/v2/fuel/lovs',
  nearby: '/FuelPriceCheck/v2/fuel/prices/nearby',
  location: '/FuelPriceCheck/v2/fuel/prices/location',
} as const;
