// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_FETCHED_AT, fixtureSnapshot } from './__fixtures__/snapshot';
import { createApiDeps, isQldPublic } from './deps';
import { createHandler } from './router';
import { fakeQld, QLD_FIXTURE_AT } from '../../lib/__fixtures__/fakeQld';
import { runQldSnapshot } from '../../lib/qld/run';
import { KEYS, memoryStore, QLD_KEYS, type KeyValueStore } from '../../lib/store';

import type { StationsResponse, StatusResponse } from '../../../shared/api';

/*
 * QUEENSLAND IS NOT PUBLIC UNTIL QLD_PUBLIC IS ON (round 15). Not before the
 * owner confirms publisher approval: as a data consumer, showing the data is
 * not allowed (licence clauses 2.3 and 3.1; docs/qld-plan.md).
 *
 * These tests build the API exactly as the function does (createApiDeps)
 * over one store holding everything the QLD job writes, plus the per-station
 * and daily history it will write later, and ask every route for it. Each
 * read is recorded, so the proof is not only "no QLD in the answer" but "no
 * route but /api/status reads anything from Queensland, and that one reads
 * run health and metadata only".
 */

const NOW = FIXTURE_FETCHED_AT + 60_000;
const QLD_CODES = ['qld-61000001', 'qld-61000002', 'qld-61000004'];
/** Names and address fragments that exist only in Queensland's data. */
const QLD_TEXT = [
  'Test Fuel Coolangatta',
  'Sample Servo Surat',
  'Example Brisbane',
  'Quiet Roadhouse',
  'Example Ave',
  ' QLD 4',
];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every read, as `method key`. */
function recording(store: KeyValueStore) {
  const reads: string[] = [];
  const wrapped: KeyValueStore = {
    getJSON: (key, consistency) => {
      reads.push(`getJSON ${key}`);
      return store.getJSON(key, consistency);
    },
    getJSONWithEtag: (key, consistency) => {
      reads.push(`getJSONWithEtag ${key}`);
      return store.getJSONWithEtag(key, consistency);
    },
    getMetadata: (key, consistency) => {
      reads.push(`getMetadata ${key}`);
      return store.getMetadata(key, consistency);
    },
    setJSON: (key, value, metadata) => store.setJSON(key, value, metadata),
    delete: (key) => store.delete(key),
  };
  return { store: wrapped, reads };
}

const qldHistory = (code: string, source: 'snapshots' | 'fuelcheck-monthly') => ({
  version: 2,
  code,
  source,
  from: '2026-10-20',
  through: '2026-10-20',
  fuels: { U91: [['2026-10-20', 239.9, 241.9, 241.9]] },
});

async function seeded(env: Record<string, string | undefined>, now = NOW) {
  const { store, keys } = memoryStore();
  // NSW, as production has it.
  await store.setJSON(KEYS.snapshot, fixtureSnapshot, {
    fetchedAt: fixtureSnapshot.fetchedAt,
    stationCount: fixtureSnapshot.stations.length,
  });
  await store.setJSON(KEYS.lastRun, {
    ok: true,
    startedAt: fixtureSnapshot.fetchedAt,
    fetchedAt: fixtureSnapshot.fetchedAt,
  });
  // Queensland, as the real job writes it.
  expect((await runQldSnapshot(fakeQld({}, store).deps)).ok).toBe(true);
  // And what its fold (and a future backfill) will write: per-station files,
  // in the key family NSW's history route reads, and a Brisbane day file.
  for (const code of QLD_CODES) {
    await store.setJSON(KEYS.historyLive(code), qldHistory(code, 'snapshots'));
    await store.setJSON(KEYS.historyBackfill(code), qldHistory(code, 'fuelcheck-monthly'));
  }
  await store.setJSON(QLD_KEYS.historyDay('2026-10-20'), {
    version: 1,
    day: '2026-10-20',
    fuels: { U91: { 'qld-61000001': [239.9, 241.9, 241.9] } },
  });
  expect(keys().filter((key) => key.startsWith('qld/') || key.includes('qld-')).length).toBe(12);

  const recorded = recording(store);
  const handler = createHandler(createApiDeps(recorded.store, () => now, env));
  const get = async (path: string) => {
    const response = await handler(new Request(`http://localhost:8888${path}`));
    return { status: response.status, text: await response.text() };
  };
  return { get, reads: recorded.reads };
}

const [nswStation] = fixtureSnapshot.stations;
if (!nswStation) throw new Error('the NSW fixture has no stations');

/** Every route that reads the store for prices, stations or places. */
const PUBLIC_ROUTES = [
  // At a QLD station by the border (inside the NSW box), and at an NSW one.
  '/api/nearby?lat=-28.16&lng=153.51&fuel=U91&radius=25',
  '/api/nearby?lat=-28.16&lng=153.51&fuel=PDL&radius=25',
  `/api/nearby?lat=${nswStation.lat.toFixed(2)}&lng=${nswStation.lng.toFixed(2)}&fuel=U91&radius=25`,
  '/api/location?query=Coolangatta&fuel=U91&radius=25',
  '/api/location?query=4225&fuel=U91',
  '/api/location?query=Coolangatta%20QLD%204225&fuel=U91',
  '/api/location?query=Surat&fuel=U91',
  '/api/location?query=Brisbane&fuel=PDL',
  '/api/location?query=Wyoming&fuel=U91',
  '/api/places?query=coolang',
  '/api/places?query=surat',
  '/api/places?query=4225',
  `/api/stations?codes=${QLD_CODES.join(',')}`,
  `/api/stations?codes=${nswStation.code},${QLD_CODES.join(',')}`,
  ...QLD_CODES.map((code) => `/api/history?station=${code}&fuel=U91`),
  ...QLD_CODES.map((code) => `/api/history?station=${code}&fuel=PDL`),
  `/api/history?station=${nswStation.code}&fuel=U91`,
];

describe.each([
  ['unset', undefined],
  ['"false"', 'false'],
  ['"1"', '1'],
  ['"TRUE"', 'TRUE'],
  ['" true"', ' true'],
])('with QLD_PUBLIC %s', (_label, value) => {
  const env = { QLD_PUBLIC: value };

  it('is off', () => {
    expect(isQldPublic(env)).toBe(false);
  });

  it.each(PUBLIC_ROUTES)('%s returns no Queensland station, price or place', async (path) => {
    const { get } = await seeded(env);
    const { status, text } = await get(path);
    expect(status).toBeLessThan(500);
    for (const fragment of QLD_TEXT) expect(text).not.toContain(fragment);

    if (path.startsWith('/api/stations')) {
      // The requested codes come back as "missing", and only as that.
      const body = JSON.parse(text) as StationsResponse;
      expect(body.stations.every((station) => !station.stationCode.startsWith('qld-'))).toBe(true);
      expect(body.missing).toEqual(QLD_CODES);
    } else if (path.startsWith('/api/history?station=qld-')) {
      expect(status).toBe(404);
    } else {
      expect(text).not.toContain('qld-');
    }
  });

  it('no route but /api/status reads anything from Queensland', async () => {
    const { get, reads } = await seeded(env);
    for (const path of PUBLIC_ROUTES) await get(path);
    expect(reads.filter((read) => read.includes('qld/') || read.includes('qld-'))).toEqual([]);
  });

  it('/api/status reports QLD run health, from records and metadata only', async () => {
    const { get, reads } = await seeded(env);
    const { text } = await get('/api/status');
    const body = JSON.parse(text) as StatusResponse;

    expect(body.sources.qld).toMatchObject({ public: false });
    expect(body.sources.qld.lastRun?.ok).toBe(true);
    expect(body.sources.qld.written?.stations).toBe(3);

    for (const fragment of [...QLD_TEXT, 'qld-', 'priceCents', '"prices"', '239.9']) {
      expect(text).not.toContain(fragment);
    }
    expect(reads.filter((read) => read.includes('qld/') || read.includes('qld-')).sort()).toEqual([
      'getJSON qld/meta/calls/2026-10',
      'getJSON qld/meta/last-run',
      'getMetadata qld/reference/v1',
      'getMetadata qld/snapshot/v1/latest',
    ]);
  });

  it('/api/status does not fail on a stalled QLD job while QLD is not public', async () => {
    // A day after the last QLD run: a problem in sources.qld, none at the top.
    const { get } = await seeded(env, QLD_FIXTURE_AT + 24 * 60 * 60_000);
    const body = JSON.parse((await get('/api/status')).text) as StatusResponse;
    expect(body.sources.qld.healthy).toBe(false);
    expect(body.sources.qld.problems.length).toBeGreaterThan(0);
    expect(body.problems.filter((problem) => problem.startsWith('QLD:'))).toEqual([]);
  });
});
