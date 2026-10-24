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
 * every 30 s by reading only its metadata (the snapshot's fetchedAt); the
 * ~1 MB body is fetched only when that has changed.
 *
 * BOTH READS ARE STRONGLY CONSISTENT. They used to be one conditional,
 * eventually-consistent read, and on 2026-10-23 it went on returning the
 * 00:30 snapshot for hours while the job wrote a fresh one every 30 minutes.
 * The cause was an expired Blobs token (see blobStore() in lib/store.ts):
 * eventual reads hid it, strong reads fail loudly, which is what we want.
 * The check is a small HEAD request, so doing it strongly every 30 s costs
 * little.
 *
 * If Blobs is unreachable or returns something unreadable, an instance that
 * already has a snapshot keeps serving it (its age still drives `stale`);
 * one that has never loaded one reports unavailable.
 */
export function createSnapshotSource(deps: { store: KeyValueStore; now: () => number }) {
  let cached: (LoadedSnapshot & { version: string; checkedAt: number }) | null = null;
  let pending: Promise<LoadedSnapshot> | null = null;

  async function refresh(): Promise<LoadedSnapshot> {
    let result: { data: unknown; version: string } | null;
    try {
      // The version is the snapshot's own fetchedAt, which the job writes into
      // the blob's metadata. Not the etag: a HEAD response is not guaranteed
      // to carry one (the local Blobs server sends none).
      const metadata = await deps.store.getMetadata(KEYS.snapshot, 'strong');
      const version = typeof metadata?.fetchedAt === 'string' ? metadata.fetchedAt : null;
      if (version !== null && cached?.version === version) {
        cached.checkedAt = deps.now();
        return cached;
      }
      // No fetchedAt in the metadata (an older writer): fall back to the
      // etag, which at worst means re-reading the body on every check.
      const body =
        metadata === null ? null : await deps.store.getJSONWithEtag(KEYS.snapshot, 'strong');
      result = body && { data: body.data, version: version ?? body.etag };
    } catch (error) {
      console.error('Reading the snapshot from Blobs failed', error);
      if (cached) return cached;
      throw new SnapshotUnavailableError('Could not read the price snapshot.', { cause: error });
    }

    if (!result) {
      // Never written yet (a new site, or before the first scheduled run).
      throw new SnapshotUnavailableError('No price snapshot has been taken yet.');
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
      version: result.version,
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
