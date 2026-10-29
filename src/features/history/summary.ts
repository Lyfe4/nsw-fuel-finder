import { formatPrice } from '@/lib/format';

import type { HistoryDayRow, HistorySource } from '../../../shared/api';

/*
 * The words around the chart: what a screen reader user hears instead of
 * looking at it, and what anyone reads first. Pure, so it can be tested
 * without drawing anything.
 */

const dayFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayYearFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "2026-09-12" (already a Sydney calendar day) -> "Sat 12 Sep". */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** "2026-09-12" -> "12 Sep 2026". */
export function formatDayWithYear(day: string): string {
  return dayYearFormat.format(new Date(`${day}T00:00:00Z`));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface Gap {
  /** The first and last missing day. */
  from: string;
  through: string;
}

const dayOnly = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' });
const dayMonth = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

/** A gap, short, for the chart and the table: "1–22 Oct", "28 Sept–3 Oct", "5 Oct". */
export function formatGap({ from, through }: Gap): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${through}T00:00:00Z`);
  if (from === through) return dayMonth.format(end);
  const sameMonth = from.slice(0, 7) === through.slice(0, 7);
  return `${(sameMonth ? dayOnly : dayMonth).format(start)}–${dayMonth.format(end)}`;
}

/** The gaps in a sentence of their own, for the summary over the chart. */
export function gapsText(gapList: readonly Gap[]): string {
  if (gapList.length === 0) return '';
  const spans = gapList.map((gap) =>
    gap.from === gap.through
      ? formatDayWithYear(gap.from)
      : `${formatDayWithYear(gap.from)} to ${formatDayWithYear(gap.through)}`,
  );
  return `No data for ${spans.join(', ')}.`;
}

/** Runs of missing days between the first and last day we have. */
export function gaps(days: readonly HistoryDayRow[]): Gap[] {
  const result: Gap[] = [];
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1]?.[0];
    const current = days[i]?.[0];
    if (!previous || !current || daysBetween(previous, current) <= 1) continue;
    const from = new Date(`${previous}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() + 1);
    const through = new Date(`${current}T00:00:00Z`);
    through.setUTCDate(through.getUTCDate() - 1);
    result.push({
      from: from.toISOString().slice(0, 10),
      through: through.toISOString().slice(0, 10),
    });
  }
  return result;
}

export interface HistorySummary {
  lowest: { price: number; day: string };
  highest: { price: number; day: string };
  first: string;
  last: string;
  /** How many days have a price. */
  count: number;
}

/** The lowest low and highest high (the earliest day, on a tie), or null with no days. */
export function summarise(days: readonly HistoryDayRow[]): HistorySummary | null {
  const [firstRow] = days;
  const lastRow = days.at(-1);
  if (!firstRow || !lastRow) return null;
  let lowest = { price: firstRow[1], day: firstRow[0] };
  let highest = { price: firstRow[2], day: firstRow[0] };
  for (const [day, low, high] of days) {
    if (low < lowest.price) lowest = { price: low, day };
    if (high > highest.price) highest = { price: high, day };
  }
  return { lowest, highest, first: firstRow[0], last: lastRow[0], count: days.length };
}

/**
 * "Lowest in the last 92 days: 189.9 on Fri 12 Sep. Highest: 219.9 on Sun
 * 3 Aug." Spoken as well as shown, so it says "cents a litre" in full.
 */
export function summaryText(summary: HistorySummary): string {
  const span = daysBetween(summary.first, summary.last) + 1;
  const period = span === 1 ? 'on the one day we have' : `in the last ${String(span)} days`;
  return (
    `Lowest ${period}: ${formatPrice(summary.lowest.price)} cents a litre on ` +
    `${formatDay(summary.lowest.day)}. Highest: ${formatPrice(summary.highest.price)} on ` +
    `${formatDay(summary.highest.day)}.`
  );
}

/** Where each stretch came from, in words, for the credit under the chart. */
export function coverageText(sources: readonly HistorySource[], gapList: readonly Gap[]): string {
  const parts = sources.map((source) =>
    source.kind === 'fuelcheck-monthly'
      ? `${formatDayWithYear(source.from)} to ${formatDayWithYear(source.through)} from FuelCheck’s published price history`
      : `${formatDayWithYear(source.from)} to ${formatDayWithYear(source.through)} from our own half-hourly snapshots`,
  );
  const sentence = parts.length > 0 ? `Daily prices: ${parts.join('; ')}.` : '';
  const holes = gapList.length > 0 ? ` ${gapsText(gapList)}` : '';
  return `${sentence}${holes}`;
}
