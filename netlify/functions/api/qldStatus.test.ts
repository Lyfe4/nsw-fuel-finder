// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { QLD_MONTHLY_ALERT, qldStatusReport } from './qldStatus';
import { statusReport } from './status';

const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-02T03:00:00Z');

const healthy = {
  lastRun: { ok: true, startedAt: '2026-11-02T02:50:00Z', fetchedAt: '2026-11-02T02:50:01Z' },
  written: { fetchedAt: '2026-11-02T02:50:01Z', stationCount: 1785 },
  calls: { version: 1, month: '2026-11', runs: 288, reference: 6, prices: 288 },
  reference: { fetchedAt: '2026-11-01T20:00:00Z', siteCount: 1807 },
};

describe('qldStatusReport', () => {
  it('is healthy when the job is running and its data is fresh', () => {
    expect(qldStatusReport(healthy, NOW, false)).toEqual({
      healthy: true,
      public: false,
      problems: [],
      lastRun: {
        ok: true,
        startedAt: healthy.lastRun.startedAt,
        fetchedAt: healthy.lastRun.fetchedAt,
      },
      written: { fetchedAt: healthy.written.fetchedAt, stations: 1785 },
      referenceFetchedAt: healthy.reference.fetchedAt,
      callsThisMonth: { month: '2026-11', calls: 294, budget: QLD_MONTHLY_ALERT },
    });
  });

  it('reports a failed run, a stalled job, stale prices and old site details', () => {
    const report = qldStatusReport(
      {
        lastRun: {
          ok: false,
          startedAt: '2026-11-02T02:20:00Z',
          error: { kind: 'timeout', message: 'x' },
        },
        written: { fetchedAt: '2026-11-02T02:20:00Z', stationCount: 1785 },
        calls: null,
        reference: { fetchedAt: '2026-10-31T23:00:00Z' },
      },
      NOW,
      false,
    );
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual([
      'The last scheduled run failed (timeout).',
      'No scheduled run for 40 minutes (expected every 10).',
      'The newest snapshot is 40 minutes old.',
      'The site details are 28 hours old (the licence allows 24).',
    ]);
  });

  it('reports nothing recorded, and a call count past the alarm', () => {
    const report = qldStatusReport(
      { lastRun: null, written: null, calls: { ...healthy.calls, prices: 6_100 }, reference: null },
      NOW,
      false,
    );
    expect(report.problems).toEqual([
      'No scheduled run has been recorded.',
      'No snapshot has been written.',
      '6106 QLD API calls so far in 2026-11, over the 6000 expected at most.',
    ]);
  });

  it('counts calls by Brisbane month', () => {
    // 13:30 UTC on 31 October is November in Sydney, still October in Brisbane.
    const report = qldStatusReport(
      { ...healthy, calls: { ...healthy.calls, month: '2026-10' } },
      at('2026-10-31T13:30:00Z'),
      false,
    );
    expect(report.callsThisMonth.month).toBe('2026-10');
    expect(report.callsThisMonth.calls).toBe(294);
  });
});

describe('/api/status with Queensland', () => {
  const nsw = {
    served: { version: 1 as const, fetchedAt: '2026-11-02T02:30:00Z', stations: [] },
    lastRun: { ok: true, startedAt: '2026-11-02T02:30:00Z', fetchedAt: '2026-11-02T02:30:00Z' },
    now: NOW,
  };
  const broken = { lastRun: null, written: null, calls: null, reference: null };

  it('reports QLD problems without failing the status while QLD is not public', () => {
    const report = statusReport({ ...nsw, qld: broken, qldPublic: false });
    expect(report.healthy).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.sources.qld.healthy).toBe(false);
    expect(report.sources.qld.problems).toContain('No snapshot has been written.');
  });

  it('fails the status on a QLD problem once QLD is public, saying which state', () => {
    const report = statusReport({ ...nsw, qld: broken, qldPublic: true });
    expect(report.healthy).toBe(false);
    expect(report.problems).toEqual([
      'QLD: No scheduled run has been recorded.',
      'QLD: No snapshot has been written.',
    ]);
  });

  it('is healthy with both healthy and public', () => {
    expect(statusReport({ ...nsw, qld: healthy, qldPublic: true }).healthy).toBe(true);
  });
});
