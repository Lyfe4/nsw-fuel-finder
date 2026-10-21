// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { displayName, parseAddresses, placeKey } from './address';

describe('parseAddresses', () => {
  // Every address here is a real one from the live data.
  const parse = (...addresses: string[]) => parseAddresses(addresses);

  it.each([
    ['307-313 Ocean Beach Road, UMINA BEACH NSW 2257', 'Umina Beach', 'NSW', '2257'],
    ['1 Wallgrove Rd, Eastern Creek NSW 2766', 'Eastern Creek', 'NSW', '2766'],
    ['456, Metford Road, Metford NEW SOUTH WALES 2323', 'Metford', 'NSW', '2323'],
    ['52 Hill Street, Uralla, NSW  2358, AU', 'Uralla', 'NSW', '2358'],
    ['20 MORT ST, BRADDON ACT 2612', 'Braddon', 'ACT', '2612'],
    [
      'Corner Appin Road & Kellerman Drive St Helens Park, St Helens Park NSW 2560',
      'St Helens Park',
      'NSW',
      '2560',
    ],
  ])('%s', (address, suburb, state, postcode) => {
    expect(parse(address)[0]).toMatchObject({ suburb, state, postcode });
  });

  it('recovers a suburb with no comma before it from suburbs seen elsewhere', () => {
    const [noComma, bare] = parse(
      '94 Sturt Hwy BALRANALD NSW 2715',
      'Wagga Wagga NSW 2650',
      '45 WE ST, BALRANALD NSW 2715',
      '56 Docker St, WAGGA WAGGA NSW 2650',
    );
    expect(noComma?.suburb).toBe('Balranald');
    expect(bare?.suburb).toBe('Wagga Wagga');
  });

  it('prefers the longest known suburb', () => {
    const [address] = parse(
      '101-107 Hammond Ave East Wagga Wagga NSW 2650',
      '1 Test St, East Wagga Wagga NSW 2650',
      '2 Test St, Wagga Wagga NSW 2650',
    );
    expect(address?.suburb).toBe('East Wagga Wagga');
  });

  it('leaves the suburb unknown rather than guessing', () => {
    expect(parse('Corner Pacific Hwy and Halls Road Coffs Harbour NSW 2450')[0]).toMatchObject({
      suburb: null,
      state: 'NSW',
      postcode: '2450',
    });
  });

  it('copes with an address it cannot read at all', () => {
    expect(parse('Somewhere on the highway')[0]).toMatchObject({
      suburb: null,
      state: null,
      postcode: null,
    });
  });
});

describe('placeKey', () => {
  it.each([
    ['St. Ives', 'St Ives'],
    ["O'Connell", 'OConnell'],
    ['O’Connell', "O'Connell"],
    ['Mt Druitt', 'Mount Druitt'],
    ['Mt. Druitt', 'mount druitt'],
    ['WAGGA  WAGGA', 'Wagga Wagga'],
    ['Gundagai Café', 'gundagai cafe'],
  ])('treats "%s" and "%s" as the same place', (a, b) => {
    expect(placeKey(a)).toBe(placeKey(b));
  });
});

describe('displayName', () => {
  it.each([
    ['UMINA BEACH', 'Umina Beach'],
    ["O'CONNELL", "O'Connell"],
    ['KURRI-KURRI', 'Kurri-Kurri'],
    ['St Helens Park', 'St Helens Park'],
  ])('%s -> %s', (raw, expected) => {
    expect(displayName(raw)).toBe(expected);
  });
});
