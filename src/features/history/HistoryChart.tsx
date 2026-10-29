import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { formatPrice } from '@/lib/format';

import styles from './HistoryChart.module.css';
import { daysBetween, formatDay, formatGap, gaps } from './summary';

import type { HistoryDayRow } from '../../../shared/api';

/*
 * One fuel at one station, day by day: a 2px line for the day's last price
 * over a light band from its low to its high. One series, so no legend box,
 * just a key in words under it. Drawn as SVG at the container's real width (not a
 * scaled viewBox), so text stays its own size on a phone.
 *
 * Interactive the same way for everyone: a crosshair follows the pointer, and
 * the left and right arrow keys move it a day at a time, with the day's
 * prices in a readout below. Nothing is only in the readout or the slider: the summary
 * above and the table below have every value.
 */

const HEIGHT = 240;
const MARGIN = { top: 16, right: 56, bottom: 28, left: 44 };
/** A gap this many days long or more is named on the chart; a shorter one is just dashed. */
const GAP_NOTE_DAYS = 3;

/** Clean tick values: whole cents, in steps of 1, 2, 5, 10, 20 or 50. */
function ticks(min: number, max: number): number[] {
  const span = Math.max(max - min, 1);
  const step = [1, 2, 5, 10, 20, 50].find((s) => span / s <= 5) ?? 100;
  const start = Math.floor(min / step) * step;
  const result: number[] = [];
  for (let value = start; value <= max + step; value += step) result.push(value);
  return result;
}

/** The first of each month in range, for the x axis. */
function monthStarts(first: string, last: string): string[] {
  const result: string[] = [];
  const date = new Date(`${first.slice(0, 7)}-01T00:00:00Z`);
  while (date.toISOString().slice(0, 10) <= last) {
    const day = date.toISOString().slice(0, 10);
    if (day >= first) result.push(day);
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return result;
}

const monthName = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'short' });

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      setWidth(Math.max(260, Math.round(element.getBoundingClientRect().width) || 640));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

export function HistoryChart({ days, fuelName }: { days: HistoryDayRow[]; fuelName: string }) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState(days.length - 1);
  // The crosshair shows only while someone is using the chart: parked on the
  // last day it reads as one more axis line.
  const [engaged, setEngaged] = useState(false);
  const [first] = days;
  const last = days.at(-1);
  if (!first || !last) return null;

  const index = Math.min(Math.max(active, 0), days.length - 1);
  const lows = days.map((d) => d[1]);
  const highs = days.map((d) => d[2]);
  const yTicks = ticks(Math.min(...lows), Math.max(...highs));
  const yMin = yTicks[0] ?? 0;
  const yMax = yTicks.at(-1) ?? 1;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = Math.max(daysBetween(first[0], last[0]), 1);
  const x = (day: string) => MARGIN.left + (daysBetween(first[0], day) / span) * plotWidth;
  const y = (cents: number) => MARGIN.top + ((yMax - cents) / (yMax - yMin)) * plotHeight;

  // Break the line and the band wherever a day is missing.
  const runs: HistoryDayRow[][] = [];
  for (const row of days) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && daysBetween(previous[0], row[0]) <= 1) run.push(row);
    else runs.push([row]);
  }
  const line = (run: HistoryDayRow[]) =>
    run.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r[0]).toFixed(1)},${y(r[3]).toFixed(1)}`).join('');
  const band = (run: HistoryDayRow[]) =>
    run
      .map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r[0]).toFixed(1)},${y(r[2]).toFixed(1)}`)
      .join('') +
    `${[...run]
      .reverse()
      .map((r) => `L${x(r[0]).toFixed(1)},${y(r[1]).toFixed(1)}`)
      .join('')}Z`;

  const nearest = (clientX: number, element: Element) => {
    const offset = clientX - element.getBoundingClientRect().left;
    let best = 0;
    for (const [i, row] of days.entries()) {
      const bestRow = days[best];
      if (bestRow && Math.abs(x(row[0]) - offset) < Math.abs(x(bestRow[0]) - offset)) best = i;
    }
    return best;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: days.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(Math.max(next, 0), days.length - 1));
  };

  const current = days[index] ?? last;
  const single = days.length === 1;
  const reading = `${formatDay(current[0])}: last ${formatPrice(current[3])}, low ${formatPrice(current[1])}, high ${formatPrice(current[2])} cents a litre`;

  return (
    <div className={styles.chart}>
      {/*
       * A slider over the days: that is what moving a crosshair with the
       * arrow keys, Home and End is, and screen readers already know how to
       * announce one. Its value text is the day's prices, said on every move,
       * so the readout below is not a live region as well.
       */}
      <div
        ref={ref}
        className={styles.plot}
        tabIndex={0}
        role="slider"
        aria-label={`Day on the ${fuelName} price chart`}
        aria-valuemin={1}
        aria-valuemax={days.length}
        aria-valuenow={index + 1}
        aria-valuetext={reading}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setEngaged(true);
        }}
        onBlur={() => {
          setEngaged(false);
        }}
        onPointerMove={(event) => {
          setEngaged(true);
          setActive(nearest(event.clientX, event.currentTarget));
        }}
        onPointerLeave={(event) => {
          if (event.currentTarget !== document.activeElement) setEngaged(false);
        }}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true" focusable="false">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                className={styles.grid}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className={styles.tick}
                x={MARGIN.left - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          ))}
          {monthStarts(first[0], last[0]).map((day) => (
            <text key={day} className={styles.tick} x={x(day)} y={HEIGHT - 8} textAnchor="middle">
              {monthName.format(new Date(`${day}T00:00:00Z`))}
            </text>
          ))}
          {/*
           * Missing days: a faint dashed line from the last price before to
           * the first after, so the trace is not cut off as if by a fault,
           * and named ("No data, 1–22 Oct"), so the dashes are not read as
           * prices: they mark where there are none, and nothing on them is
           * a value (the slider skips them). The note sits at the top or
           * the bottom of the plot, whichever is further from the line, on
           * a halo of paper over the gridlines. Gaps shorter than
           * GAP_NOTE_DAYS get the dashes alone; the summary and the table
           * name every gap.
           */}
          {gaps(days).map((gap) => {
            const before = days.findLast((row) => row[0] < gap.from);
            const after = days.find((row) => row[0] > gap.through);
            if (!before || !after) return null;
            const [x1, y1, x2, y2] = [x(before[0]), y(before[3]), x(after[0]), y(after[3])];
            const missing = daysBetween(gap.from, gap.through) + 1;
            const middle = (y1 + y2) / 2;
            const nearTop = middle - MARGIN.top < plotHeight / 2;
            const label = `No data, ${formatGap(gap)}`;
            // Kept inside the plot: centred on the gap, unless that would cross an edge.
            const half = (label.length * 6.5) / 2;
            const labelX = Math.min(
              Math.max((x1 + x2) / 2, MARGIN.left + half),
              width - MARGIN.right - half,
            );
            return (
              <g key={gap.from}>
                <line className={styles.gapLine} x1={x1} y1={y1} x2={x2} y2={y2} />
                {missing >= GAP_NOTE_DAYS && (
                  <text
                    className={styles.gapLabel}
                    x={labelX}
                    y={nearTop ? HEIGHT - MARGIN.bottom - 6 : MARGIN.top + 10}
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {runs.map((run) => (
            <g key={run[0]?.[0]}>
              <path className={styles.band} d={band(run)} />
              {run.length > 1 && <path className={styles.line} d={line(run)} />}
              {run.length === 1 && run[0] && (
                <circle className={styles.dot} cx={x(run[0][0])} cy={y(run[0][3])} r={4} />
              )}
            </g>
          ))}
          {/* The latest price, labelled at the end of the line. */}
          <circle className={styles.dot} cx={x(last[0])} cy={y(last[3])} r={4} />
          <text className={styles.endLabel} x={x(last[0]) + 8} y={y(last[3])} dy="0.32em">
            {formatPrice(last[3])}
          </text>
          {!single && engaged && (
            <line
              className={styles.crosshair}
              x1={x(current[0])}
              x2={x(current[0])}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
            />
          )}
        </svg>
      </div>
      <p className={styles.readout}>
        <strong>{formatDay(current[0])}:</strong> last {formatPrice(current[3])}, low{' '}
        {formatPrice(current[1])}, high {formatPrice(current[2])} cents a litre
      </p>
      {/* Each swatch and its words are one unit: the items wrap whole, never inside. */}
      <p className={styles.key}>
        <span className={styles.keyItem}>
          <span className={styles.keyLine} aria-hidden="true" /> The day’s last price
        </span>{' '}
        <span className={styles.keyItem}>
          <span className={styles.keyBand} aria-hidden="true" /> its low to high
        </span>
      </p>
    </div>
  );
}
