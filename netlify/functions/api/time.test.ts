// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatRequestTimestamp, parseUpstreamTimestamp } from './time';

describe('formatRequestTimestamp', () => {
  it.each([
    ['2026-10-21T13:05:09Z', '21/10/2026 01:05:09 PM'],
    ['2026-10-21T00:00:00Z', '21/10/2026 12:00:00 AM'],
    ['2026-10-21T12:00:00Z', '21/10/2026 12:00:00 PM'],
    ['2026-01-02T03:04:05Z', '02/01/2026 03:04:05 AM'],
  ])('formats %s in UTC as %s', (iso, expected) => {
    expect(formatRequestTimestamp(new Date(iso))).toBe(expected);
  });
});

describe('parseUpstreamTimestamp', () => {
  it('reads dd/MM/yyyy in winter as AEST (+10:00)', () => {
    expect(parseUpstreamTimestamp('26/06/2026 02:51:27')).toBe('2026-06-26T02:51:27+10:00');
  });

  it('reads dd/MM/yyyy in summer as AEDT (+11:00)', () => {
    expect(parseUpstreamTimestamp('21/10/2026 14:05:00')).toBe('2026-10-21T14:05:00+11:00');
  });

  it('reads the yyyy-MM-dd form the v2 nearby endpoint uses', () => {
    expect(parseUpstreamTimestamp('2026-10-21 09:48:51')).toBe('2026-10-21T09:48:51+11:00');
  });

  it('does not depend on the server timezone', () => {
    // The instant must be the same however the string is produced.
    const iso = parseUpstreamTimestamp('21/10/2026 14:05:00');
    expect(new Date(iso ?? '').toISOString()).toBe('2026-10-21T03:05:00.000Z');
  });

  it('moves a time inside the spring-forward gap to a real instant', () => {
    // Clocks went from 02:00 to 03:00 on 4 October 2026; 02:30 never happened.
    expect(parseUpstreamTimestamp('04/10/2026 02:30:00')).toBe('2026-10-04T03:30:00+11:00');
  });

  it('handles the day either side of daylight saving ending', () => {
    // Clocks went from 03:00 back to 02:00 on 5 April 2026.
    expect(parseUpstreamTimestamp('04/04/2026 12:00:00')).toBe('2026-04-04T12:00:00+11:00');
    expect(parseUpstreamTimestamp('06/04/2026 12:00:00')).toBe('2026-04-06T12:00:00+10:00');
  });

  it.each(['', 'yesterday', '2026-10-21T09:48:51Z', '13/13/2026 00:00:00', '01/01/2026 24:00:00'])(
    'returns null for %j',
    (value) => {
      expect(parseUpstreamTimestamp(value)).toBeNull();
    },
  );
});
