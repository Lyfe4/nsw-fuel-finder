// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Models how @netlify/blobs gets its credentials: getStore() reads the
 * CURRENT invocation's Blobs context (a short-lived token) when it is called,
 * and the store it returns keeps that token. Each new request brings a new
 * token; an old one expires.
 */
const blobs = vi.hoisted(() => {
  const state = { token: 1, expiredBefore: 1, data: new Map<string, string>() };
  const getStore = vi.fn(() => {
    const token = state.token;
    const check = () => {
      if (token < state.expiredBefore) {
        throw new Error(
          'Netlify Blobs has generated an internal error (Failed to decode token: Token expired)',
        );
      }
    };
    return {
      get: (key: string) => {
        check();
        const value = state.data.get(key);
        return Promise.resolve(value === undefined ? null : (JSON.parse(value) as unknown));
      },
      getMetadata: (key: string) => {
        check();
        return Promise.resolve(state.data.has(key) ? { etag: undefined, metadata: {} } : null);
      },
      getWithMetadata: (key: string) => {
        check();
        const value = state.data.get(key);
        return Promise.resolve(
          value === undefined ? null : { data: value, etag: '"1"', metadata: {} },
        );
      },
      setJSON: (key: string, value: unknown) => {
        check();
        state.data.set(key, JSON.stringify(value));
        return Promise.resolve({ modified: true });
      },
      delete: (key: string) => {
        check();
        state.data.delete(key);
        return Promise.resolve();
      },
    };
  });
  /** A new request: fresh token, and every earlier token now expired. */
  const newRequest = () => {
    state.token += 1;
    state.expiredBefore = state.token;
  };
  return { state, getStore, newRequest };
});

vi.mock('@netlify/blobs', () => ({ getStore: blobs.getStore }));

const { blobStore } = await import('./store');

beforeEach(() => {
  blobs.state.data.clear();
  blobs.getStore.mockClear();
});

describe('blobStore', () => {
  it('keeps working across requests in a warm instance, after the first token expires', async () => {
    // The 2026-10-23 stall, second half: the API created its store once per
    // instance, so ~15 minutes after a cold start every Blobs call failed
    // with "Token expired" (and eventual reads had been quietly serving the
    // last cached copy instead of failing).
    const store = blobStore();
    await store.setJSON('meta/last-run', { ok: true });
    expect(await store.getJSON('meta/last-run', 'strong')).toEqual({ ok: true });

    blobs.newRequest();
    expect(await store.getJSON('meta/last-run', 'strong')).toEqual({ ok: true });
    expect(await store.getMetadata('meta/last-run', 'strong')).toEqual({});

    blobs.newRequest();
    await store.setJSON('meta/last-run', { ok: false });
    expect(await store.getJSONWithEtag('meta/last-run', 'strong')).toEqual({
      data: { ok: false },
      etag: '"1"',
    });
  });

  it('asks for a store per operation, so each uses the current request’s credentials', async () => {
    const store = blobStore();
    await store.getJSON('a', 'strong');
    await store.getJSON('b', 'strong');
    expect(blobs.getStore).toHaveBeenCalledTimes(2);
  });
});
