// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSnapshot } from './__fixtures__/snapshot';
import { createSnapshotSource, SnapshotUnavailableError } from './snapshotSource';
import { KEYS, memoryStore, type KeyValueStore } from '../../lib/store';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Writes a snapshot the way the scheduled job does: with fetchedAt in its metadata. */
const publish = (store: KeyValueStore, fetchedAt: string) =>
  store.setJSON(KEYS.snapshot, { ...fixtureSnapshot, fetchedAt }, { fetchedAt });

async function setup(options: { staleEdge?: boolean; empty?: boolean } = {}) {
  const { store } = memoryStore({}, { staleEdge: options.staleEdge ?? false });
  if (!options.empty) await publish(store, fixtureSnapshot.fetchedAt);
  // Two kinds of read: a cheap metadata check, and the ~1 MB body.
  const check = vi.spyOn(store, 'getMetadata');
  const body = vi.spyOn(store, 'getJSONWithEtag');
  let now = 0;
  const source = createSnapshotSource({ store, now: () => now });
  return { store, check, body, source, advance: (ms: number) => (now += ms) };
}

describe('createSnapshotSource', () => {
  it('loads and parses the snapshot, with its place index', async () => {
    const { source } = await setup();
    const loaded = await source.get();
    expect(loaded.snapshot.fetchedAt).toBe(fixtureSnapshot.fetchedAt);
    expect(loaded.places.stationPlacesByPostcode.has('2250')).toBe(true);
  });

  it('picks up each new snapshot even while the Blobs edge still serves the old one', async () => {
    // The 2026-10-23 stall: the scheduled job wrote 01:00, 01:30, ... but the
    // API's eventually-consistent re-check kept being told "unchanged" under
    // steady traffic, so it served the 00:30 snapshot for over an hour.
    const { store, source, advance } = await setup({ staleEdge: true });
    expect((await source.get()).snapshot.fetchedAt).toBe(fixtureSnapshot.fetchedAt);

    for (const fetchedAt of ['2026-10-23T01:00:37.825Z', '2026-10-23T01:30:34.796Z']) {
      await publish(store, fetchedAt);
      advance(31_000);
      expect((await source.get()).snapshot.fetchedAt).toBe(fetchedAt);
    }
  });

  it('reads with strong consistency only', async () => {
    const { source, check, body } = await setup();
    await source.get();
    expect(check.mock.calls.map((call) => call[1])).toEqual(['strong']);
    expect(body.mock.calls.map((call) => call[1])).toEqual(['strong']);
  });

  it('serves its copy for 30 s, then checks the metadata without re-downloading', async () => {
    const { source, check, body, advance } = await setup();
    const first = await source.get();
    advance(10_000);
    await source.get();
    expect(check).toHaveBeenCalledTimes(1);

    advance(25_000);
    const again = await source.get();
    expect(check).toHaveBeenCalledTimes(2);
    expect(body).toHaveBeenCalledTimes(1);
    expect(again).toBe(first);
  });

  it('still works, by re-reading the body, for a snapshot written without metadata', async () => {
    const { store } = memoryStore({ [KEYS.snapshot]: fixtureSnapshot });
    let now = 0;
    const source = createSnapshotSource({ store, now: () => now });
    expect((await source.get()).snapshot.fetchedAt).toBe(fixtureSnapshot.fetchedAt);
    await store.setJSON(KEYS.snapshot, {
      ...fixtureSnapshot,
      fetchedAt: '2026-10-23T09:00:00.000Z',
    });
    now += 31_000;
    expect((await source.get()).snapshot.fetchedAt).toBe('2026-10-23T09:00:00.000Z');
  });

  it('shares one read between concurrent requests', async () => {
    const { source, check, body } = await setup();
    await Promise.all([source.get(), source.get(), source.get()]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('is unavailable before the first snapshot exists', async () => {
    const { source } = await setup({ empty: true });
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });

  it('keeps serving its copy if Blobs fails', async () => {
    const { source, check, advance } = await setup();
    const first = await source.get();
    check.mockRejectedValueOnce(new Error('Blobs is down'));
    advance(31_000);
    expect(await source.get()).toBe(first);
  });

  it('is unavailable if Blobs fails before anything was loaded', async () => {
    const { source, check } = await setup();
    check.mockRejectedValueOnce(new Error('Blobs is down'));
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });

  it('refuses a snapshot in an unknown format rather than misreading it', async () => {
    const { store } = memoryStore();
    await store.setJSON(KEYS.snapshot, { version: 2, stations: 'elsewhere' }, { fetchedAt: 'x' });
    const source = createSnapshotSource({ store, now: () => 0 });
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });
});
