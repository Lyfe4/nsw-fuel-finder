// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatRequestTimestamp, parseUpstreamTimestamp, sydneyDay } from './time';

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
  it('reads the live dd/MM/yyyy format as UTC', () => {
    // From the recorded response: fetched at 03:21:27 UTC, this was 4 minutes old.
    expect(parseUpstreamTimestamp('21/10/2026 03:17:28')).toBe('2026-10-21T03:17:28Z');
  });

  it('reads the yyyy-MM-dd form from the spec example as UTC too', () => {
    expect(parseUpstreamTimestamp('2019-09-29 22:48:51')).toBe('2019-09-29T22:48:51Z');
  });

  it('is unaffected by daylight saving, because UTC has none', () => {
    expect(parseUpstreamTimestamp('04/10/2026 02:30:00')).toBe('2026-10-04T02:30:00Z');
  });

  it.each([
    '',
    'yesterday',
    '2026-10-21T09:48:51Z',
    '13/13/2026 00:00:00',
    '31/02/2026 00:00:00',
    '01/01/2026 24:00:00',
  ])('returns null for %j', (value) => {
    expect(parseUpstreamTimestamp(value)).toBeNull();
  });
});

describe('sydneyDay', () => {
  it('rolls over at Sydney midnight, not UTC midnight', () => {
    // 13:30 UTC on the 20th is 00:30 on the 21st in Sydney (AEDT, +11).
    expect(sydneyDay(new Date('2026-10-20T13:30:00Z'))).toBe('2026-10-21');
    expect(sydneyDay(new Date('2026-10-20T12:30:00Z'))).toBe('2026-10-20');
  });

  it('uses +10 outside daylight saving', () => {
    expect(sydneyDay(new Date('2026-06-20T13:30:00Z'))).toBe('2026-06-20');
    expect(sydneyDay(new Date('2026-06-20T14:30:00Z'))).toBe('2026-06-21');
  });
});
