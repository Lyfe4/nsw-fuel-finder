import { getStore, type Store } from '@netlify/blobs';

/**
 * The few storage operations the app needs, so the jobs can be tested without
 * Netlify. `blobStore()` is the real one; `memoryStore()` is for tests.
 */
export interface KeyValueStore {
  /** Read with strong consistency: sees a write from a moment ago. */
  getJSON(key: string): Promise<unknown>;
  /**
   * Read only if changed since `etag`. Returns null when the key does not
   * exist, and `{ data: null }` when it exists and is unchanged.
   */
  getJSONIfChanged(key: string, etag?: string): Promise<{ data: unknown; etag: string } | null>;
  getMetadata(key: string): Promise<Record<string, unknown> | null>;
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

/**
 * Netlify Blobs. Reads are eventually consistent by default - a write can take
 * up to a minute to be visible everywhere - which is fine for the snapshot and
 * wrong for the auth state, so `getJSON` asks for strong consistency.
 */
export function blobStore(): KeyValueStore {
  // Resolved on first use, not at import: the function environment that
  // getStore reads its credentials from is only guaranteed during a request.
  let resolved: Store | null = null;
  const blobs = (): Store => (resolved ??= getStore({ name: STORE_NAME }));
  return {
    getJSON: async (key) => {
      const value: unknown = await blobs().get(key, { type: 'json', consistency: 'strong' });
      return value ?? null;
    },
    getJSONIfChanged: async (key, etag) => {
      const result = await blobs().getWithMetadata(key, {
        type: 'text',
        ...(etag === undefined ? {} : { etag }),
      });
      if (!result) return null;
      // The typings say `data: string`, but on a 304 (unchanged since
      // `etag`) the implementation returns `data: null`.
      const text = result.data as string | null;
      return {
        data: text === null ? null : (JSON.parse(text) as unknown),
        etag: result.etag ?? '',
      };
    },
    getMetadata: async (key) => (await blobs().getMetadata(key))?.metadata ?? null,
    setJSON: async (key, value, metadata) => {
      await blobs().setJSON(key, value, metadata ? { metadata } : {});
    },
    delete: (key) => blobs().delete(key),
  };
}

/** An in-memory store with the same semantics, for tests. */
export function memoryStore(initial: Record<string, unknown> = {}) {
  let version = 0;
  const entries = new Map<
    string,
    { json: string; etag: string; metadata: Record<string, unknown> }
  >();
  const put = (key: string, value: unknown, metadata: Record<string, unknown> = {}) => {
    version += 1;
    entries.set(key, { json: JSON.stringify(value), etag: `"${String(version)}"`, metadata });
  };
  for (const [key, value] of Object.entries(initial)) put(key, value);

  const store: KeyValueStore = {
    getJSON: (key) => {
      const entry = entries.get(key);
      return Promise.resolve(entry ? (JSON.parse(entry.json) as unknown) : null);
    },
    getJSONIfChanged: (key, etag) => {
      const entry = entries.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.etag === etag) return Promise.resolve({ data: null, etag: entry.etag });
      return Promise.resolve({ data: JSON.parse(entry.json) as unknown, etag: entry.etag });
    },
    getMetadata: (key) => Promise.resolve(entries.get(key)?.metadata ?? null),
    setJSON: (key, value, metadata) => {
      put(key, value, metadata);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
  return { store, keys: () => [...entries.keys()].sort() };
}
