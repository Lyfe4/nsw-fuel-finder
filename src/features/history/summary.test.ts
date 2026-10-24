import { describe, expect, it } from 'vitest';

import { coverageText, gaps, summarise, summaryText } from './summary';

import type { HistoryDayRow } from '../../../shared/api';

const DAYS: HistoryDayRow[] = [
  ['2026-09-10', 195.9, 199.9, 199.9],
  ['2026-09-11', 192.9, 199.9, 192.9],
  ['2026-09-12', 189.9, 192.9, 189.9],
  ['2026-10-23', 214.9, 219.9, 219.9],
];

describe('the words around the chart', () => {
  it('names the lowest low and the highest high, with their days', () => {
    const summary = summarise(DAYS);
    expect(summary).toEqual({
      lowest: { price: 189.9, day: '2026-09-12' },
      highest: { price: 219.9, day: '2026-10-23' },
      first: '2026-09-10',
      last: '2026-10-23',
      count: 4,
    });
    expect(summary && summaryText(summary)).toBe(
      // en-AU, as ICU writes it: "Sat, 12 Sept".
      'Lowest in the last 44 days: 189.9 cents a litre on Sat, 12 Sept. Highest: 219.9 on Fri, 23 Oct.',
    );
  });

  it('takes the earliest day on a tie, and copes with one day and none', () => {
    const summary = summarise([
      ['2026-10-23', 200, 200, 200],
      ['2026-10-24', 200, 200, 200],
    ]);
    expect(summary?.lowest.day).toBe('2026-10-23');
    const one = summarise([['2026-10-23', 200, 201, 201]]);
    expect(one && summaryText(one)).toMatch(/^Lowest on the one day we have: 200\.0/);
    expect(summarise([])).toBeNull();
  });

  it('finds the missing days, and says where each stretch came from', () => {
    expect(gaps(DAYS)).toEqual([{ from: '2026-09-13', through: '2026-10-22' }]);
    expect(
      coverageText(
        [
          { kind: 'fuelcheck-monthly', from: '2026-09-10', through: '2026-09-12' },
          { kind: 'snapshots', from: '2026-10-23', through: '2026-10-23' },
        ],
        gaps(DAYS),
      ),
    ).toBe(
      'Daily prices: 10 Sept 2026 to 12 Sept 2026 from FuelCheck’s published price history; ' +
        '23 Oct 2026 to 23 Oct 2026 from our own half-hourly snapshots. ' +
        'No data for 13 Sept 2026 to 22 Oct 2026.',
    );
  });
});
