// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { historyDaySchema, updateHistoryDay } from './history';

import type { Snapshot } from './format';

function snapshotAt(fetchedAt: string, prices: Record<string, number>): Snapshot {
  return {
    version: 1,
    fetchedAt,
    stations: Object.entries(prices).map(([code, cents]) => ({
      code,
      name: code,
      brand: 'BP',
      address: '1 Test St, Testville NSW 2000',
      suburb: 'Testville',
      postcode: '2000',
      state: 'NSW',
      lat: -33.8,
      lng: 151.2,
      prices: { U91: [cents, fetchedAt], ...(code === 'a' ? { DL: [280, fetchedAt] } : {}) },
    })),
  };
}

describe('updateHistoryDay', () => {
  it("starts the day's record from the first snapshot", () => {
    const day = updateHistoryDay(null, snapshotAt('2026-10-21T00:00:00Z', { a: 210, b: 215 }));
    expect(day).toEqual({
      version: 1,
      day: '2026-10-21',
      fuels: { U91: { a: [210, 210, 210], b: [215, 215, 215] }, DL: { a: [280, 280, 280] } },
    });
    expect(historyDaySchema.safeParse(day).success).toBe(true);
  });

  it('tracks min, max and last across the day', () => {
    let day = updateHistoryDay(null, snapshotAt('2026-10-21T00:00:00Z', { a: 210 }));
    day = updateHistoryDay(day, snapshotAt('2026-10-21T01:00:00Z', { a: 199.9 }));
    day = updateHistoryDay(day, snapshotAt('2026-10-21T02:00:00Z', { a: 205 }));
    expect(day.fuels.U91?.a).toEqual([199.9, 210, 205]);
  });

  it("starts fresh when the Sydney day changes, even if handed yesterday's record", () => {
    const yesterday = updateHistoryDay(null, snapshotAt('2026-10-21T12:00:00Z', { a: 210 }));
    // 13:30 UTC on the 21st is 00:30 on the 22nd in Sydney.
    const today = updateHistoryDay(yesterday, snapshotAt('2026-10-21T13:30:00Z', { a: 220 }));
    expect(today.day).toBe('2026-10-22');
    expect(today.fuels.U91?.a).toEqual([220, 220, 220]);
  });

  it('adds a station that appears later in the day without touching the others', () => {
    let day = updateHistoryDay(null, snapshotAt('2026-10-21T00:00:00Z', { a: 210 }));
    day = updateHistoryDay(day, snapshotAt('2026-10-21T01:00:00Z', { a: 210, c: 230 }));
    expect(day.fuels.U91).toEqual({ a: [210, 210, 210], c: [230, 230, 230] });
  });
});
