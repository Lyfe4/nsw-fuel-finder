// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { foldHistory, STATIONS_PER_RUN } from './fold';
import { stationHistorySchema } from './stationHistory';
import { KEYS, memoryStore } from '../store';

import type { HistoryDay } from '../snapshot/history';

const day = (date: string, fuels: HistoryDay['fuels']): HistoryDay => ({
  version: 1,
  day: date,
  fuels,
});

async function live(store: ReturnType<typeof memoryStore>['store'], code: string) {
  return stationHistorySchema.parse(await store.getJSON(KEYS.historyLive(code), 'strong'));
}

describe('foldHistory', () => {
  it('adds every finished day since our history began to each station, and records progress', async () => {
    const { store } = memoryStore({
      [KEYS.historyDay('2026-10-23')]: day('2026-10-23', { U91: { '1': [200, 202, 201] } }),
      [KEYS.historyDay('2026-10-24')]: day('2026-10-24', {
        U91: { '1': [199, 201, 199] },
        E10: { '1': [190, 190, 190], '2': [191, 192, 192] },
      }),
    });

    const result = await foldHistory(store, '2026-10-25', ['2', '1']);

    expect(result).toEqual({ target: '2026-10-24', stations: 2, written: 2, remaining: 0 });
    expect(await live(store, '1')).toEqual({
      version: 2,
      code: '1',
      source: 'snapshots',
      from: '2026-10-23',
      through: '2026-10-24',
      fuels: {
        U91: [
          ['2026-10-23', 200, 202, 201],
          ['2026-10-24', 199, 201, 199],
        ],
        E10: [['2026-10-24', 190, 190, 190]],
      },
    });
    expect((await live(store, '2')).fuels).toEqual({ E10: [['2026-10-24', 191, 192, 192]] });
    expect(await store.getJSON(KEYS.historyProgress, 'strong')).toEqual({
      target: '2026-10-24',
      done: 2,
    });
  });

  it('does a slice per run, carries on where the last run stopped, then does nothing', async () => {
    const codes = Array.from({ length: STATIONS_PER_RUN + 5 }, (_, i) => String(1000 + i));
    const { store } = memoryStore({
      [KEYS.historyDay('2026-10-23')]: day('2026-10-23', { U91: { '1000': [1, 1, 1] } }),
    });
    const setJSON = vi.spyOn(store, 'setJSON');

    const first = await foldHistory(store, '2026-10-24', codes);
    expect(first).toMatchObject({ stations: STATIONS_PER_RUN, remaining: 5 });

    const second = await foldHistory(store, '2026-10-24', codes);
    expect(second).toMatchObject({ stations: 5, remaining: 0 });

    setJSON.mockClear();
    const third = await foldHistory(store, '2026-10-24', codes);
    expect(third).toMatchObject({ stations: 0, remaining: 0 });
    expect(setJSON).not.toHaveBeenCalled();
  });

  it('only reads the days a station is missing, and starts again for each new day', async () => {
    const { store } = memoryStore({
      [KEYS.historyDay('2026-10-23')]: day('2026-10-23', { U91: { '1': [200, 200, 200] } }),
      [KEYS.historyDay('2026-10-24')]: day('2026-10-24', { U91: { '1': [201, 201, 201] } }),
    });
    await foldHistory(store, '2026-10-24', ['1']);
    const getJSON = vi.spyOn(store, 'getJSON');

    await foldHistory(store, '2026-10-25', ['1']);

    const dayReads = getJSON.mock.calls
      .map(([key]) => key)
      .filter((key) => key.startsWith('history/v1/'));
    expect(dayReads).toEqual(['history/v1/2026-10-24']);
    expect((await live(store, '1')).fuels.U91).toEqual([
      ['2026-10-23', 200, 200, 200],
      ['2026-10-24', 201, 201, 201],
    ]);
  });

  it('writes a station with no prices yet, so tomorrow it needs one day, not the whole window', async () => {
    const { store } = memoryStore({
      [KEYS.historyDay('2026-10-23')]: day('2026-10-23', {}),
    });
    await foldHistory(store, '2026-10-24', ['9']);
    expect(await live(store, '9')).toMatchObject({ through: '2026-10-23', fuels: {} });
  });

  it('skips a missing day file without failing, and does nothing before our history began', async () => {
    const { store } = memoryStore();
    expect(await foldHistory(store, '2026-10-23', ['1'])).toBeNull();
    const result = await foldHistory(store, '2026-10-25', ['1']);
    expect(result).toMatchObject({ written: 1 });
    expect((await live(store, '1')).through).toBe('2026-10-24');
  });
});
