import { describe, expect, it } from 'vitest';

import {
  formatAddress,
  formatAge,
  formatAsOf,
  formatDistance,
  formatPrice,
  formatStationName,
} from './format';

describe('format', () => {
  it.each([
    ['57 CENTRAL COAST HWY, WEST GOSFORD NSW 2250', '57 Central Coast Hwy, West Gosford NSW 2250'],
    ['6-8 CENTRAL COAST HWY, KARIONG NSW 2250', '6-8 Central Coast Hwy, Kariong NSW 2250'],
    ["1A O'CONNELL ST, WAGGA-WAGGA NSW 2650", "1A O'Connell St, Wagga-Wagga NSW 2650"],
    ['12 NORTHBOURNE AVE, BRADDON ACT 2612', '12 Northbourne Ave, Braddon ACT 2612'],
    // A possessive stays small; a single letter before the apostrophe is a name.
    ["2 ST JOHN'S RD, GLEBE NSW 2037", "2 St John's Rd, Glebe NSW 2037"],
    ["9 D'ARCY ST, BEGA NSW 2550", "9 D'Arcy St, Bega NSW 2550"],
    // Anything with a lower-case letter was written with care: left alone.
    [
      '55 Central Coast Highway, Gosford West NSW 2250',
      '55 Central Coast Highway, Gosford West NSW 2250',
    ],
    ['459 Pacific Hwy, WYOMING NSW 2250', '459 Pacific Hwy, WYOMING NSW 2250'],
    ['1 McGraths Hill Rd, McGRATHS HILL NSW 2756', '1 McGraths Hill Rd, McGRATHS HILL NSW 2756'],
  ])('address %s -> %s', (address, text) => {
    expect(formatAddress(address)).toBe(text);
  });

  it.each([
    [227.5, '227.5'],
    [230, '230.0'],
  ])('price %d -> %s', (cents, text) => {
    expect(formatPrice(cents)).toBe(text);
  });

  it.each([
    [0.424, '420 m'],
    [0.05, '50 m'],
    [3.91, '3.9 km'],
    [12.3, '12 km'],
  ])('distance %d km -> %s', (km, text) => {
    expect(formatDistance(km)).toBe(text);
  });

  it('shows the snapshot time in Sydney, with the date only when it is not today', () => {
    // 03:30 UTC is 2:30 pm in Sydney (AEDT) on 23 October.
    const now = new Date('2026-10-23T04:00:00Z');
    expect(formatAsOf('2026-10-23T03:30:00Z', now)).toBe('2:30 pm');
    // ICU versions differ on the comma after the weekday.
    expect(formatAsOf('2026-10-21T03:30:00Z', now)).toMatch(/^Wed,? 21 Oct, 2:30 pm$/);
  });

  it('describes how old a price is', () => {
    const now = new Date('2026-10-23T04:00:00Z');
    expect(formatAge('2026-10-23T03:59:30Z', now)).toBe('just now');
    expect(formatAge('2026-10-23T03:15:00Z', now)).toBe('45 minutes ago');
    expect(formatAge('2026-10-23T01:00:00Z', now)).toBe('3 hours ago');
    expect(formatAge('2026-10-22T04:00:00Z', now)).toBe('yesterday');
    expect(formatAge('2026-10-11T04:00:00Z', now)).toBe('12 days ago');
    expect(formatAge('2026-07-01T04:00:00Z', now)).toBe('4 months ago');
    // The oldest live price is from 2018: a station that never changed it.
    expect(formatAge('2018-06-25T00:15:01Z', now)).toBe('8 years ago');
  });
});

describe('formatStationName', () => {
  // Real all-capitals names from FuelCheck (the snapshot, 29 October 2026).
  it.each([
    ['MOBIL HASTINGS RIVER', 'Mobil', 'Mobil Hastings River'],
    ['PEARL ENERGY MORISSET', 'Pearl Energy', 'Pearl Energy Morisset'],
    ['BP CAMDEN', 'BP', 'BP Camden'],
    ['LOWES NORTH STAR OPT', 'Lowes', 'Lowes North Star OPT'],
    ['METCO PETROLEUM', 'Independent', 'METCO Petroleum'],
    ['APW', 'APW', 'APW'],
    ['SG CHAMBERS', 'Independent', 'SG Chambers'],
    ["YOGI'S PLACE SERVICE STATION", 'Liberty', "Yogi's Place Service Station"],
    ['JACK & CO NORTHWOOD', 'BP', 'Jack & Co Northwood'],
    ['METRO PETROLEUM, (WEST RYDE)', 'Metro Fuel', 'Metro Petroleum, (West Ryde)'],
    ['ARKO ENERGY GOULBURN', 'Arko Energy', 'Arko Energy Goulburn'],
    // Not in the snapshot today, but the same shapes.
    ['EG AMPOL UMINA', 'EG Ampol', 'EG Ampol Umina'],
    ['OTR KINGS PARK', 'Independent', 'OTR Kings Park'],
    ['7-ELEVEN RYDE', '7-Eleven', '7-Eleven Ryde'],
    ['U-GO CANLEY HEIGHTS', 'U-Go', 'U-Go Canley Heights'],
    ['TEMCO SINGLETON', 'TEMCO Petroleum', 'TEMCO Singleton'],
    ['BP MT DRUITT', 'BP', 'BP Mt Druitt'],
    ["PK'S BARGO", "PK's", "PK's Bargo"],
    ["O'CONNELL FUELS", 'Independent', "O'Connell Fuels"],
    ['AMPOL M1 NORTHBOUND', 'Ampol', 'Ampol M1 Northbound'],
  ])('%s (%s) -> %s', (name, brand, text) => {
    expect(formatStationName(name, brand)).toBe(text);
  });

  it('leaves a name written with any lower case alone, capitals and all', () => {
    expect(formatStationName('OTR Kings Park', 'Independent')).toBe('OTR Kings Park');
    expect(formatStationName('SHELL Coles Express', 'Shell')).toBe('SHELL Coles Express');
  });

  it('takes no guide from a brand in capitals: it shouts as the name does', () => {
    expect(formatStationName('MATEX FUEL MATRAVILLE', 'MATEX FUEL')).toBe('Matex Fuel Matraville');
  });
});
