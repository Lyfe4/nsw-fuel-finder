// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreviousDaySource } from './previousDay';
import { searchNearest } from './search';
import { NEAREST_COUNT } from '../../../shared/api';
import { memoryStore } from '../../lib/store';

import type { SnapshotStation } from '../../lib/snapshot/format';

const DAY = '2026-10-23';
const file = { version: 1, day: DAY, fuels: { U91: { '972': [239.9, 241.9, 241.9] } } };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('yesterday’s prices', () => {
  it('reads a finished day once, and keeps it', async () => {
    const { store } = memoryStore({ [`history/v1/${DAY}`]: file });
    const read = vi.spyOn(store, 'getJSON');
    const source = createPreviousDaySource({ store, now: () => 0 });

    const [first, second] = await Promise.all([source.get(DAY), source.get(DAY)]);
    expect(first?.U91?.['972']).toEqual([239.9, 241.9, 241.9]);
    expect(second).toBe(first);
    await source.get(DAY);
    // Two requests at once shared one read; a later one used the copy.
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(`history/v1/${DAY}`, 'eventual');
  });

  it('reads the next day when the day moves on', async () => {
    const { store } = memoryStore({
      [`history/v1/${DAY}`]: file,
      'history/v1/2026-10-24': { ...file, day: '2026-10-24', fuels: {} },
    });
    const source = createPreviousDaySource({ store, now: () => 0 });
    await source.get(DAY);
    expect(await source.get('2026-10-24')).toEqual({});
  });

  it('is null, never an error, when the read fails, and asks again five minutes later', async () => {
    let now = 0;
    const { store } = memoryStore({ [`history/v1/${DAY}`]: file });
    const read = vi
      .spyOn(store, 'getJSON')
      .mockRejectedValueOnce(new Error('Failed to decode token: Token expired'));
    const source = createPreviousDaySource({ store, now: () => now });

    expect(await source.get(DAY)).toBeNull();
    now = 4 * 60_000;
    expect(await source.get(DAY)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    now = 5 * 60_000;
    expect((await source.get(DAY))?.U91).toBeDefined();
  });

  it('is null for a missing day, or a file that is not that day', async () => {
    const { store } = memoryStore({ 'history/v1/2026-10-22': { ...file, day: DAY } });
    const source = createPreviousDaySource({ store, now: () => 0 });
    expect(await source.get(DAY)).toBeNull();
    expect(await source.get('2026-10-22')).toBeNull();
  });
});

describe('the nearest stations', () => {
  /** A station due east of (-33, 150), `km` away, selling Unleaded 91. */
  const east = (code: string, km: number): SnapshotStation => ({
    code,
    name: `Station ${code}`,
    brand: 'Independent',
    address: '',
    suburb: null,
    postcode: null,
    state: 'NSW',
    lat: -33,
    lng: 150 + km / (111.32 * Math.cos((33 * Math.PI) / 180)),
    prices: { U91: [200, '2026-10-24T00:00:00Z'] },
  });
  const origin = { latitude: -33, longitude: 150 };

  it('are the closest few, nearest first', () => {
    const stations = [40, 12, 90, 35, 60, 18, 75, 22, 55, 30, 45, 80].map((km, i) =>
      east(String(i), km),
    );
    const nearest = searchNearest(stations, origin, 'U91');
    expect(nearest).toHaveLength(NEAREST_COUNT);
    expect(nearest.map((s) => Math.round(s.distanceKm))).toEqual([
      12, 18, 22, 30, 35, 40, 45, 55, 60, 75,
    ]);
  });

  it('stop at 100 km', () => {
    const nearest = searchNearest([east('a', 99), east('b', 101)], origin, 'U91');
    expect(nearest.map((s) => s.stationCode)).toEqual(['a']);
  });
});
