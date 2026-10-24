// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { config, runsIn } from './snapshot';
import { SNAPSHOT_INTERVAL_MINUTES } from '../../lib/snapshot/format';

describe('the snapshot schedule', () => {
  it('runs as often as the staleness rules assume', () => {
    // The cron is a literal Netlify reads statically; this keeps it honest.
    expect(config.schedule).toBe(`*/${String(SNAPSHOT_INTERVAL_MINUTES)} * * * *`);
  });
});

/*
 * The Blobs store is site-wide, so a deploy preview's functions share
 * production's. "Run now" on a preview's snapshot function in the Netlify UI
 * would write production's meta/last-run (and count a run) from a deploy
 * with no API.NSW credentials.
 */
describe('where the job runs', () => {
  it.each(['deploy-preview', 'branch-deploy'])('does nothing on a %s', (context) => {
    expect(runsIn({ deploy: { context } })).toBe(false);
  });

  it.each(['production', 'dev'])('runs in %s', (context) => {
    expect(runsIn({ deploy: { context } })).toBe(true);
  });

  it('runs when Netlify does not say, rather than stop production', () => {
    expect(runsIn(undefined)).toBe(true);
    expect(runsIn({})).toBe(true);
  });
});
