// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildSnapshot } from './build';
import { snapshotSchema } from './format';
import { FIXTURE_FETCHED_AT } from '../__fixtures__/fakeUpstream';
import prices from '../__fixtures__/prices.json';
import { statewidePricesSchema } from '../upstream/schemas';

// The recorded live response: 36 real stations chosen for their edge cases.
const upstream = statewidePricesSchema.parse(prices);
const { snapshot, stats } = buildSnapshot(upstream, new Date(FIXTURE_FETCHED_AT));
const byCode = new Map(snapshot.stations.map((station) => [station.code, station]));

describe('buildSnapshot on recorded live data', () => {
  it('produces a snapshot that passes its own schema', () => {
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.fetchedAt).toBe('2026-10-21T03:21:27.000Z');
  });

  it('joins prices to stations, matching numeric price codes to string station codes', () => {
    const wyoming = byCode.get('2263');
    expect(wyoming).toMatchObject({
      name: 'Ampol Foodary Wyoming',
      suburb: 'Wyoming',
      postcode: '2250',
      state: 'NSW',
    });
    expect(Object.keys(wyoming?.prices ?? {}).length).toBeGreaterThan(0);
  });

  it('stores prices as [cents, ISO UTC] tuples', () => {
    for (const station of snapshot.stations) {
      for (const tuple of Object.values(station.prices)) {
        expect(tuple[0]).toBeGreaterThan(0);
        expect(tuple[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    }
  });

  it('drops EV, whose live prices are 0 or years old and per kWh', () => {
    expect(stats.skippedPrices.unknownFuel).toBeGreaterThan(0);
    expect(snapshot.stations.some((station) => 'EV' in station.prices)).toBe(false);
  });

  it('drops EV chargers, which have no fuel price at all', () => {
    // 17243 is "NRMA Fast Charger"; 889 of the 3,286 live stations are like it.
    expect(byCode.has('17243')).toBe(false);
    // 18101 (Tyndale) has an EV row too, but sells fuel, so it stays.
    expect(byCode.has('18101')).toBe(true);
    expect(stats.skippedStations.noPrices).toBeGreaterThan(0);
  });

  it('keeps the one B20 station and its biodiesel price', () => {
    expect(snapshot.stations.some((station) => station.prices.B20)).toBe(true);
  });

  it('tells ACT stations apart by their address, though upstream says NSW', () => {
    expect(byCode.get('18788')).toMatchObject({ state: 'ACT', suburb: 'Braddon' });
    expect(byCode.get('18810')).toMatchObject({ state: 'ACT', suburb: 'Griffith' });
  });

  it('recovers the suburb for an address without a comma', () => {
    expect(byCode.get('18103')).toMatchObject({ suburb: 'Balranald', postcode: '2715' });
  });

  it('counts what it kept', () => {
    expect(stats.stations).toBe(snapshot.stations.length);
    expect(stats.prices).toBe(
      snapshot.stations.reduce((n, station) => n + Object.keys(station.prices).length, 0),
    );
  });
});

describe('buildSnapshot edge cases', () => {
  const station = (code: string, address = `1 Test St, Testville NSW 2000`) => ({
    code,
    name: `Station ${code}`,
    brand: 'BP',
    address,
    location: { latitude: -33.8, longitude: 151.2 },
    state: 'NSW',
  });
  const price = (
    code: number,
    value: number,
    lastupdated = '21/10/2026 01:00:00',
    state = 'NSW',
  ) => ({
    stationcode: String(code),
    fueltype: 'E10',
    price: value,
    lastupdated,
    state,
  });

  it('skips zero prices, unreadable timestamps, other states and duplicate stations', () => {
    const { snapshot: s, stats: st } = buildSnapshot(
      statewidePricesSchema.parse({
        stations: [
          station('1'),
          station('2'),
          station('3'),
          station('3'),
          { ...station('4'), state: 'TAS' },
        ],
        prices: [
          price(1, 0),
          price(2, 170, 'soon'),
          price(3, 171),
          price(4, 150, '21/10/2026 01:00:00', 'TAS'),
        ],
      }),
      new Date(FIXTURE_FETCHED_AT),
    );
    expect(s.stations.map((x) => x.code)).toEqual(['3']);
    expect(st.skippedPrices).toEqual({ unknownFuel: 0, notPositive: 1, badTimestamp: 1 });
    expect(st.skippedStations.notNsw).toBe(1);
  });
});
