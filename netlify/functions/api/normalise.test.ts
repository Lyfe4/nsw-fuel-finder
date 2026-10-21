// @vitest-environment node
import { describe, expect, it } from 'vitest';

import location from './__fixtures__/location.json';
import lovs from './__fixtures__/lovs.json';
import nearby from './__fixtures__/nearby.json';
import { normalisePrices, normaliseReference } from './normalise';
import { pricesResponseSchema, referenceResponseSchema } from './schemas';

const nearbyUpstream = pricesResponseSchema.parse(nearby);
const locationUpstream = pricesResponseSchema.parse(location);

describe('normalisePrices (nearby fixture)', () => {
  const result = normalisePrices(nearbyUpstream, 'P95', { includeDistance: true });

  it('sorts cheapest first, then nearest on a price tie', () => {
    expect(result.stations.map((s) => [s.name, s.priceCents, s.distanceKm])).toEqual([
      ['7-Eleven Erina', 179.5, 4.5],
      ['Ampol Gosford', 186.9, 3.21],
      ['BP Wyoming', 186.9, 5.96],
    ]);
  });

  it('drops Tasmanian rows that v2 includes', () => {
    expect(result.stations.some((s) => s.address.includes('TAS'))).toBe(false);
  });

  it('drops a station with no price for the requested fuel', () => {
    expect(result.stations.some((s) => s.name === 'Shell Point Frederick')).toBe(false);
  });

  it('merges station and price into our own shape', () => {
    expect(result.fuelType).toBe('P95');
    expect(result.stations[0]).toEqual({
      stationCode: '402',
      name: '7-Eleven Erina',
      brand: '7-Eleven',
      address: '1 Terrigal Drive, Erina NSW 2250',
      latitude: -33.4371,
      longitude: 151.3901,
      distanceKm: 4.5,
      priceCents: 179.5,
      priceUpdatedAt: '2026-06-30T23:15:00+10:00',
    });
  });

  it('serves the other fuel from the same data', () => {
    const e10 = normalisePrices(nearbyUpstream, 'E10', { includeDistance: true });
    expect(e10.stations.map((s) => s.name)).toEqual(['Shell Point Frederick']);
  });
});

describe('normalisePrices (location fixture)', () => {
  const result = normalisePrices(locationUpstream, 'P95', { includeDistance: false });

  it('accepts the v1-style rows: string codes, no state, dd/MM/yyyy times', () => {
    expect(result.stations.map((s) => [s.stationCode, s.priceCents, s.priceUpdatedAt])).toEqual([
      ['302', 184.5, '2026-09-26T14:05:00+10:00'],
      ['301', 186.9, '2026-09-26T02:51:27+10:00'],
    ]);
  });

  it('reports no distance, because the reference point was not the user', () => {
    expect(result.stations.every((s) => s.distanceKm === null)).toBe(true);
  });
});

describe('normalisePrices edge cases', () => {
  const station = (code: string | number, name = `Station ${String(code)}`) => ({
    code,
    name,
    brand: 'BP',
    address: '1 Test St, Testville NSW 2000',
    location: { latitude: -33.8, longitude: 151.2, distance: 1 },
  });
  const price = (code: string | number, value: number, lastupdated = '21/10/2026 10:00:00') => ({
    stationcode: code,
    fueltype: 'E10',
    price: value,
    lastupdated,
  });

  it('joins an integer price code to a string station code', () => {
    const upstream = pricesResponseSchema.parse({
      stations: [station('77')],
      prices: [price(77, 170)],
    });
    expect(normalisePrices(upstream, 'E10', { includeDistance: true }).stations).toHaveLength(1);
  });

  it('skips zero prices, unreadable timestamps and duplicate stations', () => {
    const upstream = pricesResponseSchema.parse({
      stations: [station(1), station(2), station(3), station(3)],
      prices: [price(1, 0), price(2, 170, 'soon'), price(3, 171)],
    });
    const result = normalisePrices(upstream, 'E10', { includeDistance: true });
    expect(result.stations.map((s) => s.stationCode)).toEqual(['3']);
  });

  it('breaks a full tie by name', () => {
    const upstream = pricesResponseSchema.parse({
      stations: [station(1, 'Zeta'), station(2, 'alpha')],
      prices: [price(1, 170), price(2, 170)],
    });
    const names = normalisePrices(upstream, 'E10', { includeDistance: true }).stations.map(
      (s) => s.name,
    );
    expect(names).toEqual(['alpha', 'Zeta']);
  });

  it('returns an empty list rather than failing when nothing matches', () => {
    expect(normalisePrices(nearbyUpstream, 'LPG', { includeDistance: true }).stations).toEqual([]);
  });
});

describe('normaliseReference', () => {
  const result = normaliseReference(referenceResponseSchema.parse(lovs));

  it('keeps NSW fuel types only, once each', () => {
    expect(result.fuelTypes).toEqual([
      { code: 'E10', name: 'Ethanol 94' },
      { code: 'P95', name: 'Premium 95' },
      { code: 'EV', name: 'EV charge' },
    ]);
  });

  it('keeps NSW brands only, de-duplicated and sorted case-insensitively', () => {
    expect(result.brands).toEqual(['ampol', 'BP', 'Shell']);
  });
});
