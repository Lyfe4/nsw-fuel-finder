// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ApiError } from './http';
import { parseLocationQuery, parseNearbyQuery } from './validate';

const params = (query: Record<string, string>) => new URLSearchParams(query);

function badRequest(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('bad_request');
    return (error as ApiError).message;
  }
  throw new Error('expected a bad_request ApiError');
}

describe('parseNearbyQuery', () => {
  const sydney = { lat: '-33.86785', lng: '151.20732', fuel: 'E10' };

  it('rounds the position to two decimals and defaults the radius', () => {
    expect(parseNearbyQuery(params(sydney))).toEqual({
      latitude: -33.87,
      longitude: 151.21,
      radiusKm: 5,
      fuelType: 'E10',
    });
  });

  it.each([
    ['0', 1],
    ['-4', 1],
    ['7.6', 8],
    ['100', 25],
  ])('clamps radius %s to %d km', (radius, expected) => {
    expect(parseNearbyQuery(params({ ...sydney, radius })).radiusKm).toBe(expected);
  });

  it('treats an empty radius as the default', () => {
    expect(parseNearbyQuery(params({ ...sydney, radius: ' ' })).radiusKm).toBe(5);
  });

  it('accepts towns at the edges of NSW', () => {
    const edges = [
      { lat: '-36.0737', lng: '146.9135' }, // Albury
      { lat: '-28.1767', lng: '153.5414' }, // Tweed Heads
      { lat: '-31.9539', lng: '141.4539' }, // Broken Hill
      { lat: '-37.0731', lng: '149.9086' }, // Eden
    ];
    for (const edge of edges) {
      expect(() => parseNearbyQuery(params({ ...edge, fuel: 'U91' }))).not.toThrow();
    }
  });

  it.each([
    ['Melbourne', '-37.8136', '144.9631'],
    ['Brisbane', '-27.4698', '153.0251'],
    ['swapped lat and lng', '151.2073', '-33.8679'],
    ['null island', '0', '0'],
  ])('refuses a position outside NSW (%s)', (_, lat, lng) => {
    expect(badRequest(() => parseNearbyQuery(params({ lat, lng, fuel: 'E10' })))).toBe(
      'That location is outside NSW.',
    );
  });

  it('refuses a number with trailing junk rather than truncating it', () => {
    expect(badRequest(() => parseNearbyQuery(params({ ...sydney, lng: '151abc' })))).toMatch(
      /"lng" must be a number/,
    );
  });

  it.each(['lat', 'lng', 'fuel'])('requires %s', (name) => {
    const query = params(sydney);
    query.delete(name);
    expect(badRequest(() => parseNearbyQuery(query))).toMatch(`"${name}"`);
  });

  it('accepts a fuel code in any case', () => {
    expect(parseNearbyQuery(params({ ...sydney, fuel: 'p98' })).fuelType).toBe('P98');
  });

  it('refuses an unknown fuel code and lists the valid ones', () => {
    const message = badRequest(() => parseNearbyQuery(params({ ...sydney, fuel: 'DIESEL' })));
    expect(message).toMatch(/Unknown fuel type "DIESEL"/);
    expect(message).toMatch(/E10, U91/);
  });
});

describe('parseLocationQuery', () => {
  it.each(['2000', '2250', '1235'])('accepts NSW postcode %s', (query) => {
    expect(parseLocationQuery(params({ query, fuel: 'E10' }))).toEqual({
      location: query,
      fuelType: 'E10',
    });
  });

  it.each(['Woy Woy', 'Kurri Kurri', "O'Connell", 'St. Ives', 'Wagga Wagga', 'Bellingen'])(
    'accepts suburb "%s"',
    (query) => {
      expect(parseLocationQuery(params({ query, fuel: 'E10' })).location).toBe(query);
    },
  );

  it('accepts accented letters', () => {
    expect(parseLocationQuery(params({ query: 'Gundagai Café', fuel: 'E10' })).location).toBe(
      'Gundagai Café',
    );
  });

  it('normalises a curly apostrophe and collapses whitespace', () => {
    expect(parseLocationQuery(params({ query: '  O’Connell   ', fuel: 'E10' })).location).toBe(
      "O'Connell",
    );
    expect(parseLocationQuery(params({ query: 'Woy    Woy', fuel: 'E10' })).location).toBe(
      'Woy Woy',
    );
  });

  it.each([
    ['a VIC postcode', '3000'],
    ['a five-digit number', '20000'],
    ['one letter', 'x'],
    ['markup', '<script>'],
    ['a leading digit', '2nd Avenue'],
    ['too long', 'a'.repeat(51)],
  ])('refuses %s', (_, query) => {
    expect(badRequest(() => parseLocationQuery(params({ query, fuel: 'E10' })))).toBe(
      'Enter a NSW suburb name or a four-digit postcode.',
    );
  });

  it('requires a query', () => {
    expect(badRequest(() => parseLocationQuery(params({ fuel: 'E10' })))).toMatch('"query"');
  });
});
