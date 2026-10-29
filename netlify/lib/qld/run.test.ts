// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFERENCE_REFRESH_MS, runQldSnapshot } from './run';
import { config } from '../../functions/snapshot-qld/snapshot-qld';
import { fakeQld, QLD_FIXTURE_AT } from '../__fixtures__/fakeQld';
import { fakeUpstream, jsonResponse } from '../__fixtures__/fakeUpstream';
import { anyCallsRecordSchema } from '../snapshot/calls';
import { QLD_SNAPSHOT_INTERVAL_MINUTES, snapshotSchema } from '../snapshot/format';
import { runSnapshot, worthRetrying } from '../snapshot/run';
import { memoryStore, QLD_KEYS } from '../store';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MINUTE = 60_000;

describe('the QLD schedule', () => {
  it('runs as often as the staleness rules and the licence assume', () => {
    expect(config.schedule).toBe(`*/${String(QLD_SNAPSHOT_INTERVAL_MINUTES)} * * * *`);
  });
});

describe('runQldSnapshot', () => {
  it('writes only under qld/: snapshot, reference, today’s history and its records', async () => {
    const { store, keys } = memoryStore();
    const fake = fakeQld({}, store);
    const summary = await runQldSnapshot(fake.deps);

    expect(summary).toMatchObject({ ok: true, calls: { reference: 3, prices: 1 } });
    expect(keys()).toEqual([
      'qld/history/v1/2026-10-29',
      'qld/meta/calls/2026-10',
      'qld/meta/last-run',
      'qld/reference/v1',
      'qld/snapshot/v1/latest',
    ]);
    const snapshot = snapshotSchema.parse(await store.getJSON(QLD_KEYS.snapshot, 'strong'));
    expect(await store.getMetadata(QLD_KEYS.snapshot, 'strong')).toEqual({
      fetchedAt: snapshot.fetchedAt,
      stationCount: 3,
    });
    expect(await store.getJSON(QLD_KEYS.lastRun, 'strong')).toEqual(summary);
    expect(
      anyCallsRecordSchema.parse(await store.getJSON(QLD_KEYS.calls('2026-10'), 'strong')),
    ).toEqual({
      version: 1,
      month: '2026-10',
      runs: 1,
      reference: 3,
      prices: 1,
    });
  });

  it('costs one call a run once the reference data is stored, and three more a day', async () => {
    const { store } = memoryStore();
    await runQldSnapshot(fakeQld({}, store).deps);

    const next = fakeQld({}, store);
    next.advance(10 * MINUTE);
    expect((await runQldSnapshot(next.deps)).calls).toEqual({ reference: 0, prices: 1 });

    const nextDay = fakeQld({}, store);
    nextDay.advance(REFERENCE_REFRESH_MS);
    const summary = await runQldSnapshot(nextDay.deps);
    expect(summary.calls).toEqual({ reference: 3, prices: 1 });
    expect(summary.stats?.reference.refreshed).toBe(true);
  });

  it('keeps going on yesterday’s reference data when the refresh fails', async () => {
    const { store } = memoryStore();
    await runQldSnapshot(fakeQld({}, store).deps);
    const failing = fakeQld({ sites: [() => new Response('', { status: 500 })] }, store);
    failing.advance(REFERENCE_REFRESH_MS);
    const summary = await runQldSnapshot(failing.deps);
    expect(summary.ok).toBe(true);
    expect(summary.stats?.reference).toEqual({
      fetchedAt: new Date(QLD_FIXTURE_AT).toISOString(),
      refreshed: false,
      error: 'unavailable',
    });
  });

  it('fails without any reference data to fall back on', async () => {
    const fake = fakeQld({ brands: [() => new Response('', { status: 500 })] });
    const summary = await runQldSnapshot(fake.deps);
    expect(summary).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(fake.callsTo('prices')).toHaveLength(0);
    expect(worthRetrying(summary)).toBe(true);
  });

  it('stops on a refused token even when it could use stored reference data', async () => {
    const { store } = memoryStore();
    await runQldSnapshot(fakeQld({}, store).deps);
    const refused = fakeQld({ sites: [() => new Response('', { status: 401 })] }, store);
    refused.advance(REFERENCE_REFRESH_MS);
    const summary = await runQldSnapshot(refused.deps);
    expect(summary).toMatchObject({ ok: false, error: { kind: 'credentials_rejected' } });
    expect(refused.callsTo('prices')).toHaveLength(0);
    expect(worthRetrying(summary)).toBe(false);
  });

  it('keeps the previous snapshot when most stations are missing', async () => {
    const { store } = memoryStore();
    await runQldSnapshot(fakeQld({}, store).deps);
    const before = await store.getJSON(QLD_KEYS.snapshot, 'strong');
    const thin = fakeQld({ prices: [() => jsonResponse({ SitePrices: [] })] }, store);
    thin.advance(10 * MINUTE);
    expect(await runQldSnapshot(thin.deps)).toMatchObject({
      ok: false,
      error: { kind: 'partial_response' },
    });
    expect(await store.getJSON(QLD_KEYS.snapshot, 'strong')).toEqual(before);
  });

  it('keeps Queensland’s days and months in Brisbane time', async () => {
    // 13:30 UTC on 31 October: 00:30 on 1 November in Sydney (daylight
    // saving), still 23:30 on 31 October in Brisbane.
    const { store, keys } = memoryStore();
    const fake = fakeQld({}, store);
    fake.advance(Date.UTC(2026, 9, 31, 13, 30) - QLD_FIXTURE_AT);
    await runQldSnapshot(fake.deps);
    expect(keys()).toContain('qld/history/v1/2026-10-31');
    expect(keys()).toContain('qld/meta/calls/2026-10');
  });
});

/*
 * THE ISOLATION RULE (docs/qld-plan.md): a QLD failure must never change
 * anything NSW wrote, and the reverse. Both jobs share one Blobs store.
 */
describe('NSW and QLD in one store', () => {
  async function dump(store: ReturnType<typeof memoryStore>, prefix: (key: string) => boolean) {
    const entries: Record<string, unknown> = {};
    for (const key of store.keys().filter(prefix)) {
      entries[key] = {
        value: await store.store.getJSON(key, 'strong'),
        metadata: await store.store.getMetadata(key, 'strong'),
      };
    }
    return entries;
  }
  const isQld = (key: string) => key.startsWith('qld/');
  const isNsw = (key: string) => !isQld(key);

  /** The routes to fake, and whether the token is missing. */
  const qldFailures: [string, Parameters<typeof fakeQld>[0], boolean][] = [
    ['a refused token', { prices: [() => new Response('', { status: 401 })] }, false],
    ['a 500', { prices: [() => new Response('', { status: 500 })] }, false],
    ['a bad body', { prices: [() => jsonResponse(null)] }, false],
    ['a missing token', {}, true],
  ];

  it.each(qldFailures)(
    'a QLD run failing with %s leaves NSW untouched',
    async (_name, routes, noToken) => {
      const both = memoryStore();
      await runSnapshot(fakeUpstream({}, both.store).deps);
      await runQldSnapshot(fakeQld({}, both.store).deps);
      const nswBefore = await dump(both, isNsw);

      const failing = noToken ? fakeQld(routes, both.store, null) : fakeQld(routes, both.store);
      failing.advance(REFERENCE_REFRESH_MS);
      expect((await runQldSnapshot(failing.deps)).ok).toBe(false);
      expect(await dump(both, isNsw)).toEqual(nswBefore);
    },
  );

  it('an NSW run failing, even refused, leaves QLD untouched', async () => {
    const both = memoryStore();
    await runQldSnapshot(fakeQld({}, both.store).deps);
    const qldBefore = await dump(both, isQld);

    const refused = fakeUpstream({ token: [() => jsonResponse({}, 401)] }, both.store);
    expect((await runSnapshot(refused.deps)).ok).toBe(false);
    const down = fakeUpstream({ prices: [() => jsonResponse({}, 503)] }, memoryStore().store);
    expect((await runSnapshot({ ...down.deps, store: both.store })).ok).toBe(false);
    expect(await dump(both, isQld)).toEqual(qldBefore);
  });
});
