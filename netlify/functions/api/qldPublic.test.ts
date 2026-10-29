// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSnapshot } from './__fixtures__/snapshot';
import { createApiDeps } from './deps';
import { createHandler } from './router';
import { qldDataNotice, qldPriceNotices } from '../../../shared/api';
import { fakeQld, QLD_FIXTURE_AT } from '../../lib/__fixtures__/fakeQld';
import { runQldSnapshot } from '../../lib/qld/run';
import { KEYS, memoryStore, QLD_KEYS, type KeyValueStore } from '../../lib/store';

import type {
  ApiErrorBody,
  HistoryResponse,
  PlaceSuggestionsResponse,
  PricesResponse,
  StationsResponse,
  StatusResponse,
} from '../../../shared/api';
import type { Snapshot } from '../../lib/snapshot/format';

/*
 * WITH QLD_PUBLIC ON (round 15, phase 1b). Not yet set in production: the
 * owner turns it on after publisher approval (phase 1c). Built as the
 * function builds it, over a store with NSW's snapshot and what the real QLD
 * job writes from the synthetic API.
 */

const NOW = QLD_FIXTURE_AT + 60_000;
const ON = { QLD_PUBLIC: 'true' };

/** An NSW station in Tweed Heads, 2.2 km from the synthetic Coolangatta one. */
const tweed = {
  code: '99001',
  name: 'Border Servo Tweed Heads',
  brand: 'Independent',
  address: '1 Wharf St, TWEED HEADS NSW 2485',
  suburb: 'TWEED HEADS',
  postcode: '2485',
  state: 'NSW' as const,
  lat: -28.176,
  lng: 153.541,
  prices: { U91: [236.9, '2026-10-28T23:00:00Z'] as [number, string] },
};
// NSW's snapshot five minutes before the QLD one, so both are fresh.
const nswSnapshot: Snapshot = {
  ...fixtureSnapshot,
  fetchedAt: new Date(QLD_FIXTURE_AT - 5 * 60_000).toISOString(),
  stations: [...fixtureSnapshot.stations, tweed],
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The kill switch's record, as `pnpm qld:switch` writes it. */
const SWITCH_ON = { version: 1, enabled: true, changedAt: '2026-10-29T00:00:00Z' };

async function api(
  options: {
    nsw?: boolean;
    qld?: boolean;
    env?: Record<string, string>;
    /** The request reached the published production deploy (Netlify's context). */
    published?: boolean;
    /** The kill switch record; undefined leaves it unset. */
    killSwitch?: unknown;
    now?: () => number;
  } = {},
) {
  const { store } = memoryStore();
  const killSwitch = 'killSwitch' in options ? options.killSwitch : SWITCH_ON;
  if (killSwitch !== undefined) await store.setJSON(QLD_KEYS.enabled, killSwitch);
  if (options.nsw ?? true) {
    await store.setJSON(KEYS.snapshot, nswSnapshot, {
      fetchedAt: nswSnapshot.fetchedAt,
      stationCount: nswSnapshot.stations.length,
    });
  }
  if (options.qld ?? true) {
    expect((await runQldSnapshot(fakeQld({}, store).deps)).ok).toBe(true);
  }
  const handler = createHandler(
    createApiDeps(store, options.now ?? (() => NOW), options.env ?? ON),
  );
  const context = { deploy: { context: 'production', published: options.published ?? true } };
  // The caller names what it expects back; a cast either way, kept in one place.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const get = async <T>(path: string) => {
    const response = await handler(new Request(`http://localhost:8888${path}`), context);
    return {
      status: response.status,
      body: (await response.json()) as T,
      headers: response.headers,
    };
  };
  return { get, store };
}

const codes = (body: PricesResponse) => body.stations.map((s) => s.stationCode);

describe('searches with Queensland public', () => {
  it('lists both sides of the border in one answer, each source with its own time', async () => {
    const { get } = await api();
    const { status, body } = await get<PricesResponse>(
      '/api/location?query=Tweed%20Heads&fuel=U91&radius=5',
    );
    expect(status).toBe(200);
    expect(codes(body)).toEqual(['99001', 'qld-61000001']);
    expect(body.stations[1]).toMatchObject({
      name: 'Test Fuel Coolangatta',
      address: '1 Example Ave, Coolangatta QLD 4225',
      priceCents: 239.9,
    });
    expect(body.sources).toEqual([
      { id: 'nsw', fetchedAt: nswSnapshot.fetchedAt, stale: false },
      { id: 'qld', fetchedAt: new Date(QLD_FIXTURE_AT).toISOString(), stale: false },
    ]);
    expect(body.unavailable).toEqual([]);
    // The oldest of the two.
    expect(body.fetchedAt).toBe(nswSnapshot.fetchedAt);
  });

  it('lists only the sources with a station in the answer', async () => {
    const { get } = await api();
    const { body } = await get<PricesResponse>('/api/location?query=Surat&fuel=U91');
    expect(codes(body)).toEqual(['qld-61000002']);
    expect(body.sources?.map((s) => s.id)).toEqual(['qld']);
  });

  it('accepts a position in Queensland, and a QLD postcode and label', async () => {
    const { get } = await api();
    expect((await get('/api/nearby?lat=-27.47&lng=153.02&fuel=PDL')).status).toBe(200);
    const byPostcode = await get<PricesResponse>('/api/location?query=4225&fuel=U91');
    expect(codes(byPostcode.body)).toContain('qld-61000001');
    const byLabel = await get<PricesResponse>(
      '/api/location?query=Coolangatta%20QLD%204225&fuel=U91',
    );
    expect(byLabel.body.origin.label).toBe('Coolangatta QLD 4225');
  });

  it('asks which one for a name both states have (the owner’s choice)', async () => {
    const { get } = await api();
    const { status, body } = await get<ApiErrorBody>('/api/location?query=Coolangatta&fuel=U91');
    expect(status).toBe(409);
    expect(body.error.candidates).toEqual(['Coolangatta NSW 2535', 'Coolangatta QLD 4225']);
  });

  it('suggests Queensland places', async () => {
    const { get } = await api();
    const { body } = await get<PlaceSuggestionsResponse>('/api/places?query=coolang');
    expect(body.suggestions).toEqual(
      expect.arrayContaining(['Coolangatta NSW 2535', 'Coolangatta QLD 4225']),
    );
  });

  it('says what it covers when a position is outside it', async () => {
    const { get } = await api();
    const { status, body } = await get<ApiErrorBody>('/api/nearby?lat=-37.81&lng=144.96&fuel=U91');
    expect(status).toBe(400);
    expect(body.error.message).toBe(
      'That location is outside the area we cover. Fuel Finder covers NSW, the ACT and Queensland.',
    );
  });

  it('works out "since yesterday" from Queensland’s own Brisbane day', async () => {
    const { get, store } = await api();
    // The QLD snapshot is 10:48 on 29 October in Brisbane: yesterday is the 28th.
    await store.setJSON(QLD_KEYS.historyDay('2026-10-28'), {
      version: 1,
      day: '2026-10-28',
      fuels: { U91: { 'qld-61000001': [239.9, 241.9, 241.9] } },
    });
    const { body } = await get<PricesResponse>('/api/location?query=4225&fuel=U91');
    expect(body.stations.find((s) => s.stationCode === 'qld-61000001')?.changeCents).toBe(-2);
  });
});

describe('either source missing', () => {
  it('answers from NSW alone when Queensland cannot be read, and says so', async () => {
    const { get } = await api({ qld: false });
    const { status, body } = await get<PricesResponse>(
      '/api/location?query=Tweed%20Heads&fuel=U91&radius=5',
    );
    expect(status).toBe(200);
    expect(codes(body)).toEqual(['99001']);
    expect(body.unavailable).toEqual(['qld']);
  });

  it('answers from Queensland alone when NSW cannot be read, and says so', async () => {
    const { get } = await api({ nsw: false });
    const { status, body } = await get<PricesResponse>(
      '/api/location?query=Tweed%20Heads&fuel=U91&radius=5',
    );
    expect(status).toBe(200);
    expect(codes(body)).toEqual(['qld-61000001']);
    expect(body.unavailable).toEqual(['nsw']);
  });

  it('is a 503 only when neither can be read', async () => {
    const { get } = await api({ nsw: false, qld: false });
    expect((await get('/api/location?query=Tweed%20Heads&fuel=U91')).status).toBe(503);
  });

  it('marks only the source that is stale', async () => {
    const { get, store } = await api();
    const old = new Date(QLD_FIXTURE_AT - 2 * 60 * 60_000).toISOString();
    await store.setJSON(
      KEYS.snapshot,
      { ...nswSnapshot, fetchedAt: old },
      { fetchedAt: old, stationCount: 1 },
    );
    const { body } = await get<PricesResponse>(
      '/api/location?query=Tweed%20Heads&fuel=U91&radius=5',
    );
    expect(body.sources?.map((s) => [s.id, s.stale])).toEqual([
      ['nsw', true],
      ['qld', false],
    ]);
    expect(body.stale).toBe(true);
  });
});

describe('stations and history by Queensland code', () => {
  it('prices a Queensland favourite', async () => {
    const { get } = await api();
    const { body } = await get<StationsResponse>('/api/stations?codes=qld-61000001,99001');
    expect(body.stations.map((s) => s.stationCode)).toEqual(['qld-61000001', '99001']);
    expect(body.missing).toEqual([]);
  });

  it('serves a Queensland station’s history with Queensland’s licence notice', async () => {
    const { get, store } = await api();
    await store.setJSON(KEYS.historyLive('qld-61000001'), {
      version: 2,
      code: 'qld-61000001',
      source: 'snapshots',
      from: '2026-10-28',
      through: '2026-10-28',
      fuels: { U91: [['2026-10-28', 239.9, 241.9, 241.9]] },
    });
    const { status, body } = await get<HistoryResponse>(
      '/api/history?station=qld-61000001&fuel=U91',
    );
    expect(status).toBe(200);
    expect(body.days).toEqual([['2026-10-28', 239.9, 241.9, 241.9]]);
    expect(body.licence).toContain(qldDataNotice(2026));
    expect(body.licence).not.toContain('CC BY-SA');
  });
});

describe('/api/status with Queensland public', () => {
  it('reports NSW against NSW’s own snapshot, not the merged one', async () => {
    const { get, store } = await api();
    await store.setJSON(KEYS.lastRun, {
      ok: true,
      startedAt: nswSnapshot.fetchedAt,
      fetchedAt: nswSnapshot.fetchedAt,
    });
    const { body } = await get<StatusResponse>('/api/status');
    expect(body.served).toEqual({
      fetchedAt: nswSnapshot.fetchedAt,
      stations: nswSnapshot.stations.length,
    });
    expect(body.sources.qld.public).toBe(true);
  });

  it('fails on a Queensland problem, naming the state', async () => {
    const { get } = await api({ qld: false });
    const { status, body } = await get<StatusResponse>('/api/status');
    expect(status).toBe(503);
    expect(body.problems).toContain('QLD: No snapshot has been written.');
  });
});

/*
 * THE GATE (round 16): Queensland only when QLD_PUBLIC is "true", the
 * request reached the published production deploy, AND the owner's kill
 * switch in Blobs is on. Each one shut is enough to keep it out.
 */
describe('the gate', () => {
  const border = '/api/location?query=Tweed%20Heads&fuel=U91&radius=5';

  it('serves Queensland with all three open', async () => {
    const { get } = await api();
    expect(codes((await get<PricesResponse>(border)).body)).toContain('qld-61000001');
  });

  it.each<[string, Parameters<typeof api>[0]]>([
    ['QLD_PUBLIC unset', { env: {} }],
    ['a deploy that is not the published one', { published: false }],
    ['no kill switch record', { killSwitch: undefined }],
    ['the kill switch off', { killSwitch: { ...SWITCH_ON, enabled: false } }],
    ['a kill switch record in an unknown shape', { killSwitch: { enabled: 'yes' } }],
  ])('keeps Queensland out with %s', async (_label, options) => {
    const { get } = await api(options);
    const prices = await get<PricesResponse>(border);
    expect(codes(prices.body)).toEqual(['99001']);
    expect(prices.body.notices).toBeUndefined();
    const stations = await get<StationsResponse>('/api/stations?codes=qld-61000001');
    expect(stations.body.missing).toEqual(['qld-61000001']);
    expect((await get('/api/history?station=qld-61000001&fuel=U91')).status).toBe(404);
    expect((await get('/api/location?query=4225&fuel=U91')).status).toBe(400);
    const status = await get<StatusResponse>('/api/status');
    expect(status.body.sources.qld.public).toBe(false);
  });

  it('treats an unreadable kill switch as off', async () => {
    const { store } = memoryStore();
    await store.setJSON(KEYS.snapshot, nswSnapshot, {
      fetchedAt: nswSnapshot.fetchedAt,
      stationCount: nswSnapshot.stations.length,
    });
    expect((await runQldSnapshot(fakeQld({}, store).deps)).ok).toBe(true);
    await store.setJSON(QLD_KEYS.enabled, SWITCH_ON);
    const failing: KeyValueStore = {
      ...store,
      getJSON: (key, consistency) =>
        key === QLD_KEYS.enabled
          ? Promise.reject(new Error('Blobs is down'))
          : store.getJSON(key, consistency),
    };
    const handler = createHandler(createApiDeps(failing, () => NOW, ON));
    const response = await handler(new Request(`http://localhost:8888${border}`), {
      deploy: { published: true },
    });
    expect(codes((await response.json()) as PricesResponse)).toEqual(['99001']);
  });

  it('takes Queensland out within 15 seconds of the switch going off, with no redeploy', async () => {
    let now = NOW;
    const { get, store } = await api({ now: () => now });
    expect(codes((await get<PricesResponse>(border)).body)).toContain('qld-61000001');

    await store.setJSON(QLD_KEYS.enabled, { ...SWITCH_ON, enabled: false });
    // A warm instance trusts its last read briefly...
    now += 10_000;
    expect(codes((await get<PricesResponse>(border)).body)).toContain('qld-61000001');
    // ...and no longer.
    now += 6_000;
    expect(codes((await get<PricesResponse>(border)).body)).toEqual(['99001']);
  });
});

/*
 * LICENCE CLAUSE 2.3 (round 16): a Queensland snapshot older than 25
 * minutes is not served anywhere, whatever the gate says.
 */
describe('an old Queensland snapshot', () => {
  const later = () => QLD_FIXTURE_AT + 31 * 60_000;

  it('is left out of searches, and listed as unavailable', async () => {
    const { get } = await api({ now: later });
    const { status, body } = await get<PricesResponse>(
      '/api/location?query=Tweed%20Heads&fuel=U91&radius=5',
    );
    expect(status).toBe(200);
    expect(codes(body)).toEqual(['99001']);
    expect(body.unavailable).toEqual(['qld']);
    expect(body.notices).toBeUndefined();
  });

  it('prices no Queensland favourite, saying its source is unavailable, not that it is gone', async () => {
    const { get } = await api({ now: later });
    const { body } = await get<StationsResponse>('/api/stations?codes=qld-61000001,99001');
    expect(body.stations.map((s) => s.stationCode)).toEqual(['99001']);
    expect(body.missing).toEqual(['qld-61000001']);
    expect(body.unavailable).toEqual(['qld']);
  });

  it('serves no Queensland history: unavailable, not "no longer listed"', async () => {
    const { get } = await api({ now: later });
    const { status, body } = await get<ApiErrorBody>('/api/history?station=qld-61000001&fuel=U91');
    expect(status).toBe(503);
    expect(body.error.code).toBe('snapshot_unavailable');
  });

  it('is served up to 25 minutes old', async () => {
    const { get } = await api({ now: () => QLD_FIXTURE_AT + 24 * 60_000 });
    const { body } = await get<PricesResponse>('/api/location?query=4225&fuel=U91');
    expect(codes(body)).toContain('qld-61000001');
    expect(body.unavailable).toEqual([]);
  });
});

describe('licence notices on answers (round 16)', () => {
  it('come with any answer that has a Queensland station, word for word', async () => {
    const { get } = await api();
    const prices = await get<PricesResponse>('/api/location?query=4225&fuel=U91');
    expect(prices.body.notices).toEqual(qldPriceNotices(2026));
    expect(prices.body.notices?.[0]).toMatch(
      /^© State of Queensland \(Department of Energy and Climate\) 2026\. /,
    );
    expect(prices.body.notices?.[1]).toBe('Queensland prices may not be republished.');
    const stations = await get<StationsResponse>('/api/stations?codes=qld-61000001');
    expect(stations.body.notices).toEqual(qldPriceNotices(2026));
  });

  it('are absent when no Queensland station is in the answer', async () => {
    const { get } = await api();
    const stations = await get<StationsResponse>('/api/stations?codes=99001');
    expect(stations.body.stations).toHaveLength(1);
    expect(stations.body.notices).toBeUndefined();
  });
});

describe('/api/status names the deploy that answered (round 16)', () => {
  it.each([true, false])('published: %s, as Netlify says', async (published) => {
    const { get } = await api({ published });
    const { body } = await get<StatusResponse>('/api/status');
    expect(body.deploy).toEqual({ context: 'production', published });
    expect(body.sources.qld.public).toBe(published);
  });
});

describe('/api/status when NSW cannot be read (round 16)', () => {
  it.each<[string, Parameters<typeof api>[0]]>([
    ['with Queensland served', {}],
    ['with Queensland off', { env: {} }],
  ])('reports NSW unhealthy %s', async (_label, options) => {
    const { get, store } = await api({ nsw: false, ...options });
    await store.setJSON(KEYS.lastRun, {
      ok: true,
      startedAt: new Date(NOW - 60_000).toISOString(),
      fetchedAt: new Date(NOW - 60_000).toISOString(),
    });
    const { status, body } = await get<StatusResponse>('/api/status');
    expect(status).toBe(503);
    expect(body.served).toBeNull();
    expect(body.problems).toContain('The API has no snapshot to serve.');
  });
});

describe('caching at the edge (round 16)', () => {
  it('keeps /api/status 30 seconds at the CDN, whatever the query, and not in the browser', async () => {
    const { get } = await api();
    const { headers } = await get('/api/status?anything=1');
    expect(headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=30');
    expect(headers.get('Netlify-Vary')).toBe('query=status');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps a 4xx a minute at the CDN, keyed like its route, and not in the browser', async () => {
    const { get } = await api();
    const bad = await get('/api/location?query=4225&fuel=NOPE&utm_source=x');
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=60');
    expect(bad.headers.get('Netlify-Vary')).toBe('query=fuel|query|radius');
    expect(bad.headers.get('Cache-Control')).toBe('no-store');
    const gone = await get('/api/nope');
    expect(gone.status).toBe(404);
    expect(gone.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, s-maxage=60');
  });

  it('never keeps a 5xx', async () => {
    const { get } = await api({ nsw: false, qld: false });
    const { status, headers } = await get('/api/location?query=Tweed%20Heads&fuel=U91');
    expect(status).toBe(503);
    expect(headers.get('Netlify-CDN-Cache-Control')).toBeNull();
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps Queensland history a minute, as its prices, so switching it off is quick', async () => {
    const { get, store } = await api();
    await store.setJSON(KEYS.historyLive('qld-61000001'), {
      version: 2,
      code: 'qld-61000001',
      source: 'snapshots',
      from: '2026-10-28',
      through: '2026-10-28',
      fuels: { U91: [['2026-10-28', 239.9, 241.9, 241.9]] },
    });
    const { headers } = await get('/api/history?station=qld-61000001&fuel=U91');
    expect(headers.get('Netlify-CDN-Cache-Control')).toBe(
      'public, durable, s-maxage=60, stale-while-revalidate=60',
    );
  });
});
