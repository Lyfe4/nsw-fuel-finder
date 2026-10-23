// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { POSTCODES, SUBURBS, suggestPlaces, suburbByLabel } from './gazetteer';

// The same generous box /api/nearby accepts.
const inNswOrAct = ({ latitude, longitude }: { latitude: number; longitude: number }) =>
  latitude >= -37.6 && latitude <= -28.1 && longitude >= 140.9 && longitude <= 159.2;

describe('the bundled ABS gazetteer', () => {
  it('has every NSW and ACT suburb and postcode', () => {
    expect(SUBURBS.length).toBeGreaterThan(4500);
    expect(POSTCODES.size).toBeGreaterThan(600);
  });

  it('gives every suburb a unique label, so a label always means one place', () => {
    expect(new Set(SUBURBS.map((s) => s.label)).size).toBe(SUBURBS.length);
    for (const suburb of SUBURBS) expect(suburbByLabel(suburb.label)).toBe(suburb);
  });

  it('puts every point inside NSW or the ACT (Lord Howe Island included)', () => {
    expect(SUBURBS.filter((s) => !inNswOrAct(s)).map((s) => s.label)).toEqual([]);
    expect([...POSTCODES.values()].filter((p) => !inNswOrAct(p))).toEqual([]);
  });

  it('gives all but a handful of border localities a postcode', () => {
    // Barooga, Texas and the like use a VIC or QLD postcode, which is outside
    // the 2xxx postal areas the build reads.
    expect(SUBURBS.filter((s) => !s.postcode).length).toBeLessThanOrEqual(10);
  });
});

describe('suggestPlaces', () => {
  it('ranks an exact name above longer names that start with it', () => {
    expect(suggestPlaces('bondi')).toEqual(
      expect.arrayContaining(['Bondi NSW 2026', 'Bondi Beach NSW 2026', 'Bondi Junction NSW 2022']),
    );
    expect(suggestPlaces('bondi')[0]).toBe('Bondi NSW 2026');
  });

  it('matches a later word of a name', () => {
    expect(suggestPlaces('druitt')).toContain('Mount Druitt NSW 2770');
  });

  it('matches the ABS qualifier', () => {
    expect(suggestPlaces('penrith')).toContain('Kingswood (Penrith) NSW 2747');
  });

  it('returns nothing for nothing', () => {
    expect(suggestPlaces('')).toEqual([]);
    expect(suggestPlaces('  ')).toEqual([]);
  });
});
