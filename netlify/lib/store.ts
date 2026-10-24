import { getStore, type Store } from '@netlify/blobs';

/**
 * How fresh a read must be, as in Netlify Blobs:
 *
 * - 'eventual' goes through Netlify's edge cache; the docs say a write
 *   reaches every edge within 60 s. With an expired token it quietly keeps
 *   returning the last cached copy instead of failing (see docs/decisions.md,
 *   "Snapshot stall").
 * - 'strong' bypasses the edge cache and always sees the latest write.
 *
 * Required on every read, so each call site says which it needs.
 */
export type Consistency = 'strong' | 'eventual';

/**
 * The few storage operations the app needs, so the jobs can be tested without
 * Netlify. `blobStore()` is the real one; `memoryStore()` is for tests.
 */
export interface KeyValueStore {
  getJSON(key: string, consistency: Consistency): Promise<unknown>;
  /** The value and its etag, or null when the key does not exist. */
  getJSONWithEtag(
    key: string,
    consistency: Consistency,
  ): Promise<{ data: unknown; etag: string } | null>;
  /** Just the metadata, without downloading the value: a cheap "has it changed?". */
  getMetadata(key: string, consistency: Consistency): Promise<Record<string, unknown> | null>;
  setJSON(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The site-wide store. Not deploy-scoped: snapshot and history outlive deploys. */
export const STORE_NAME = 'fuel-finder';

export const KEYS = {
  snapshot: 'snapshot/v1/latest',
  token: 'auth/token',
  authFailure: 'auth/failure',
  lastRun: 'meta/last-run',
  historyDay: (day: string) => `history/v1/${day}`,
} as const;

/** Netlify Blobs. */
export function blobStore(): KeyValueStore {
  /*
   * A NEW STORE FOR EVERY OPERATION. getStore() reads the current
   * invocation's Blobs context - a short-lived token - when it is called, and
   * the store it returns keeps that token. Cached for the life of a warm
   * instance (as it was until 2026-10-23), every call failed with "Failed to
   * decode token: Token expired" ~15 minutes after a cold start; before reads
   * were strong, eventual reads quietly served the last cached copy instead,
   * which is how the API served an hours-old snapshot. getStore() only builds
   * a client object, so calling it per operation costs nothing measurable.
   */
  const blobs = (): Store => getStore({ name: STORE_NAME });
  return {
    getJSON: async (key, consistency) => {
      const value: unknown = await blobs().get(key, { type: 'json', consistency });
      return value ?? null;
    },
    getJSONWithEtag: async (key, consistency) => {
      const result = await blobs().getWithMetadata(key, { type: 'text', consistency });
      if (!result) return null;
      return { data: JSON.parse(result.data) as unknown, etag: result.etag ?? '' };
    },
    getMetadata: async (key, consistency) =>
      (await blobs().getMetadata(key, { consistency }))?.metadata ?? null,
    setJSON: async (key, value, metadata) => {
      await blobs().setJSON(key, value, metadata ? { metadata } : {});
    },
    delete: (key) => blobs().delete(key),
  };
}

/**
 * An in-memory store with the same semantics, for tests.
 *
 * `staleEdge` models what production looked like on 2026-10-23 (the cause
 * turned out to be an expired token, not the edge): eventually-consistent
 * reads kept the version they first saw while strong reads saw every write.
 * With it on, eventual reads are pinned to their first answer; strong reads
 * always see the latest.
 */
export function memoryStore(
  initial: Record<string, unknown> = {},
  options: { staleEdge?: boolean } = {},
) {
  let version = 0;
  const entries = new Map<
    string,
    { json: string; etag: string; metadata: Record<string, unknown> }
  >();
  const edge = new Map<string, { json: string; etag: string; metadata: Record<string, unknown> }>();
  /** What an eventually-consistent read sees. */
  const eventual = (key: string) => {
    if (!options.staleEdge) return entries.get(key);
    const latest = entries.get(key);
    if (!edge.has(key) && latest) edge.set(key, latest);
    return edge.get(key);
  };
  const put = (key: string, value: unknown, metadata: Record<string, unknown> = {}) => {
    version += 1;
    entries.set(key, { json: JSON.stringify(value), etag: `"${String(version)}"`, metadata });
  };
  for (const [key, value] of Object.entries(initial)) put(key, value);

  const read = (key: string, consistency: Consistency) =>
    consistency === 'strong' ? entries.get(key) : eventual(key);

  const store: KeyValueStore = {
    getJSON: (key, consistency) => {
      const entry = read(key, consistency);
      return Promise.resolve(entry ? (JSON.parse(entry.json) as unknown) : null);
    },
    getJSONWithEtag: (key, consistency) => {
      const entry = read(key, consistency);
      return Promise.resolve(
        entry ? { data: JSON.parse(entry.json) as unknown, etag: entry.etag } : null,
      );
    },
    getMetadata: (key, consistency) => Promise.resolve(read(key, consistency)?.metadata ?? null),
    setJSON: (key, value, metadata) => {
      put(key, value, metadata);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      edge.delete(key);
      return Promise.resolve();
    },
  };
  return { store, keys: () => [...entries.keys()].sort() };
}
