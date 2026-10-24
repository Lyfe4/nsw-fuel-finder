import { describe, expect, it } from 'vitest';

import { parseSearch, serializeSearch } from './searchState';

describe('parseSearch', () => {
  it('defaults to Unleaded 91, 5 km and no search', () => {
    expect(parseSearch('')).toEqual({
      fuel: 'U91',
      radius: 5,
      place: null,
      view: 'list',
      station: null,
      history: null,
    });
  });

  it('reads a suburb search with the API’s own parameter names', () => {
    expect(parseSearch('?fuel=e10&query=Erina%20NSW%202250&radius=10')).toEqual({
      fuel: 'E10',
      radius: 10,
      place: { kind: 'location', query: 'Erina NSW 2250' },
      view: 'list',
      station: null,
      history: null,
    });
  });

  it('reads a nearby search, rounding a hand-edited precise position', () => {
    expect(parseSearch('?lat=-33.867812&lng=151.207321').place).toEqual({
      kind: 'nearby',
      lat: -33.87,
      lng: 151.21,
    });
  });

  it.each([
    ['an unknown fuel', '?fuel=EV', { fuel: 'U91' }],
    ['a radius out of range', '?radius=500', { radius: 5 }],
    ['a radius that is not a whole number', '?radius=2.5', { radius: 5 }],
    // Not one of the steps (an old or hand-edited link): the next step up.
    ['a radius between steps', '?radius=7', { radius: 10 }],
    ['a radius below the smallest step', '?radius=1', { radius: 2 }],
    ['an empty radius', '?radius=', { radius: 5 }],
    ['half a position', '?lat=-33.87', { place: null }],
    ['a position that is not a number', '?lat=x&lng=y', { place: null }],
    ['an empty query', '?query=%20%20', { place: null }],
    ['an unknown view', '?view=satellite', { view: 'list' }],
    ['a station code with odd characters', '?station=%3Cscript%3E', { station: null }],
  ])('falls back on %s', (_, search, expected) => {
    expect(parseSearch(search)).toMatchObject(expected);
  });

  it('prefers a typed place over a position when a URL has both', () => {
    expect(parseSearch('?query=2250&lat=-33.87&lng=151.21').place).toEqual({
      kind: 'location',
      query: '2250',
    });
  });
});

describe('view and station', () => {
  it('reads the map view and a selected station', () => {
    expect(parseSearch('?query=2250&view=map&station=2263')).toMatchObject({
      view: 'map',
      station: '2263',
    });
  });

  it('writes them last, and leaves the list view out as the default', () => {
    const state = parseSearch('?query=2250&station=2263');
    expect(serializeSearch(state)).toBe('fuel=U91&query=2250&station=2263');
    expect(serializeSearch({ ...state, view: 'map' })).toBe(
      'fuel=U91&query=2250&view=map&station=2263',
    );
  });
});

describe('serializeSearch', () => {
  it('round-trips, leaving the default radius out', () => {
    const state = parseSearch('?fuel=DL&query=Kingswood%20(Penrith)%20NSW%202747');
    expect(serializeSearch(state)).toBe('fuel=DL&query=Kingswood+%28Penrith%29+NSW+2747');
    expect(parseSearch(serializeSearch(state))).toEqual(state);
  });

  it('writes a nearby search and a non-default radius', () => {
    expect(
      serializeSearch({
        fuel: 'U91',
        radius: 25,
        place: { kind: 'nearby', lat: -33.87, lng: 151.21 },
        view: 'list',
        station: null,
        history: null,
      }),
    ).toBe('fuel=U91&lat=-33.87&lng=151.21&radius=25');
  });
});
