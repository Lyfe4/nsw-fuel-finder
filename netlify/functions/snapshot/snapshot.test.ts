// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { config } from './snapshot';
import { SNAPSHOT_INTERVAL_MINUTES } from '../../lib/snapshot/format';

describe('the snapshot schedule', () => {
  it('runs as often as the staleness rules assume', () => {
    // The cron is a literal Netlify reads statically; this keeps it honest.
    expect(config.schedule).toBe(`*/${String(SNAPSHOT_INTERVAL_MINUTES)} * * * *`);
  });
});
