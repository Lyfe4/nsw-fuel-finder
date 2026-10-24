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
    // The kind only: the message can carry internals, and this is public.
    expect(report.problems).toEqual(['The last scheduled run failed (unavailable).']);
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

  it('says the run record could not be read, rather than that there are no runs', () => {
    const report = statusReport({
      served: served('2026-10-23T09:00:35.734Z'),
      lastRun: null,
      lastRunError:
        'Netlify Blobs has generated an internal error (Failed to decode token: Token expired)',
      now: at('2026-10-23T09:11:00Z'),
    });
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual(['Could not read the last run record.']);
    expect(JSON.stringify(report)).not.toContain('Token expired');
  });

  it('treats an unreadable run record as missing', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: { surprise: true },
      now: at('2026-10-23T08:01:00Z'),
    });
    expect(report.problems).toEqual(['No scheduled run has been recorded.']);
  });

  it('counts this month’s API.NSW calls', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:00:34.365Z', '2026-10-23T08:00:37.309Z'),
      calls: { version: 1, month: '2026-10', token: 3, prices: 70, runs: 70 },
      now: at('2026-10-23T08:10:00Z'),
    });
    expect(report.healthy).toBe(true);
    expect(report.callsThisMonth).toEqual({ month: '2026-10', calls: 73, budget: 2000 });
  });

  it('warns before the monthly quota runs out, so a call leak is seen in days, not at 2,500', () => {
    const report = statusReport({
      served: served('2026-10-23T08:00:37.309Z'),
      lastRun: run('2026-10-23T08:00:34.365Z', '2026-10-23T08:00:37.309Z'),
      calls: { version: 1, month: '2026-10', token: 10, prices: 1995, runs: 1990 },
      now: at('2026-10-23T08:10:00Z'),
    });
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual([
      '2005 API.NSW calls so far in 2026-10, over the 2000 planned (the quota is 2500).',
    ]);
  });

  it('starts each month at zero, in Sydney time', () => {
    const report = statusReport({
      served: served('2026-10-31T13:00:37.309Z'),
      lastRun: run('2026-10-31T13:00:34.365Z', '2026-10-31T13:00:37.309Z'),
      // 00:10 on 1 November in Sydney; the record is October's.
      calls: { version: 1, month: '2026-10', token: 60, prices: 1488, runs: 1488 },
      now: at('2026-10-31T13:10:00Z'),
    });
    expect(report.callsThisMonth).toEqual({ month: '2026-11', calls: 0, budget: 2000 });
  });
});
