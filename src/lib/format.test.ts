import { describe, expect, it } from 'vitest';

import { formatAge, formatAsOf, formatDistance, formatPrice } from './format';

describe('format', () => {
  it.each([
    [227.5, '227.5'],
    [230, '230.0'],
  ])('price %d -> %s', (cents, text) => {
    expect(formatPrice(cents)).toBe(text);
  });

  it.each([
    [0.424, '420 m'],
    [0.05, '50 m'],
    [3.91, '3.9 km'],
    [12.3, '12 km'],
  ])('distance %d km -> %s', (km, text) => {
    expect(formatDistance(km)).toBe(text);
  });

  it('shows the snapshot time in Sydney, with the date only when it is not today', () => {
    // 03:30 UTC is 2:30 pm in Sydney (AEDT) on 23 October.
    const now = new Date('2026-10-23T04:00:00Z');
    expect(formatAsOf('2026-10-23T03:30:00Z', now)).toBe('2:30 pm');
    // ICU versions differ on the comma after the weekday.
    expect(formatAsOf('2026-10-21T03:30:00Z', now)).toMatch(/^Wed,? 21 Oct, 2:30 pm$/);
  });

  it('describes how old a price is', () => {
    const now = new Date('2026-10-23T04:00:00Z');
    expect(formatAge('2026-10-23T03:59:30Z', now)).toBe('just now');
    expect(formatAge('2026-10-23T03:15:00Z', now)).toBe('45 minutes ago');
    expect(formatAge('2026-10-23T01:00:00Z', now)).toBe('3 hours ago');
    expect(formatAge('2026-10-22T04:00:00Z', now)).toBe('yesterday');
    expect(formatAge('2026-10-11T04:00:00Z', now)).toBe('12 days ago');
    expect(formatAge('2026-07-01T04:00:00Z', now)).toBe('4 months ago');
    // The oldest live price is from 2018: a station that never changed it.
    expect(formatAge('2018-06-25T00:15:01Z', now)).toBe('8 years ago');
  });
});
