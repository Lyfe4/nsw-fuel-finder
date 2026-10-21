// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSnapshot } from './__fixtures__/snapshot';
import { createSnapshotSource, SnapshotUnavailableError } from './snapshotSource';
import { KEYS, memoryStore } from '../../lib/store';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(initial: Record<string, unknown> = { [KEYS.snapshot]: fixtureSnapshot }) {
  const { store } = memoryStore(initial);
  const read = vi.spyOn(store, 'getJSONIfChanged');
  let now = 0;
  const source = createSnapshotSource({ store, now: () => now });
  return { store, read, source, advance: (ms: number) => (now += ms) };
}

describe('createSnapshotSource', () => {
  it('loads and parses the snapshot, with its place index', async () => {
    const { source } = setup();
    const loaded = await source.get();
    expect(loaded.snapshot.fetchedAt).toBe(fixtureSnapshot.fetchedAt);
    expect(loaded.places.byPostcode.has('2250')).toBe(true);
  });

  it('serves its copy for 30 s, then revalidates with the etag', async () => {
    const { source, read, advance } = setup();
    const first = await source.get();
    advance(10_000);
    await source.get();
    expect(read).toHaveBeenCalledTimes(1);

    advance(25_000);
    const again = await source.get();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[1]).toMatch(/^"\d+"$/);
    expect(again).toBe(first);
  });

  it('picks up a new snapshot after revalidating', async () => {
    const { source, store, advance } = setup();
    await source.get();
    await store.setJSON(KEYS.snapshot, {
      ...fixtureSnapshot,
      fetchedAt: '2026-10-21T03:51:27.000Z',
    });
    advance(31_000);
    expect((await source.get()).snapshot.fetchedAt).toBe('2026-10-21T03:51:27.000Z');
  });

  it('shares one read between concurrent requests', async () => {
    const { source, read } = setup();
    await Promise.all([source.get(), source.get(), source.get()]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('is unavailable before the first snapshot exists', async () => {
    const { source } = setup({});
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });

  it('keeps serving its copy if Blobs fails', async () => {
    const { source, read, advance } = setup();
    const first = await source.get();
    read.mockRejectedValueOnce(new Error('Blobs is down'));
    advance(31_000);
    expect(await source.get()).toBe(first);
  });

  it('is unavailable if Blobs fails before anything was loaded', async () => {
    const { source, read } = setup();
    read.mockRejectedValueOnce(new Error('Blobs is down'));
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });

  it('refuses a snapshot in an unknown format rather than misreading it', async () => {
    const { source } = setup({ [KEYS.snapshot]: { version: 2, stations: 'elsewhere' } });
    await expect(source.get()).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });
});
