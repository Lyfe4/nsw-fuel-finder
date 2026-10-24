// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callsRecordSchema } from './calls';
import { snapshotSchema } from './format';
import { historyDaySchema } from './history';
import { runSnapshot, worthRetrying } from './run';
import { FIXTURE_FETCHED_AT, fakeUpstream, jsonResponse } from '../__fixtures__/fakeUpstream';
import { KEYS, memoryStore } from '../store';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSnapshot', () => {
  it('writes the snapshot, today’s history and the run log', async () => {
    const { store, keys } = memoryStore();
    const summary = await runSnapshot(fakeUpstream({}, store).deps);

    expect(summary).toMatchObject({ ok: true, calls: { token: 1, prices: 1 } });
    expect(keys()).toEqual([
      'auth/token',
      'history/v1/2026-10-21',
      'meta/calls/2026-10',
      'meta/last-run',
      'snapshot/v1/latest',
    ]);

    const snapshot = snapshotSchema.parse(await store.getJSON(KEYS.snapshot, 'strong'));
    expect(snapshot.fetchedAt).toBe(new Date(FIXTURE_FETCHED_AT).toISOString());
    expect(await store.getMetadata(KEYS.snapshot, 'strong')).toEqual({
      fetchedAt: snapshot.fetchedAt,
      stationCount: snapshot.stations.length,
    });
    expect(
      historyDaySchema.safeParse(await store.getJSON(KEYS.historyDay('2026-10-21'), 'strong'))
        .success,
    ).toBe(true);
    expect(await store.getJSON(KEYS.lastRun, 'strong')).toEqual(summary);
  });

  it('costs one call per run once the token is stored', async () => {
    const { store } = memoryStore();
    await runSnapshot(fakeUpstream({}, store).deps);
    const second = fakeUpstream({}, store);
    second.advance(30 * 60_000);

    expect((await runSnapshot(second.deps)).calls).toEqual({ token: 0, prices: 1 });
  });

  it('folds each run into the same day’s history', async () => {
    const { store } = memoryStore();
    await runSnapshot(fakeUpstream({}, store).deps);
    const later = fakeUpstream({}, store);
    later.advance(30 * 60_000);
    await runSnapshot(later.deps);

    const day = historyDaySchema.parse(
      await store.getJSON(KEYS.historyDay('2026-10-21'), 'strong'),
    );
    const [min, max, last] = day.fuels.U91?.['2263'] ?? [];
    expect([min, max, last]).toEqual([237.9, 237.9, 237.9]);
  });

  it('keeps the previous snapshot when a response is missing most stations', async () => {
    const { store } = memoryStore();
    await runSnapshot(fakeUpstream({}, store).deps);
    const before = await store.getJSON(KEYS.snapshot, 'strong');

    const partial = fakeUpstream(
      { prices: [() => jsonResponse({ stations: [], prices: [] })] },
      store,
    );
    partial.advance(30 * 60_000);
    const summary = await runSnapshot(partial.deps);

    expect(summary).toMatchObject({ ok: false, error: { kind: 'partial_response' } });
    expect(worthRetrying(summary)).toBe(false);
    expect(await store.getJSON(KEYS.snapshot, 'strong')).toEqual(before);
  });

  it('records a failed run without touching the snapshot', async () => {
    const { store } = memoryStore();
    const summary = await runSnapshot(
      fakeUpstream({ prices: [() => jsonResponse({}, 503)] }, store).deps,
    );

    expect(summary).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(await store.getJSON(KEYS.snapshot, 'strong')).toBeNull();
    expect(await store.getJSON(KEYS.lastRun, 'strong')).toEqual(summary);
  });

  it('counts every API.NSW call by month, failed runs included', async () => {
    const { store } = memoryStore();
    await runSnapshot(fakeUpstream({}, store).deps);
    const failing = fakeUpstream({ prices: [() => jsonResponse({}, 503)] }, store);
    failing.advance(30 * 60_000);
    await runSnapshot(failing.deps);

    expect(callsRecordSchema.parse(await store.getJSON('meta/calls/2026-10', 'strong'))).toEqual({
      version: 1,
      month: '2026-10',
      token: 1,
      prices: 2,
      runs: 2,
    });
  });
});

/*
 * A 5xx from the scheduled function makes Netlify run it again within
 * seconds, and every run spends quota. Only failures a second try can fix
 * get one.
 */
describe('worthRetrying', () => {
  const failed = (kind: string) => ({
    ok: false,
    startedAt: '2026-10-21T03:21:27.000Z',
    calls: { token: 0, prices: 1 },
    error: { kind, message: '' },
  });

  it.each(['unavailable', 'timeout', 'bad_response', 'internal'])('retries %s', (kind) => {
    expect(worthRetrying(failed(kind))).toBe(true);
  });

  it.each([
    'not_configured',
    'credentials_rejected',
    'credentials_locked',
    'rate_limited',
    'request_rejected',
    'partial_response',
  ])('does not spend another call on %s', (kind) => {
    expect(worthRetrying(failed(kind))).toBe(false);
  });

  it('never retries a run that worked', () => {
    expect(worthRetrying({ ...failed('internal'), ok: true })).toBe(false);
  });
});
