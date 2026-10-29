// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildQldSnapshot, buildReference, parseQldTimestamp } from './build';
import {
  qldBrands,
  qldPrices,
  qldRegions,
  qldSites,
  QLD_FIXTURE_AT,
} from '../__fixtures__/fakeQld';
import { snapshotSchema } from '../snapshot/format';

const at = new Date(QLD_FIXTURE_AT);
const referenceStatus = { fetchedAt: at.toISOString(), refreshed: true };

function build() {
  const { reference, stats } = buildReference(
    { sites: qldSites.S, brands: qldBrands, regions: qldRegions },
    at,
  );
  return {
    reference,
    referenceStats: stats,
    ...buildQldSnapshot(reference, qldPrices.SitePrices, at, referenceStatus),
  };
}

describe('parseQldTimestamp', () => {
  it('reads a stamp with no offset as UTC, whatever the machine’s zone', () => {
    // The live format. Date.parse would read this as local time.
    expect(parseQldTimestamp('2026-09-19T21:09:50.913')).toBe('2026-09-19T21:09:50Z');
    expect(parseQldTimestamp('2026-09-19T21:09:50')).toBe('2026-09-19T21:09:50Z');
  });

  it.each(['Australia/Brisbane', 'Australia/Sydney', 'America/New_York'])(
    'gives the same answer with the machine in %s',
    (zone) => {
      const before = process.env.TZ;
      process.env.TZ = zone;
      try {
        // Proof the zone took effect, then that the parse ignores it.
        expect(new Date('2026-09-19T21:09:50').toISOString()).not.toBe('2026-09-19T21:09:50.000Z');
        expect(parseQldTimestamp('2026-09-19T21:09:50.913')).toBe('2026-09-19T21:09:50Z');
      } finally {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      }
    },
  );

  it('honours an offset if one ever appears', () => {
    expect(parseQldTimestamp('2026-09-20T07:09:50+10:00')).toBe('2026-09-19T21:09:50Z');
    expect(parseQldTimestamp('2026-09-19T21:09:50Z')).toBe('2026-09-19T21:09:50Z');
  });

  it('refuses what is not a real date in that format', () => {
    expect(parseQldTimestamp('2026-02-31T00:00:00')).toBeNull();
    expect(parseQldTimestamp('29/10/2026 00:00')).toBeNull();
    expect(parseQldTimestamp('')).toBeNull();
  });
});

describe('buildReference', () => {
  it('keeps what a station needs, tidied, with QLD’s brand names mapped to FuelCheck’s', () => {
    const { reference, referenceStats } = build();
    expect(reference.sites['61000002']).toEqual({
      name: 'Sample Servo Surat',
      street: '10 Sample St',
      suburb: 'SURAT',
      postcode: '4417',
      brand: '7-Eleven',
      lat: -27.152,
      lng: 149.068,
    });
    expect(reference.sites['61000004']).toMatchObject({ street: '', suburb: null, brand: '' });
    expect(referenceStats).toEqual({
      sites: 4,
      skippedSites: 1,
      unknownSuburbs: 1,
      outsideBounds: 0,
    });
  });

  it('leaves out a site whose coordinates are outside Queensland, and counts it (round 16)', () => {
    const [first] = qldSites.S as Record<string, unknown>[];
    const sites = [
      ...qldSites.S,
      // Swapped, at 0,0, and in Sydney: none can be a Queensland site.
      { ...first, S: 61000101, Lat: 153.514, Lng: -28.164 },
      { ...first, S: 61000102, Lat: 0, Lng: 0 },
      { ...first, S: 61000103, Lat: -33.87, Lng: 151.21 },
    ];
    const { reference, stats } = buildReference(
      { sites, brands: qldBrands, regions: qldRegions },
      at,
    );
    expect(stats.outsideBounds).toBe(3);
    expect(stats.sites).toBe(4);
    expect(Object.keys(reference.sites)).not.toEqual(
      expect.arrayContaining(['61000101', '61000102', '61000103']),
    );
    for (const id of ['61000101', '61000102', '61000103'])
      expect(reference.sites[id]).toBeUndefined();
  });
});

describe('buildQldSnapshot', () => {
  it('builds stations in NSW’s shape, with prefixed codes and cents', () => {
    const { snapshot } = build();
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    const coolangatta = snapshot.stations.find((s) => s.code === 'qld-61000001');
    expect(coolangatta).toEqual({
      code: 'qld-61000001',
      name: 'Test Fuel Coolangatta',
      brand: 'Caltex',
      address: '1 Example Ave, Coolangatta QLD 4225',
      suburb: 'Coolangatta',
      postcode: '4225',
      state: 'QLD',
      lat: -28.164,
      lng: 153.514,
      // 2399 tenths of a cent; the unavailable E10 and the OPAL row are gone.
      prices: { U91: [239.9, '2026-10-29T00:30:00Z'] },
    });
  });

  it('leaves out unavailable, implausible, unknown and malformed prices, and counts them', () => {
    const { snapshot, stats } = build();
    expect(stats.skippedPrices).toEqual({
      badRow: 1,
      unknownFuel: 1,
      unavailable: 1,
      implausible: 1,
      badTimestamp: 1,
      unknownSite: 1,
    });
    const surat = snapshot.stations.find((s) => s.code === 'qld-61000002');
    expect(surat?.prices.DL).toBeUndefined();
    expect(surat?.prices.P98).toEqual([264.9, '2026-10-28T22:00:00Z']);
  });

  it('clamps a price stamped after the run to the run’s time', () => {
    const { snapshot, stats } = build();
    const surat = snapshot.stations.find((s) => s.code === 'qld-61000002');
    expect(surat?.prices.U91).toEqual([219.9, '2026-10-29T00:48:28Z']);
    expect(stats.futureClamped).toBe(1);
  });

  it('drops stations with no price, and builds an address without a street or suburb', () => {
    const { snapshot, stats } = build();
    expect(snapshot.stations.map((s) => s.code).sort()).toEqual([
      'qld-61000001',
      'qld-61000002',
      'qld-61000004',
    ]);
    expect(stats.skippedStations.noPrices).toBe(1);
    expect(snapshot.stations.find((s) => s.code === 'qld-61000004')?.address).toBe('QLD 4000');
    expect(stats.stations).toBe(3);
    expect(stats.prices).toBe(4);
  });
});
