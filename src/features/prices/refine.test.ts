import { describe, expect, it } from 'vitest';

import { station } from '@/lib/testing/fakeApi';

import { refineNearby } from './refine';

describe('refineNearby', () => {
  const precise = { latitude: -33.8688, longitude: 151.2093 };

  it('replaces rounded-origin distances with real ones and drops what is outside the radius', () => {
    const stations = [
      // ~1 km north: inside 5 km.
      station({ stationCode: 'a', latitude: -33.8598, longitude: 151.2093, distanceKm: 1.9 }),
      // ~5.6 km north: the API's slack let it in; really outside.
      station({ stationCode: 'b', latitude: -33.8188, longitude: 151.2093, distanceKm: 4.9 }),
    ];
    const refined = refineNearby(stations, precise, 5);
    expect(refined.map((s) => s.stationCode)).toEqual(['a']);
    expect(refined[0]?.distanceKm).toBeCloseTo(1, 1);
  });

  it('re-sorts: cheapest first, then nearest by the real distance', () => {
    const near = station({
      stationCode: 'near',
      latitude: -33.8698,
      longitude: 151.2093,
      distanceKm: 3,
    });
    const far = station({
      stationCode: 'far',
      latitude: -33.8888,
      longitude: 151.2093,
      distanceKm: 1,
    });
    expect(refineNearby([far, near], precise, 5).map((s) => s.stationCode)).toEqual([
      'near',
      'far',
    ]);
  });
});
