// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fixtureSnapshot } from './__fixtures__/snapshot';
import { statusReport } from './status';

const at = (iso: string) => Date.parse(iso);
const served = (fetchedAt: string) => ({ ...fixtureSnapshot, fetchedAt });
const run = (startedAt: string, fetchedAt = startedAt, ok = true) => ({
  ok,
  startedAt,
  ...(ok ? { fetchedAt } : { error: { kind: 'unavailable', message: 'prices: HTTP 503' } }),
  calls: { token: 0, prices: 1 },
});

describe('statusReport', () => {
  it('is healthy when the API serves what the last run wrote', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:00:34.365Z', '2026-10-23T08:00:37.309Z'),
      now: at('2026-10-23T08:10:00Z'),
    });
    expect(report).toMatchObject({ healthy: true, problems: [] });
    expect(report.served?.stations).toBe(fixtureSnapshot.stations.length);
  });

  it('allows the few minutes a new snapshot takes to reach the API', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:30:34.433Z'),
      now: at('2026-10-23T08:32:00Z'),
    });
    expect(report.healthy).toBe(true);
  });

  it('reports the 2026-10-23 stall: newer snapshot written, older one served', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:30:34.433Z'),
      now: at('2026-10-23T08:43:48Z'),
    });
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual([
      'The API is serving the snapshot from 2026-10-23T08:00:37.309Z, but a newer one was written 13 minutes ago (2026-10-23T08:30:34.433Z).',
    ]);
  });

  it('reports a failed run', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:30:34.433Z', '', false),
      now: at('2026-10-23T08:31:00Z'),
    });
    expect(report.problems).toEqual([
      'The last scheduled run failed (unavailable): prices: HTTP 503',
    ]);
    expect(report.lastRun).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('reports runs that have stopped, and a stale served snapshot', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:00:34.365Z', '2026-10-23T08:00:37.309Z'),
      now: at('2026-10-23T10:00:00Z'),
    });
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual([
      'No scheduled run for 119 minutes (expected every 30).',
      'The snapshot being served is 119 minutes old.',
    ]);
  });

  it('reports a pipeline that has never run', () => {
    const report = statusReport({ served: null, lastRun: null, now: at('2026-10-23T08:00:00Z') });
    expect(report.problems).toEqual([
      'No scheduled run has been recorded.',
      'The API has no snapshot to serve.',
    ]);
  });

  it('treats an unreadable run record as missing', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: { surprise: true },
      now: at('2026-10-23T08:01:00Z'),
    });
    expect(report.problems).toEqual(['No scheduled run has been recorded.']);
  });
});
