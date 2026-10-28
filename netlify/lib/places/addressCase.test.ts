// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mendAddressCase } from './addressCase';

describe('mending a suburb written in capitals', () => {
  it.each([
    // Real shapes from the snapshot: a careful street, the suburb in capitals.
    ['459 Pacific Hwy, WYOMING NSW 2250', '459 Pacific Hwy, Wyoming NSW 2250'],
    ['1 Windsor Rd, McGRATHS HILL NSW 2756', '1 Windsor Rd, McGraths Hill NSW 2756'],
    ['20 Mort St, BRADDON ACT 2612', '20 Mort St, Braddon ACT 2612'],
    ['52 Hill Street, URALLA, NSW  2358, AU', '52 Hill Street, Uralla, NSW  2358, AU'],
    // No comma before the suburb: the longest known run of capitals at the end.
    ['94 Sturt Hwy BALRANALD NSW 2715', '94 Sturt Hwy Balranald NSW 2715'],
    ['12 Main Rd EAST WAGGA WAGGA NSW 2650', '12 Main Rd East Wagga Wagga NSW 2650'],
  ])('%s -> %s', (address, mended) => {
    expect(mendAddressCase(address)).toBe(mended);
  });

  it.each([
    // Already written with care.
    '55 Central Coast Highway, Gosford West NSW 2250',
    // A suburb the gazetteer does not know: left as written.
    '1 Some Rd, NOWHEREVILLE NSW 2999',
    // All capitals: the browser sets the whole address in title case.
    '57 CENTRAL COAST HWY, WEST GOSFORD NSW 2250',
    // Not the usual shape at all.
    'Somewhere unusual',
  ])('leaves %s alone', (address) => {
    expect(mendAddressCase(address)).toBe(address);
  });

  it('changes only the suburb: the street, its abbreviations, state and postcode stay', () => {
    expect(mendAddressCase('6-8 Central Coast HWY, KARIONG NSW 2250')).toBe(
      '6-8 Central Coast HWY, Kariong NSW 2250',
    );
  });
});
