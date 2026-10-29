// @vitest-environment node
import { statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  allPostcodeAreas,
  isQldPostcode,
  postcodeArea,
  SUBURBS,
  suggestPlaces,
  suburbByLabel,
  suburbsNamed,
} from './gazetteer';

// The same generous boxes /api/nearby accepts (Lord Howe Island included for NSW).
const inNswOrAct = ({ latitude, longitude }: { latitude: number; longitude: number }) =>
  latitude >= -37.6 && latitude <= -28.1 && longitude >= 140.9 && longitude <= 159.2;
const inQld = ({ latitude, longitude }: { latitude: number; longitude: number }) =>
  latitude >= -29.2 && latitude <= -9.0 && longitude >= 137.9 && longitude <= 156;

const nswAct = SUBURBS.filter((s) => s.state !== 'QLD');
const qld = SUBURBS.filter((s) => s.state === 'QLD');

describe('the bundled ABS gazetteer', () => {
  it('has every NSW, ACT and Queensland suburb and postcode', () => {
    expect(nswAct.length).toBeGreaterThan(4500);
    expect(qld.length).toBeGreaterThan(3000);
    expect(allPostcodeAreas().filter((p) => !isQldPostcode(p.postcode)).length).toBeGreaterThan(
      600,
    );
    expect(allPostcodeAreas().filter((p) => isQldPostcode(p.postcode)).length).toBeGreaterThan(400);
  });

  it('gives every suburb a unique label, so a label always means one place', () => {
    expect(new Set(SUBURBS.map((s) => s.label)).size).toBe(SUBURBS.length);
    for (const suburb of SUBURBS) expect(suburbByLabel(suburb.label, true)).toBe(suburb);
  });

  it('puts every point inside its own state (Lord Howe Island included)', () => {
    expect(nswAct.filter((s) => !inNswOrAct(s)).map((s) => s.label)).toEqual([]);
    expect(qld.filter((s) => !inQld(s)).map((s) => s.label)).toEqual([]);
    for (const area of allPostcodeAreas()) {
      expect(isQldPostcode(area.postcode) ? inQld(area) : inNswOrAct(area)).toBe(true);
    }
  });

  it('gives each suburb a postcode from its own state only', () => {
    for (const suburb of SUBURBS) {
      if (suburb.postcode) expect(isQldPostcode(suburb.postcode)).toBe(suburb.state === 'QLD');
    }
    // Barooga, Texas NSW and the like use a VIC or QLD postcode, and the
    // seas around Queensland have none.
    expect(SUBURBS.filter((s) => !s.postcode).length).toBeLessThanOrEqual(14);
  });

  it('stays a reasonable size for the function to load', () => {
    // Bundled into the api function, not the browser; parsed once per instance.
    const bytes = statSync(new URL('./gazetteer.json', import.meta.url)).size;
    expect(bytes).toBeLessThan(700_000);
  });
});

describe('Queensland, only while it is public', () => {
  it('is not offered, found or placed by default', () => {
    expect(suggestPlaces('coolangatta')).toEqual(['Coolangatta NSW 2535']);
    expect(suggestPlaces('4225')).toEqual([]);
    expect(suburbsNamed('Surat')).toEqual([]);
    expect(suburbByLabel('Coolangatta QLD 4225')).toBeUndefined();
    expect(postcodeArea('4225')).toBeUndefined();
    expect(postcodeArea('2485')).toBeDefined();
  });

  it('is offered, found and placed with it', () => {
    expect(suggestPlaces('coolangatta', true)).toEqual([
      'Coolangatta NSW 2535',
      'Coolangatta QLD 4225',
    ]);
    expect(suggestPlaces('4225', true)).toContain('Coolangatta QLD 4225');
    expect(suburbsNamed('Surat', true).map((s) => s.label)).toEqual(['Surat QLD 4417']);
    expect(postcodeArea('4225', true)).toBeDefined();
  });

  it('drops a qualifier that only names the state, and keeps one that names a place', () => {
    expect(suburbsNamed('Abbotsford', true).map((s) => s.label)).toEqual(
      expect.arrayContaining(['Abbotsford NSW 2046', 'Abbotsford QLD 4670']),
    );
    expect(suggestPlaces('albion', true)).toEqual(
      expect.arrayContaining(['Albion (Brisbane) QLD 4010']),
    );
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
