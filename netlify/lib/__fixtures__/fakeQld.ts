import { vi } from 'vitest';

import { jsonResponse } from './fakeUpstream';
import { memoryStore } from '../store';

import type { QldDeps } from '../qld/client';

/*
 * A stand-in for the Queensland Fuel Prices API. The responses are
 * SYNTHETIC: the shapes, quirks and value ranges of the live responses of
 * 29 October 2026 (docs/qld-plan.md), with made-up sites. Real QLD data is
 * licensed, and committing it to a public repository would be distributing
 * it (licence clause 3.1), so unlike NSW's fixture this is not a recording.
 */

/** 2026-10-29 00:48:28 UTC: when the live prices were fetched. */
export const QLD_FIXTURE_AT = Date.UTC(2026, 9, 29, 0, 48, 28);

export const QLD_TEST_TOKEN = '0f0f0f0f-1111-4222-8333-444455556666';

export const QLD_PATHS = {
  sites: '/Subscriber/GetFullSiteDetails',
  brands: '/Subscriber/GetCountryBrands',
  regions: '/Subscriber/GetCountryGeographicRegions',
  prices: '/Price/GetSitesPrices',
} as const;

const hours = { MO: '', MC: '', TO: '', TC: '', SUO: '', SUC: '' };

export const qldSites = {
  S: [
    // Near the border: Coolangatta.
    {
      S: 61000001,
      A: '1 Example Ave',
      N: 'Test Fuel Coolangatta',
      B: 2,
      P: '4225',
      G1: 900001,
      G2: 800001,
      G3: 1,
      G4: 0,
      G5: 0,
      Lat: -28.164,
      Lng: 153.514,
      M: '2024-01-01T00:00:00.000',
      GPI: 'synthetic',
      ...hours,
    },
    // Stray spaces, a brand QLD spells differently, a suburb in capitals.
    {
      S: 61000002,
      A: ' 10  Sample  St',
      N: 'Sample  Servo Surat',
      B: 3,
      P: '4417',
      G1: 900002,
      G2: 800002,
      G3: 1,
      G4: 0,
      G5: 0,
      Lat: -27.152,
      Lng: 149.068,
      M: null,
      GPI: '',
      ...hours,
    },
    // No prices at all.
    {
      S: 61000003,
      A: null,
      N: 'Quiet Roadhouse',
      B: 2,
      P: '4497',
      G1: 900002,
      G2: 800002,
      G3: 1,
      G4: 0,
      G5: 0,
      Lat: -28.97,
      Lng: 148.98,
      M: null,
      GPI: '',
      ...hours,
    },
    // No street, and a suburb the region list does not know.
    {
      S: 61000004,
      A: '',
      N: 'Example Brisbane',
      B: 99,
      P: 4000,
      G1: 999999,
      G2: 800003,
      G3: 1,
      G4: 0,
      G5: 0,
      Lat: -27.47,
      Lng: 153.02,
      M: null,
      GPI: '',
      ...hours,
    },
    // Malformed: dropped and counted.
    { S: 'not a number', N: 'Broken' },
  ],
};

export const qldBrands = {
  Brands: [
    { BrandId: 2, Name: 'Caltex' },
    { BrandId: 3, Name: '7 Eleven' },
  ],
};

export const qldRegions = {
  GeographicRegions: [
    {
      GeoRegionLevel: 3,
      GeoRegionId: 1,
      Name: 'QUEENSLAND',
      Abbrev: 'QLD',
      GeoRegionParentId: null,
    },
    {
      GeoRegionLevel: 2,
      GeoRegionId: 800001,
      Name: 'Gold Coast',
      Abbrev: 'GC',
      GeoRegionParentId: 1,
    },
    {
      GeoRegionLevel: 1,
      GeoRegionId: 900001,
      Name: 'Coolangatta',
      Abbrev: 'Coolangatta',
      GeoRegionParentId: 800001,
    },
    {
      GeoRegionLevel: 1,
      GeoRegionId: 900002,
      Name: 'SURAT',
      Abbrev: 'SURAT',
      GeoRegionParentId: 800002,
    },
  ],
};

export const qldPrices = {
  SitePrices: [
    {
      SiteId: 61000001,
      FuelId: 2,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-29T00:30:00.123',
      Price: 2399,
    },
    // Unavailable at the site.
    {
      SiteId: 61000001,
      FuelId: 12,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-28T00:00:00',
      Price: 9999,
    },
    // OPAL: a fuel we do not offer.
    {
      SiteId: 61000001,
      FuelId: 21,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-28T00:00:00',
      Price: 2559,
    },
    // A typo: 31.9 c (seen live).
    {
      SiteId: 61000002,
      FuelId: 3,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-28T00:00:00',
      Price: 319,
    },
    {
      SiteId: 61000002,
      FuelId: 8,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-28T22:00:00',
      Price: 2649,
    },
    // Stamped after the fetch: the server's clock runs ahead.
    {
      SiteId: 61000002,
      FuelId: 2,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-29T00:48:35.500',
      Price: 2199,
    },
    {
      SiteId: 61000004,
      FuelId: 14,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-27T05:00:00',
      Price: 2849,
    },
    // A site the site list does not have.
    {
      SiteId: 61999999,
      FuelId: 2,
      CollectionMethod: 'Q',
      TransactionDateUtc: '2026-10-28T00:00:00',
      Price: 2000,
    },
    // Not a timestamp in the API's format.
    {
      SiteId: 61000004,
      FuelId: 2,
      CollectionMethod: 'Q',
      TransactionDateUtc: '29/10/2026 00:00',
      Price: 2100,
    },
    // Malformed.
    { SiteId: 'x', FuelId: 2, Price: 2000 },
  ],
};

type Responder = () => Response;
type Route = keyof typeof QLD_PATHS;

/**
 * Each route has a queue of responders; the last one repeats. Calls are
 * recorded with their headers.
 */
export function fakeQld(
  routes: Partial<Record<Route, Responder[]>> = {},
  store = memoryStore().store,
  token: string | null = QLD_TEST_TOKEN,
) {
  const queues: Record<string, Responder[]> = {
    [QLD_PATHS.sites]: routes.sites ?? [() => jsonResponse(qldSites)],
    [QLD_PATHS.brands]: routes.brands ?? [() => jsonResponse(qldBrands)],
    [QLD_PATHS.regions]: routes.regions ?? [() => jsonResponse(qldRegions)],
    [QLD_PATHS.prices]: routes.prices ?? [() => jsonResponse(qldPrices)],
  };
  const calls: { path: string; search: string; headers: Record<string, string> }[] = [];

  const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({
      path: url.pathname,
      search: url.search,
      headers: Object.fromEntries(new Headers(init?.headers)),
    });
    const queue = queues[url.pathname] ?? [];
    const responder = queue.length > 1 ? queue.shift() : queue[0];
    if (!responder) return Promise.reject(new Error(`fakeQld: no route for ${url.pathname}`));
    try {
      return Promise.resolve(responder());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  let now = QLD_FIXTURE_AT;
  const deps: QldDeps = { fetch: fetchImpl, now: () => now, token: () => token, store };

  return {
    deps,
    store,
    fetch: fetchImpl,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    callsTo: (route: Route) => calls.filter((call) => call.path === QLD_PATHS[route]),
  };
}
