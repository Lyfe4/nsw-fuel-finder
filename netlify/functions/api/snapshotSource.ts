import { buildPlaceIndex, type PlaceIndex } from './places';
import { snapshotSchema, type Snapshot } from '../../lib/snapshot/format';
import { KEYS, type KeyValueStore } from '../../lib/store';

/** How long a warm instance trusts its copy before asking Blobs if it changed. */
const RECHECK_MS = 30_000;

export interface LoadedSnapshot {
  snapshot: Snapshot;
  places: PlaceIndex;
}

export class SnapshotUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SnapshotUnavailableError';
  }
}

/**
 * The snapshot, held in module scope by a warm instance. Rechecked at most
 * every 30 s with a conditional read: unchanged costs a 304, not 1 MB.
 *
 * If Blobs is unreachable or returns something unreadable, an instance that
 * already has a snapshot keeps serving it (its age still drives `stale`);
 * one that has never loaded one reports unavailable.
 */
export function createSnapshotSource(deps: { store: KeyValueStore; now: () => number }) {
  let cached: (LoadedSnapshot & { etag: string; checkedAt: number }) | null = null;
  let pending: Promise<LoadedSnapshot> | null = null;

  async function refresh(): Promise<LoadedSnapshot> {
    let result: Awaited<ReturnType<KeyValueStore['getJSONIfChanged']>>;
    try {
      result = await deps.store.getJSONIfChanged(KEYS.snapshot, cached?.etag);
    } catch (error) {
      console.error('Reading the snapshot from Blobs failed', error);
      if (cached) return cached;
      throw new SnapshotUnavailableError('Could not read the price snapshot.', { cause: error });
    }

    if (!result) {
      // Never written yet (a new site, or before the first scheduled run).
      throw new SnapshotUnavailableError('No price snapshot has been taken yet.');
    }
    if (result.data === null && cached) {
      cached.checkedAt = deps.now();
      return cached;
    }

    const parsed = snapshotSchema.safeParse(result.data);
    if (!parsed.success) {
      console.error('Snapshot in Blobs has an unexpected shape', parsed.error.issues.slice(0, 5));
      if (cached) return cached;
      throw new SnapshotUnavailableError('The price snapshot could not be read.');
    }

    cached = {
      snapshot: parsed.data,
      places: buildPlaceIndex(parsed.data.stations),
      etag: result.etag,
      checkedAt: deps.now(),
    };
    return cached;
  }

  return {
    get(): Promise<LoadedSnapshot> {
      if (cached && deps.now() - cached.checkedAt < RECHECK_MS) return Promise.resolve(cached);
      // Concurrent requests on one instance share one read.
      pending ??= refresh().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
