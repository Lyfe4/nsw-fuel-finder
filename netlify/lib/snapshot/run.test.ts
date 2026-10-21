// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotSchema } from './format';
import { historyDaySchema } from './history';
import { runSnapshot } from './run';
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
      'meta/last-run',
      'snapshot/v1/latest',
    ]);

    const snapshot = snapshotSchema.parse(await store.getJSON(KEYS.snapshot));
    expect(snapshot.fetchedAt).toBe(new Date(FIXTURE_FETCHED_AT).toISOString());
    expect(await store.getMetadata(KEYS.snapshot)).toEqual({
      fetchedAt: snapshot.fetchedAt,
      stationCount: snapshot.stations.length,
    });
    expect(
      historyDaySchema.safeParse(await store.getJSON(KEYS.historyDay('2026-10-21'))).success,
    ).toBe(true);
    expect(await store.getJSON(KEYS.lastRun)).toEqual(summary);
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

    const day = historyDaySchema.parse(await store.getJSON(KEYS.historyDay('2026-10-21')));
    const [min, max, last] = day.fuels.U91?.['2263'] ?? [];
    expect([min, max, last]).toEqual([237.9, 237.9, 237.9]);
  });

  it('keeps the previous snapshot when a response is missing most stations', async () => {
    const { store } = memoryStore();
    await runSnapshot(fakeUpstream({}, store).deps);
    const before = await store.getJSON(KEYS.snapshot);

    const partial = fakeUpstream(
      { prices: [() => jsonResponse({ stations: [], prices: [] })] },
      store,
    );
    partial.advance(30 * 60_000);
    const summary = await runSnapshot(partial.deps);

    expect(summary).toMatchObject({ ok: false, error: { kind: 'bad_response' } });
    expect(await store.getJSON(KEYS.snapshot)).toEqual(before);
  });

  it('records a failed run without touching the snapshot', async () => {
    const { store } = memoryStore();
    const summary = await runSnapshot(
      fakeUpstream({ prices: [() => jsonResponse({}, 503)] }, store).deps,
    );

    expect(summary).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(await store.getJSON(KEYS.snapshot)).toBeNull();
    expect(await store.getJSON(KEYS.lastRun)).toEqual(summary);
  });
});
