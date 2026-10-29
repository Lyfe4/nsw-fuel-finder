// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSnapshot } from './__fixtures__/snapshot';
import { createApiDeps } from './deps';
import { createHandler } from './router';
import { qldDataNotice } from '../../../shared/api';
import { fakeQld, QLD_FIXTURE_AT } from '../../lib/__fixtures__/fakeQld';
import { runQldSnapshot } from '../../lib/qld/run';
import { KEYS, memoryStore, QLD_KEYS } from '../../lib/store';

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

async function api(options: { nsw?: boolean; qld?: boolean; env?: Record<string, string> } = {}) {
  const { store } = memoryStore();
  if (options.nsw ?? true) {
    await store.setJSON(KEYS.snapshot, nswSnapshot, {
      fetchedAt: nswSnapshot.fetchedAt,
      stationCount: nswSnapshot.stations.length,
    });
  }
  if (options.qld ?? true) {
    expect((await runQldSnapshot(fakeQld({}, store).deps)).ok).toBe(true);
  }
  const handler = createHandler(createApiDeps(store, () => NOW, options.env ?? ON));
  // The caller names what it expects back; a cast either way, kept in one place.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const get = async <T>(path: string) => {
    const response = await handler(new Request(`http://localhost:8888${path}`));
    return { status: response.status, body: (await response.json()) as T };
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
