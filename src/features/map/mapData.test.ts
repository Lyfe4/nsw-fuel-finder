import { describe, expect, it } from 'vitest';

import { prices, station } from '@/lib/testing/fakeApi';

import { boundsOf, lookalikes, priceBands, toFeatures } from './mapData';

describe('priceBands', () => {
  it('splits stations into cheapest, middle and dearest thirds by rank', () => {
    const band = priceBands([210, 220, 230, 240, 250, 260]);
    expect([210, 220, 230, 240, 250, 260].map(band)).toEqual([
      'low',
      'low',
      'mid',
      'mid',
      'high',
      'high',
    ]);
  });

  it('never colours equal prices differently', () => {
    const band = priceBands([200, 200, 200, 200, 250, 260]);
    expect(band(200)).toBe('low');
  });

  it('calls a single station cheap', () => {
    expect(priceBands([231])(231)).toBe('low');
  });

  it('puts one station in each band when there are three', () => {
    const band = priceBands([3, 1, 2]);
    expect([1, 2, 3].map(band)).toEqual(['low', 'mid', 'high']);
  });
});

describe('toFeatures', () => {
  it('makes GeoJSON points, longitude first, with the price as the label', () => {
    const collection = toFeatures([
      station({ stationCode: '7', priceCents: 229.9, latitude: -33.4, longitude: 151.3 }),
    ]);
    expect(collection.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [151.3, -33.4] },
      properties: { code: '7', label: '229.9', band: 'low', cheapest: false, priority: 229.9 },
    });
  });

  it('says "Cheapest" in words beside every cheapest station, ties included', () => {
    const labels = toFeatures([
      station({ stationCode: 'a', priceCents: 199.9 }),
      station({ stationCode: 'b', priceCents: 199.9 }),
      station({ stationCode: 'c', priceCents: 215 }),
    ]).features.map((feature) => feature.properties.label);
    expect(labels).toEqual(['Cheapest 199.9', 'Cheapest 199.9', '215.0']);
  });

  it('says nothing about "cheapest" when every price is the same', () => {
    const labels = toFeatures([
      station({ stationCode: 'a', priceCents: 199.9 }),
      station({ stationCode: 'b', priceCents: 199.9 }),
    ]).features.map((feature) => feature.properties.label);
    expect(labels).toEqual(['199.9', '199.9']);
  });
});

describe('boundsOf', () => {
  it('covers every station and the search origin', () => {
    const { origin } = prices({
      origin: { latitude: -33.5, longitude: 151.0, label: null },
    });
    expect(
      boundsOf(
        [
          station({ latitude: -33.4, longitude: 151.3 }),
          station({ latitude: -33.6, longitude: 151.1 }),
        ],
        origin,
      ),
    ).toEqual([
      [151.0, -33.6],
      [151.3, -33.4],
    ]);
  });
});

describe('lookalikes', () => {
  // Pearl Energy and Metro Petroleum in Cessnock: 124 m apart, both 236.5.
  const selected = station({
    stationCode: '2393',
    latitude: -32.8335,
    longitude: 151.3561,
    priceCents: 236.5,
  });
  const twin = station({
    stationCode: '20206',
    latitude: -32.8346,
    longitude: 151.3555,
    priceCents: 236.5,
  });

  it('finds a neighbour a street away at the same price', () => {
    expect(lookalikes([selected, twin], '2393')).toEqual(['20206']);
  });

  it('leaves a neighbour at a different price, or the same price further off', () => {
    const dearer = { ...twin, stationCode: '3', priceCents: 236.9 };
    const across = { ...twin, stationCode: '4', latitude: -32.84 };
    expect(lookalikes([selected, dearer, across], '2393')).toEqual([]);
  });

  it('is nothing without a selection', () => {
    expect(lookalikes([selected, twin], null)).toEqual([]);
  });
});
